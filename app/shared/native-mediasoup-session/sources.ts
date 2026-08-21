import { asError } from "../native-mediasoup-utils.ts";
import type { NativeMediasoupSfuSession } from "../native-mediasoup-session.ts";
import type {
  NativeProducerEntry,
  NativeSourceEntry,
} from "../types/native-mediasoup-session.ts";
import {
  createCodecRoutingPlan,
  supportsConcurrentHardwareVariants,
  validateCodecRoutingPlan,
  type CodecRoutingParticipant,
  type CodecRoutingPlan,
  type CodecRoutingTarget,
} from "../video-codec-routing.ts";
import {
  VIDEO_CODEC_NAMES,
  efficientEncodeCodecs,
  isEmergencyUsable,
  isVideoCodecName,
  isRealtimeEfficient,
  maxConcurrentHardwareEncodeSessions,
  normalizeVideoCodecName,
  normalizeParticipantMediaCapabilities,
} from "../types/video-codec-capabilities.ts";

import { nativeProducerAppData, nativeVideoMetadata } from "./helpers.ts";
import { isExternalRecord } from "../types/boundary.ts";
import type { MediaCommandResult } from "../types/boundary.ts";

function recordValue<T>(value: T): Record<string, unknown> {
  return isExternalRecord(value) ? value : {};
}

function recordArray<T>(value: T): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((candidate): candidate is Record<string, unknown> =>
    isExternalRecord(candidate),
  );
}

interface NativeMediasoupProducerRequest extends Record<string, unknown> {
  source?: string;
  producerKey?: string;
  paused?: boolean;
  kind?: "audio" | "video";
  appData?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
}

interface NativeCodecRoutingOptions {
  allowEmergencySoftware: boolean;
  allowTargetAdaptation: boolean;
  sfuSupportedCodecs: string[];
  target?: CodecRoutingTarget;
}

interface NativeMediaPublication extends Record<string, unknown> {
  target?: CodecRoutingTarget;
  targetAdjusted?: boolean;
}

function producerKey(entry: NativeSourceEntry) {
  return String(entry.producerKey || entry.source || "");
}

function variantKey(source: string, variantId: string, codec: string) {
  return String(variantId || `${source}:${codec.toLowerCase()}`);
}

function sourceForPlan(plan: CodecRoutingPlan) {
  if (plan.source) return String(plan.source);
  const logicalStreamId = String(plan.logicalStreamId || "");
  if (logicalStreamId.startsWith("source:"))
    return logicalStreamId.slice("source:".length);
  const parts = logicalStreamId.split("/");
  return String(parts[parts.length - 1] || "");
}

function cloudflareProducerSnapshot(
  producer: Record<string, unknown>,
  source: string,
): NativeSourceEntry {
  const target = routingTargetValue(producer.target);
  const score = Number(producer.score);
  const snapshot: NativeSourceEntry = {
    source: String(producer.source || source),
    kind: "video",
    logicalStreamId: String(producer.logicalStreamId || "") || null,
    generation: Math.max(1, Math.floor(Number(producer.generation) || 1)),
    variantId: String(producer.variantId || "") || null,
    codec: normalizeVideoCodecName(producer.codec),
    width: positiveNumber(producer.width),
    height: positiveNumber(producer.height),
    fps: positiveNumber(producer.fps),
    bitrate: positiveNumber(producer.bitrate),
    receivers: Array.isArray(producer.receivers)
      ? producer.receivers.map(String)
      : [],
    emergency: producer.emergency === true,
  };
  if (target) snapshot.target = target;
  if (producer.targetAdjusted === true) snapshot.targetAdjusted = true;
  if (Number.isFinite(score)) snapshot.routingScore = score;
  return snapshot;
}

function routingTarget(
  entry: NativeSourceEntry,
): CodecRoutingTarget | undefined {
  return routingTargetValue({
    width: entry.width,
    height: entry.height,
    fps: entry.fps,
    bitrate: entry.bitrate,
  });
}

function routingTargetValue<T>(value: T): CodecRoutingTarget | undefined {
  const record = recordValue(value);
  const target: CodecRoutingTarget = {};
  for (const key of ["width", "height", "fps", "bitrate"] as const) {
    const number = Number(record[key]);
    if (Number.isFinite(number) && number > 0) target[key] = Math.floor(number);
  }
  return Object.keys(target).length ? target : undefined;
}

function positiveNumber<T>(value: T) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function allVideoProducers(session: NativeMediasoupSfuSession) {
  return [
    ...session.producers.values(),
    ...session.producerVariants.values(),
  ].filter((producer, index, entries) => {
    if (producer.kind !== "video") return false;
    return entries.indexOf(producer) === index;
  });
}

function producerSourceEntry(producer: NativeProducerEntry) {
  return producer.entry;
}

function cloneNativeSourceEntry(entry: NativeSourceEntry): NativeSourceEntry {
  const clone: NativeSourceEntry = {
    ...entry,
  };
  if (entry.receivers) clone.receivers = [...entry.receivers];
  if (entry.target) clone.target = { ...entry.target };
  return clone;
}

function routingVariantFromProducerEntry(
  entry: NativeSourceEntry,
): CodecRoutingPlan["desiredVariants"][number] {
  const variant: CodecRoutingPlan["desiredVariants"][number] = {
    codec: normalizeVideoCodecName(entry.codec) || "H264",
    variantId: String(entry.variantId || ""),
    generation: Math.max(1, Math.floor(Number(entry.generation) || 1)),
    receivers: Array.isArray(entry.receivers) ? [...entry.receivers] : [],
    emergency: entry.emergency === true,
    hardwareEncode: entry.codecAcceleration === "hardware",
    score: Number.isFinite(Number(entry.routingScore))
      ? Number(entry.routingScore)
      : 0,
  };
  if (entry.target) variant.target = { ...entry.target };
  if (entry.targetAdjusted) variant.targetAdjusted = true;
  return variant;
}

function producerUsesHardwareEncoder(
  session: NativeMediasoupSfuSession,
  producer: NativeProducerEntry,
) {
  const codec = normalizeVideoCodecName(producerSourceEntry(producer).codec);
  return Boolean(
    codec &&
    normalizeParticipantMediaCapabilities(session.mediaCapabilities)
      .videoCodecs[codec].encode.acceleration === "hardware",
  );
}

function activeHardwareEncoderCount(session: NativeMediasoupSfuSession) {
  return allVideoProducers(session).filter((producer) =>
    producerUsesHardwareEncoder(session, producer),
  ).length;
}

function activeHardwareEncoderCodecs(session: NativeMediasoupSfuSession) {
  return allVideoProducers(session)
    .filter((producer) => producerUsesHardwareEncoder(session, producer))
    .map((producer) =>
      normalizeVideoCodecName(producerSourceEntry(producer).codec),
    )
    .filter(
      (codec): codec is (typeof VIDEO_CODEC_NAMES)[number] => codec !== null,
    );
}

function existingProducerForVariant(
  session: NativeMediasoupSfuSession,
  source: string,
  plan: CodecRoutingPlan,
  variant: CodecRoutingPlan["desiredVariants"][number],
) {
  const variantId = String(variant.variantId || "");
  return allVideoProducers(session).find((producer) => {
    const entry = producerSourceEntry(producer);
    if (producer.source !== source) return false;
    if (String(entry.logicalStreamId || "") !== plan.logicalStreamId)
      return false;
    if (normalizeVideoCodecName(entry.codec) !== variant.codec) return false;
    if (
      (producer.producerKey === source || !producer.producerKey) &&
      !entry.variantId
    )
      return true;
    return String(entry.variantId || "") === variantId;
  });
}

function producerTargetParameters(
  sourceEntry: NativeSourceEntry,
  variant: CodecRoutingPlan["desiredVariants"][number],
) {
  const sourceWidth = positiveNumber(sourceEntry.width);
  const sourceHeight = positiveNumber(sourceEntry.height);
  const sourceFps = positiveNumber(sourceEntry.fps);
  const sourceBitrate = positiveNumber(sourceEntry.bitrate);
  const target = variant.target || {};
  const targetWidth = positiveNumber(target.width) || sourceWidth;
  const targetHeight = positiveNumber(target.height) || sourceHeight;
  const targetFps = Math.min(
    positiveNumber(target.fps) || sourceFps || 0,
    sourceFps || positiveNumber(target.fps) || 0,
  );
  const targetBitrate =
    positiveNumber(variant.estimatedBitrateBps) ||
    positiveNumber(target.bitrate) ||
    sourceBitrate;
  const parameters: Record<string, unknown> = {};
  if (targetFps > 0) parameters.maxFramerate = Math.floor(targetFps);
  if (targetBitrate) parameters.maxBitrate = Math.floor(targetBitrate);
  if (sourceWidth && sourceHeight && targetWidth && targetHeight)
    parameters.scaleResolutionDownBy = Math.max(
      1,
      sourceWidth / targetWidth,
      sourceHeight / targetHeight,
    );
  return parameters;
}

async function applyProducerTarget(
  session: NativeMediasoupSfuSession,
  producer: NativeProducerEntry,
  sourceEntry: NativeSourceEntry,
  variant: CodecRoutingPlan["desiredVariants"][number],
) {
  const parameters = producerTargetParameters(sourceEntry, variant);
  if (!Object.keys(parameters).length) return true;
  try {
    const request: NativeMediasoupProducerRequest = {
      source: producer.source,
      parameters,
    };
    if (producer.producerKey !== producer.source)
      request.producerKey = producer.producerKey;
    await session.invoke("media_set_producer_parameters", request);
    return true;
  } catch (error) {
    session.onError?.(asError(error, "Native codec target update failed"));
    return false;
  }
}

function preferredVideoCodec(
  session: NativeMediasoupSfuSession,
  entry: NativeSourceEntry,
) {
  const explicit = normalizeVideoCodecName(entry.codec);
  const capabilities = normalizeParticipantMediaCapabilities(
    session.mediaCapabilities,
  );
  const deviceCodecs = Array.isArray(session.device?.rtpCapabilities?.codecs)
    ? session.device.rtpCapabilities.codecs
    : [];
  const available = (codec: string) =>
    deviceCodecs.some((candidate) => {
      const candidateRecord = recordValue(candidate);
      const mimeType = String(
        candidateRecord.mimeType || candidateRecord.mime_type || "",
      ).toUpperCase();
      return mimeType === `VIDEO/${codec}`;
    });
  if (explicit) {
    const capability = capabilities.videoCodecs[explicit].encode;
    if (
      (isRealtimeEfficient(capability) ||
        (entry.emergency === true && isEmergencyUsable(capability))) &&
      (!deviceCodecs.length || available(explicit))
    )
      return explicit;
  }
  const efficient = efficientEncodeCodecs(capabilities);
  return (
    efficient.find((codec) => !deviceCodecs.length || available(codec)) || null
  );
}

function deviceVideoCodecs(session: NativeMediasoupSfuSession) {
  const codecs = session.device?.rtpCapabilities?.codecs;
  if (!Array.isArray(codecs) || codecs.length === 0)
    return [...VIDEO_CODEC_NAMES];
  return VIDEO_CODEC_NAMES.filter((codec) =>
    codecs.some((candidate) => {
      const candidateRecord = recordValue(candidate);
      const mimeType = String(
        candidateRecord.mimeType || candidateRecord.mime_type || "",
      ).toUpperCase();
      return mimeType === `VIDEO/${codec}`;
    }),
  );
}

function defaultLogicalStreamId(source: string) {
  return `source:${source}`;
}

function defaultVariantId(logicalStreamId: string, codec: string | null) {
  return codec ? `${logicalStreamId}:${codec.toLowerCase()}` : null;
}

function routingParticipantId(entry: Record<string, unknown>) {
  return String(
    entry.peerId || entry.participantId || entry.deviceId || entry.userId || "",
  );
}

function routingParticipants(
  session: NativeMediasoupSfuSession,
): CodecRoutingParticipant[] | null {
  if (!session.lastInRoom.length) return [];
  const participants: CodecRoutingParticipant[] = [];
  const seen = new Set<string>();
  for (const entry of session.lastInRoom) {
    const ids = [
      entry.peerId,
      entry.participantId,
      entry.deviceId,
      entry.userId,
    ]
      .map((value) => String(value || ""))
      .filter(Boolean);
    const participantId = routingParticipantId(entry);
    if (!participantId || participantId === session.localPeerId) continue;
    if (seen.has(participantId)) continue;
    const mediaCapabilities =
      ids
        .map((id) => session.remoteParticipantCapabilities.get(id))
        .find(Boolean) ||
      (isExternalRecord(entry.mediaCapabilities)
        ? normalizeParticipantMediaCapabilities(entry.mediaCapabilities)
        : null);
    if (!mediaCapabilities) return null;
    seen.add(participantId);
    participants.push({ participantId, mediaCapabilities });
  }
  return participants;
}

function routingPlanSignature(plan: CodecRoutingPlan) {
  return JSON.stringify({
    logicalStreamId: plan.logicalStreamId,
    target: plan.target || null,
    desiredVariants: plan.desiredVariants
      .map((variant) => ({
        codec: variant.codec,
        receivers: [...variant.receivers].sort(),
        target: variant.target || null,
        targetAdjusted: variant.targetAdjusted === true,
        emergency: variant.emergency === true,
        variantId: variant.variantId || null,
      }))
      .sort((left, right) =>
        `${left.codec}:${left.variantId || ""}`.localeCompare(
          `${right.codec}:${right.variantId || ""}`,
        ),
      ),
  });
}

const CODEC_ROUTING_STABILITY_WINDOW_MS = 750;

function routingPlanStableForApplication(
  session: NativeMediasoupSfuSession,
  plan: CodecRoutingPlan,
) {
  const previous = session.codecRoutingPlans.get(plan.logicalStreamId);
  if (!previous || plan.emergencyReceivers.length > 0) return true;
  const signature = routingPlanSignature(plan);
  const candidate = session.codecRoutingCandidatePlans.get(
    plan.logicalStreamId,
  );
  if (!candidate || candidate.signature !== signature) {
    session.codecRoutingCandidatePlans.set(plan.logicalStreamId, {
      signature,
      firstSeenAt: Date.now(),
    });
    return false;
  }
  return (
    Date.now() - candidate.firstSeenAt >= CODEC_ROUTING_STABILITY_WINDOW_MS
  );
}

function routingPlanNeedsApplication(
  session: NativeMediasoupSfuSession,
  source: string,
  plan: CodecRoutingPlan,
) {
  const previous = session.codecRoutingPlans.get(plan.logicalStreamId);
  if (
    !previous ||
    routingPlanSignature(previous) !== routingPlanSignature(plan)
  )
    return true;
  if (session.selectedProvider === "cloudflare-realtime")
    return plan.desiredVariants.some(
      (variant) =>
        !session.cloudflareSession?.hasVariant?.(
          String(variant.variantId || ""),
        ),
    );
  const baseProducer = session.producers.get(source);
  return plan.desiredVariants.some((variant) => {
    const id = variantKey(
      source,
      String(variant.variantId || ""),
      variant.codec,
    );
    const isBase = Boolean(
      baseProducer &&
      String(baseProducer.entry.codec || "").toUpperCase() === variant.codec &&
      (!baseProducer.entry.variantId ||
        String(baseProducer.entry.variantId) === String(variant.variantId)),
    );
    return !isBase && !session.producerVariants.has(id);
  });
}

function plannedBaseVariant(
  session: NativeMediasoupSfuSession,
  logicalStreamId: string,
  requestedCodec: string | null,
  requestedVariantId: string | null,
) {
  const plan = session.codecRoutingPlans.get(logicalStreamId);
  if (!plan?.desiredVariants.length) return null;
  return (
    plan.desiredVariants.find(
      (variant) =>
        requestedVariantId &&
        String(variant.variantId || "") === requestedVariantId,
    ) ||
    plan.desiredVariants.find(
      (variant) =>
        requestedCodec &&
        String(variant.codec).toUpperCase() === requestedCodec.toUpperCase(),
    ) ||
    plan.desiredVariants[0]
  );
}

function isVariantStillPlanned(
  session: NativeMediasoupSfuSession,
  variantId: string,
) {
  return [...session.codecRoutingPlans.values()].some((plan) =>
    plan.desiredVariants.some(
      (variant) => String(variant.variantId || "") === variantId,
    ),
  );
}

function isVariantMigrationActive(
  session: NativeMediasoupSfuSession,
  variantId: string,
) {
  for (const state of session.logicalVideoStreams.values()) {
    if (
      state.candidateVariantId === variantId ||
      (state.currentVariantId === variantId && state.state !== "stable")
    )
      return true;
  }
  return [...session.consumers.values()].some(
    (consumer) =>
      consumer.kind === "video" &&
      consumer.variantId === variantId &&
      consumer.migrationState !== "stable",
  );
}

function planMigrationIsStable(
  session: NativeMediasoupSfuSession,
  plan: CodecRoutingPlan,
) {
  const acknowledgements = session.codecMigrationAcks.get(plan.logicalStreamId);
  if (!acknowledgements) return false;
  return plan.desiredVariants.every((variant) =>
    variant.receivers.every((receiverId) => {
      const acknowledgement = acknowledgements.get(String(receiverId));
      const expectedGeneration = Math.max(
        1,
        Math.floor(Number(variant.generation) || 1),
      );
      return Boolean(
        acknowledgement &&
        acknowledgement.state === "stable" &&
        acknowledgement.variantId === String(variant.variantId || "") &&
        acknowledgement.generation === expectedGeneration,
      );
    }),
  );
}

function preserveStableMigrationAcknowledgements(
  session: NativeMediasoupSfuSession,
  plan: CodecRoutingPlan,
) {
  const previous = session.codecMigrationAcks.get(plan.logicalStreamId);
  const preserved = new Map<
    string,
    {
      variantId: string;
      state: "stable" | "abort";
      generation: number;
      updatedAt: number;
    }
  >();
  if (!previous) return preserved;
  for (const variant of plan.desiredVariants) {
    const variantId = String(variant.variantId || "");
    const generation = Math.max(1, Math.floor(Number(variant.generation) || 1));
    for (const receiverId of variant.receivers) {
      const acknowledgement = previous.get(String(receiverId));
      if (
        acknowledgement?.state === "stable" &&
        acknowledgement.variantId === variantId &&
        acknowledgement.generation === generation
      )
        preserved.set(String(receiverId), acknowledgement);
    }
  }
  return preserved;
}

async function closeBaseProducer(
  session: NativeMediasoupSfuSession,
  producer: NativeProducerEntry,
) {
  const producerKey = String(
    producer.producerKey || producer.entry.producerKey || producer.source,
  );
  try {
    const request: NativeMediasoupProducerRequest = {
      source: producer.source,
    };
    if (producerKey !== producer.source) request.producerKey = producerKey;
    await session.invoke("media_remove_capture_producer", request);
  } catch (error) {
    session.onError?.(asError(error, "Native base codec close failed"));
    return false;
  }
  const closeMessage = {
    type: "close-producer",
    data: {
      producerId: producer.id,
      logicalStreamId: producer.entry.logicalStreamId || null,
      variantId: producer.entry.variantId || null,
    },
  };
  let sent: boolean | void = undefined;
  if (session.providerSignaling?.send)
    sent = session.providerSignaling.send(closeMessage);
  else if (!session.controlTicket) sent = session.signaling?.send(closeMessage);
  if (sent === false) {
    session._closeMedia(false).catch(() => {});
    return false;
  }
  session.producers.delete(producer.source);
  return true;
}

async function promoteVariantToBase(
  session: NativeMediasoupSfuSession,
  source: string,
  candidate: NativeProducerEntry,
) {
  const base = session.producers.get(source);
  if (base && !(await closeBaseProducer(session, base))) return false;
  const key = String(
    candidate.producerKey || candidate.entry.producerKey || "",
  );
  session.producerVariants.delete(key);
  candidate.entry = {
    ...candidate.entry,
    producerKey: key || candidate.entry.producerKey,
  };
  session.producers.set(source, candidate);
  session.sources.set(source, { ...candidate.entry });
  const localFeed = session.localVideoFeeds.get(source);
  if (localFeed)
    session.localVideoFeeds.set(source, {
      ...localFeed,
      producerId: candidate.id,
    });
  return true;
}

export async function retireReadyCodecVariants(
  session: NativeMediasoupSfuSession,
  logicalStreamId: string,
) {
  const plan = session.codecRoutingPlans.get(String(logicalStreamId));
  if (
    !plan ||
    !plan.desiredVariants.length ||
    !planMigrationIsStable(session, plan)
  )
    return false;
  if (session.selectedProvider === "cloudflare-realtime") {
    const removed = await session.cloudflareSession?.retireVariants?.(
      plan.logicalStreamId,
      plan.desiredVariants.map((variant) => String(variant.variantId || "")),
    );
    session._emitState();
    return removed === true;
  }
  const source = sourceForPlan(plan);
  const desiredIds = new Set(
    plan.desiredVariants.map((variant) => String(variant.variantId || "")),
  );
  const stale = [...session.producerVariants.values()].filter(
    (producer) =>
      producer.entry.logicalStreamId === plan.logicalStreamId &&
      !desiredIds.has(String(producer.entry.variantId || "")),
  );
  for (const producer of stale)
    await session.removeVariant(producer.producerKey || "");
  const base = session.producers.get(source);
  const baseIsDesired = Boolean(
    base &&
    plan.desiredVariants.some(
      (variant) =>
        variant.codec === String(base.entry.codec || "").toUpperCase() &&
        (!base.entry.variantId ||
          String(base.entry.variantId) === String(variant.variantId || "")),
    ),
  );
  if (!baseIsDesired) {
    const desired = plan.desiredVariants[0];
    const candidate = desired
      ? session.producerVariants.get(
          variantKey(source, String(desired.variantId || ""), desired.codec),
        )
      : null;
    if (candidate) await promoteVariantToBase(session, source, candidate);
  }
  session._sendSourceState();
  session._emitState();
  return true;
}

export function handleCodecMigrationState(
  session: NativeMediasoupSfuSession,
  data: Record<string, unknown>,
) {
  const logicalStreamId = String(data.logicalStreamId || "");
  const receiverId = String(
    data.receiverId || data.peerId || data.deviceId || data.userId || "",
  );
  const variantId = String(data.variantId || "");
  const state =
    data.state === "stable" || data.state === "abort" ? data.state : null;
  if (!logicalStreamId || !receiverId || !variantId || !state) return false;
  const plan = session.codecRoutingPlans.get(logicalStreamId);
  const variant = plan?.desiredVariants.find(
    (candidate) =>
      String(candidate.variantId || "") === variantId &&
      candidate.receivers.includes(receiverId),
  );
  if (!variant) return false;
  const generation = Math.max(1, Math.floor(Number(data.generation) || 1));
  const expectedGeneration = Math.max(
    1,
    Math.floor(Number(variant.generation) || 1),
  );
  if (generation !== expectedGeneration) return false;
  let acknowledgements = session.codecMigrationAcks.get(logicalStreamId);
  if (!acknowledgements) {
    acknowledgements = new Map();
    session.codecMigrationAcks.set(logicalStreamId, acknowledgements);
  }
  acknowledgements.set(receiverId, {
    variantId,
    state,
    generation,
    updatedAt: Date.now(),
  });
  if (state === "stable")
    retireReadyCodecVariants(session, logicalStreamId).catch((error) =>
      session.onError?.(asError(error, "Native codec retirement failed")),
    );
  return true;
}

async function applyCodecRoutingPlanInternal(
  session: NativeMediasoupSfuSession,
  plan: CodecRoutingPlan,
) {
  if (!plan || !plan.logicalStreamId || !Array.isArray(plan.desiredVariants))
    return false;
  const normalizedVariants: CodecRoutingPlan["desiredVariants"] = [];
  for (const variant of plan.desiredVariants) {
    const codec = normalizeVideoCodecName(variant.codec);
    if (!codec || !Array.isArray(variant.receivers)) return false;
    normalizedVariants.push({
      ...variant,
      codec,
      variantId: String(
        variant.variantId ||
          `${plan.logicalStreamId}:${String(variant.codec || "").toLowerCase()}`,
      ),
    });
  }
  const normalizedPlan: CodecRoutingPlan = {
    ...plan,
    desiredVariants: normalizedVariants,
  };
  const source = sourceForPlan(normalizedPlan);
  const validationReceivers = routingParticipants(session);
  if (!validationReceivers) return false;
  const publisherId = String(
    session.localPeerId || normalizedPlan.publisher || "local",
  );
  if (
    normalizedPlan.publisher &&
    String(normalizedPlan.publisher) !== publisherId
  )
    return false;
  const validation = validateCodecRoutingPlan(
    normalizedPlan,
    {
      participantId: publisherId,
      logicalStreamId: normalizedPlan.logicalStreamId,
      source,
      mediaCapabilities: normalizeParticipantMediaCapabilities(
        session.mediaCapabilities,
      ),
    },
    validationReceivers,
    {
      allowEmergencySoftware: true,
      allowTargetAdaptation: true,
      sfuSupportedCodecs: deviceVideoCodecs(session),
    },
  );
  if (!validation.valid) return false;
  const entry = session.sources.get(source);
  const capabilities = normalizeParticipantMediaCapabilities(
    session.mediaCapabilities,
  );
  if (entry?.kind === "video") {
    const maxHardwareSessions =
      maxConcurrentHardwareEncodeSessions(capabilities);
    const requestedHardware = normalizedPlan.desiredVariants.filter(
      (variant) =>
        capabilities.videoCodecs[variant.codec].encode.acceleration ===
          "hardware" &&
        !existingProducerForVariant(session, source, normalizedPlan, variant),
    ).length;
    if (
      maxHardwareSessions &&
      activeHardwareEncoderCount(session) + requestedHardware >
        maxHardwareSessions
    )
      return false;
    const requestedHardwareCodecs = normalizedPlan.desiredVariants
      .filter(
        (variant) =>
          capabilities.videoCodecs[variant.codec].encode.acceleration ===
            "hardware" &&
          !existingProducerForVariant(session, source, normalizedPlan, variant),
      )
      .map((variant) => variant.codec);
    if (
      !supportsConcurrentHardwareVariants(capabilities, [
        ...activeHardwareEncoderCodecs(session),
        ...requestedHardwareCodecs,
      ])
    )
      return false;
  }
  if (session.selectedProvider === "cloudflare-realtime") {
    const cloudflare = session.cloudflareSession;
    if (!cloudflare) return false;
    if (!entry || entry.kind !== "video") {
      session.codecRoutingPlans.set(
        normalizedPlan.logicalStreamId,
        normalizedPlan,
      );
      session.codecRoutingCandidatePlans.delete(normalizedPlan.logicalStreamId);
      session.codecMigrationAcks.set(normalizedPlan.logicalStreamId, new Map());
      return true;
    }
    const previousPlan = session.codecRoutingPlans.get(
      normalizedPlan.logicalStreamId,
    );
    const activeCloudflareProducers = [
      ...(cloudflare.producers?.values() || []),
      ...(cloudflare.producerVariants?.values() || []),
    ].filter(
      (producer, index, producers) =>
        String(producer.logicalStreamId || "") ===
          normalizedPlan.logicalStreamId &&
        producers.indexOf(producer) === index,
    );
    const stableGeneration = Math.max(
      1,
      ...activeCloudflareProducers.map(
        (producer) => Number(producer.generation) || 1,
      ),
      Number(entry.generation) || 1,
    );
    const hasActiveGeneration = activeCloudflareProducers.length > 0;
    for (const variant of normalizedPlan.desiredVariants) {
      const variantId = String(variant.variantId || "");
      const existing = activeCloudflareProducers.find(
        (producer) => String(producer.variantId || "") === variantId,
      );
      const previousVariant = previousPlan?.desiredVariants.find(
        (candidate) => String(candidate.variantId || "") === variantId,
      );
      const requestedGeneration = Math.max(
        1,
        Math.floor(Number(variant.generation) || 1),
      );
      variant.generation =
        existing || previousVariant
          ? Math.max(
              requestedGeneration,
              Number(existing?.generation) ||
                Number(previousVariant?.generation) ||
                1,
            )
          : hasActiveGeneration
            ? Math.max(requestedGeneration, stableGeneration + 1)
            : requestedGeneration;
    }
    const preservedAcknowledgements = preserveStableMigrationAcknowledgements(
      session,
      normalizedPlan,
    );
    const previousAcknowledgements = session.codecMigrationAcks.get(
      normalizedPlan.logicalStreamId,
    );
    const previousAcknowledgementSnapshot = previousAcknowledgements
      ? new Map(previousAcknowledgements)
      : null;
    session.codecRoutingPlans.set(
      normalizedPlan.logicalStreamId,
      normalizedPlan,
    );
    session.codecMigrationAcks.set(
      normalizedPlan.logicalStreamId,
      preservedAcknowledgements,
    );
    const created: string[] = [];
    const metadataSnapshots: NativeSourceEntry[] = [];
    try {
      for (const variant of normalizedPlan.desiredVariants) {
        const target = variant.target ? { ...variant.target } : undefined;
        const variantEntry: NativeSourceEntry = {
          ...entry,
          logicalStreamId: normalizedPlan.logicalStreamId,
          generation: Math.max(1, Math.floor(Number(variant.generation) || 1)),
          variantId: String(variant.variantId || ""),
          codec: variant.codec,
          score: variant.score,
          receivers: [...variant.receivers],
          emergency: variant.emergency === true,
          routingScore: variant.score,
        };
        if (target) variantEntry.target = target;
        if (variant.targetAdjusted) variantEntry.targetAdjusted = true;
        if (target)
          for (const key of ["width", "height", "fps", "bitrate"] as const) {
            const value = Number(target[key]);
            if (Number.isFinite(value) && value > 0)
              variantEntry[key] = Math.floor(value);
          }
        const variantId = String(variant.variantId || "");
        if (
          cloudflare.hasVariant?.(variantId) &&
          cloudflare.updateVariantMetadata
        ) {
          const existing = activeCloudflareProducers.find(
            (producer) => String(producer.variantId || "") === variantId,
          );
          if (existing)
            metadataSnapshots.push(
              cloudflareProducerSnapshot(existing, source),
            );
          if ((await cloudflare.updateVariantMetadata(variantEntry)) === false)
            throw new Error(
              `Native Cloudflare variant update failed for ${variantId}`,
            );
        } else {
          if ((await cloudflare.addSource(variantEntry)) === false)
            throw new Error(
              `Native Cloudflare variant publish failed for ${variantId}`,
            );
          created.push(variantId);
        }
      }
    } catch (error) {
      for (const snapshot of metadataSnapshots.reverse()) {
        try {
          const restored = await cloudflare.updateVariantMetadata?.(snapshot);
          if (restored === false)
            throw new Error(
              `Native Cloudflare variant restore failed for ${snapshot.variantId || snapshot.source}`,
            );
        } catch (restoreError) {
          session.onError?.(
            asError(restoreError, "Native Cloudflare routing restore failed"),
          );
        }
      }
      for (const variantId of created) {
        try {
          const removed = await cloudflare.removeVariant?.(variantId, true);
          if (removed === false)
            throw new Error(
              `Native Cloudflare variant cleanup failed for ${variantId}`,
            );
        } catch (cleanupError) {
          session.onError?.(
            asError(cleanupError, "Native Cloudflare variant cleanup failed"),
          );
        }
      }
      if (previousPlan)
        session.codecRoutingPlans.set(
          normalizedPlan.logicalStreamId,
          previousPlan,
        );
      else session.codecRoutingPlans.delete(normalizedPlan.logicalStreamId);
      if (previousAcknowledgementSnapshot)
        session.codecMigrationAcks.set(
          normalizedPlan.logicalStreamId,
          previousAcknowledgementSnapshot,
        );
      else session.codecMigrationAcks.delete(normalizedPlan.logicalStreamId);
      session.onError?.(
        asError(error, "Native Cloudflare codec routing failed"),
      );
      return false;
    }
    session.codecRoutingCandidatePlans.delete(normalizedPlan.logicalStreamId);
    await retireReadyCodecVariants(session, normalizedPlan.logicalStreamId);
    return true;
  }
  if (!entry || entry.kind !== "video" || !session.sendTransport) {
    session.codecRoutingPlans.set(
      normalizedPlan.logicalStreamId,
      normalizedPlan,
    );
    return true;
  }
  const variants = normalizedPlan.desiredVariants.filter((variant) => {
    if (!isVideoCodecName(variant.codec)) return false;
    if (!deviceVideoCodecs(session).includes(variant.codec)) return false;
    const capability = capabilities.videoCodecs[variant.codec].encode;
    return Boolean(
      capability &&
      (isRealtimeEfficient(capability) ||
        (variant.emergency === true && isEmergencyUsable(capability))),
    );
  });
  if (variants.length !== normalizedPlan.desiredVariants.length) return false;
  const baseProducer = session.producers.get(source);
  const baseCodec = String(
    baseProducer?.entry.codec ||
      entry.codec ||
      preferredVideoCodec(session, entry) ||
      "",
  ).toUpperCase();
  const baseVariant = baseProducer
    ? variants.find(
        (variant) =>
          variant.codec === baseCodec &&
          (!baseProducer.entry.variantId ||
            String(variant.variantId || "") ===
              String(baseProducer.entry.variantId)),
      )
    : null;
  const variantsToPublish = baseVariant
    ? variants.filter((variant) => variant !== baseVariant)
    : variants;
  const updateVariantMetadata = (
    producer: NativeProducerEntry,
    variant: CodecRoutingPlan["desiredVariants"][number],
  ) => {
    producer.entry = {
      ...producer.entry,
      logicalStreamId: normalizedPlan.logicalStreamId,
      generation: Math.max(
        1,
        Math.floor(
          Number(variant.generation || producer.entry.generation) || 1,
        ),
      ),
      variantId: String(variant.variantId || producer.entry.variantId || ""),
      receivers: [...variant.receivers],
      target: variant.target ? { ...variant.target } : undefined,
      targetAdjusted: variant.targetAdjusted === true,
      emergency: variant.emergency === true,
      routingScore: Number.isFinite(Number(variant.score))
        ? Number(variant.score)
        : producer.entry.routingScore,
    };
  };
  const activeVariantProducers = [...session.producerVariants.values()].filter(
    (producer) =>
      producer.entry.logicalStreamId === normalizedPlan.logicalStreamId,
  );
  const stableGeneration = Math.max(
    1,
    ...activeVariantProducers.map(
      (producer) => Number(producer.entry.generation) || 1,
    ),
    Number(baseProducer?.entry.generation) || 1,
    Number(entry.generation) || 1,
  );
  const hasActiveGeneration = Boolean(
    baseProducer || activeVariantProducers.length,
  );
  for (const variant of variants) {
    const id = variantKey(
      source,
      String(variant.variantId || ""),
      variant.codec,
    );
    const existingVariant = session.producerVariants.get(id);
    const isExistingBase = Boolean(baseVariant && variant === baseVariant);
    const requestedGeneration = Math.max(
      1,
      Math.floor(Number(variant.generation) || 1),
    );
    variant.generation =
      existingVariant || isExistingBase
        ? Math.max(
            requestedGeneration,
            Number(existingVariant?.entry.generation) ||
              Number(baseProducer?.entry.generation) ||
              1,
          )
        : hasActiveGeneration
          ? Math.max(requestedGeneration, stableGeneration + 1)
          : requestedGeneration;
  }
  const preservedAcknowledgements = preserveStableMigrationAcknowledgements(
    session,
    normalizedPlan,
  );
  const previousAcknowledgements = session.codecMigrationAcks.get(
    normalizedPlan.logicalStreamId,
  );
  const previousAcknowledgementSnapshot = previousAcknowledgements
    ? new Map(previousAcknowledgements)
    : null;
  const previousPlan = session.codecRoutingPlans.get(
    normalizedPlan.logicalStreamId,
  );
  session.codecRoutingPlans.set(normalizedPlan.logicalStreamId, normalizedPlan);
  session.codecMigrationAcks.set(
    normalizedPlan.logicalStreamId,
    preservedAcknowledgements,
  );
  const created: string[] = [];
  const metadataSnapshots: Array<{
    producer: NativeProducerEntry;
    entry: NativeSourceEntry;
    variant: CodecRoutingPlan["desiredVariants"][number];
  }> = [];
  if (baseProducer && baseVariant)
    metadataSnapshots.push({
      producer: baseProducer,
      entry: cloneNativeSourceEntry(baseProducer.entry),
      variant: routingVariantFromProducerEntry(baseProducer.entry),
    });
  for (const variant of variantsToPublish) {
    const id = variantKey(
      source,
      String(variant.variantId || ""),
      variant.codec,
    );
    const existing = session.producerVariants.get(id);
    if (existing)
      metadataSnapshots.push({
        producer: existing,
        entry: cloneNativeSourceEntry(existing.entry),
        variant: routingVariantFromProducerEntry(existing.entry),
      });
  }
  try {
    for (const variant of variantsToPublish) {
      const id = variantKey(
        source,
        String(variant.variantId || ""),
        variant.codec,
      );
      if (session.producerVariants.has(id)) continue;
      const producer = await session.publishVariant(source, {
        ...variant,
        variantId: id,
        generation: variant.generation,
      });
      if (!producer) throw new Error(`Codec variant ${id} was not published`);
      created.push(id);
    }
    if (baseProducer && baseVariant) {
      updateVariantMetadata(baseProducer, baseVariant);
      if (
        !(await applyProducerTarget(session, baseProducer, entry, baseVariant))
      )
        throw new Error("Native base codec target update failed");
    }
    for (const variant of variantsToPublish) {
      const id = variantKey(
        source,
        String(variant.variantId || ""),
        variant.codec,
      );
      const existing = session.producerVariants.get(id);
      if (existing) {
        updateVariantMetadata(existing, variant);
        if (!(await applyProducerTarget(session, existing, entry, variant)))
          throw new Error(`Native codec target update failed for ${id}`);
      }
    }
    session.codecRoutingCandidatePlans.delete(normalizedPlan.logicalStreamId);
    session._sendSourceState();
    const producerIds: NativeMediaPublication[] = [];
    if (baseProducer) {
      const publication: NativeMediaPublication = {
        id: baseProducer.id,
        variantId: baseVariant?.variantId || null,
        codec: baseCodec,
        base: true,
        receivers: baseVariant?.receivers || [],
        emergency: baseVariant?.emergency === true,
        score: baseVariant?.score,
      };
      if (baseVariant?.target) publication.target = { ...baseVariant.target };
      if (baseVariant?.targetAdjusted) publication.targetAdjusted = true;
      producerIds.push(publication);
    }
    for (const producer of [...session.producerVariants.values()].filter(
      (candidate) =>
        candidate.entry.logicalStreamId === normalizedPlan.logicalStreamId,
    )) {
      const publication: NativeMediaPublication = {
        id: producer.id,
        variantId: producer.entry.variantId,
        codec: producer.entry.codec,
        receivers: producer.entry.receivers || [],
        emergency: producer.entry.emergency === true,
        score: producer.entry.routingScore,
      };
      if (producer.entry.target) publication.target = producer.entry.target;
      if (producer.entry.targetAdjusted) publication.targetAdjusted = true;
      producerIds.push(publication);
    }
    session.signaling?.send?.({
      type: "codec-routing-applied",
      data: {
        ...normalizedPlan,
        source,
        producerIds,
      },
    });
    await retireReadyCodecVariants(session, normalizedPlan.logicalStreamId);
    session._emitState();
    return true;
  } catch (error) {
    for (const snapshot of metadataSnapshots.reverse()) {
      snapshot.producer.entry = snapshot.entry;
      try {
        if (
          !(await applyProducerTarget(
            session,
            snapshot.producer,
            entry,
            snapshot.variant,
          ))
        )
          throw new Error(
            `Native codec metadata restore failed for ${snapshot.producer.id}`,
          );
      } catch (restoreError) {
        session.onError?.(
          asError(restoreError, "Native codec routing restore failed"),
        );
      }
    }
    for (const id of created) {
      try {
        if (!(await session.removeVariant(id, true)))
          throw new Error(`Native codec variant cleanup failed for ${id}`);
      } catch (cleanupError) {
        session.onError?.(
          asError(cleanupError, "Native codec variant cleanup failed"),
        );
      }
    }
    if (previousPlan)
      session.codecRoutingPlans.set(
        normalizedPlan.logicalStreamId,
        previousPlan,
      );
    else session.codecRoutingPlans.delete(normalizedPlan.logicalStreamId);
    if (previousAcknowledgementSnapshot)
      session.codecMigrationAcks.set(
        normalizedPlan.logicalStreamId,
        previousAcknowledgementSnapshot,
      );
    else session.codecMigrationAcks.delete(normalizedPlan.logicalStreamId);
    session._sendSourceState();
    session._emitState();
    session.onError?.(asError(error, "Native codec routing plan failed"));
    return false;
  }
}

export class NativeMediasoupSourcesMethods {
  handleCodecMigrationState(
    this: NativeMediasoupSfuSession,
    data: Record<string, unknown>,
  ) {
    return handleCodecMigrationState(this, data);
  }

  async addSource(this: NativeMediasoupSfuSession, entry: NativeSourceEntry) {
    if (!entry?.source)
      throw new Error("A native source identifier is required");
    if (this.selectedProvider === "cloudflare-realtime") {
      const source = String(entry.source);
      let activation = this.providerActivationPromise;
      if (
        this.activeSfuProvider !== "cloudflare-realtime" ||
        !this.cloudflareSession?.sessionId
      ) {
        this.sources.set(source, entry);
        if (!activation && !this.closed)
          activation = this.activateProvider("cloudflare-realtime");
        if (activation) await activation;
        if (
          this.activeSfuProvider !== "cloudflare-realtime" ||
          !this.cloudflareSession?.sessionId
        )
          throw new Error("Cloudflare media provider is not active");
        const existing = entry.variantId
          ? [...this.producerVariants.values()].find(
              (producer) =>
                String(producer.variantId || "") ===
                String(entry.variantId || ""),
            )
          : this.producers.get(source);
        if (existing) return existing;
      }
      const cloudflare = this._createCloudflareSession();
      const logicalStreamId =
        entry.logicalStreamId || `source:${String(entry.source)}`;
      const plan = this.codecRoutingPlans.get(logicalStreamId);
      if (!plan?.desiredVariants.length) return cloudflare.addSource(entry);
      let result: MediaCommandResult = null;
      const created: string[] = [];
      try {
        for (const variant of plan.desiredVariants) {
          const target = variant.target ? { ...variant.target } : undefined;
          const variantId = String(variant.variantId || "");
          const variantEntry: NativeSourceEntry = {
            ...entry,
            logicalStreamId,
            codec: variant.codec,
            variantId,
            generation: Math.max(
              1,
              Math.floor(Number(variant.generation) || 1),
            ),
            receivers: [...variant.receivers],
            emergency: variant.emergency === true,
            routingScore: variant.score,
          };
          if (target) variantEntry.target = target;
          if (variant.targetAdjusted) variantEntry.targetAdjusted = true;
          if (target)
            for (const key of ["width", "height", "fps", "bitrate"] as const) {
              const value = Number(target[key]);
              if (Number.isFinite(value) && value > 0)
                variantEntry[key] = Math.floor(value);
            }
          result = await cloudflare.addSource(variantEntry);
          created.push(variantId);
        }
        return result;
      } catch (error) {
        await Promise.all(
          created.map((variantId) =>
            cloudflare.removeVariant?.(variantId, true),
          ),
        );
        throw error;
      }
    }
    const source = String(entry.source);
    return this.enqueueSourceOperation(source, () =>
      this.addSourceInternal(entry),
    );
  }

  enqueueSourceOperation(
    this: NativeMediasoupSfuSession,
    source: string,
    operation: () => Promise<MediaCommandResult>,
  ) {
    const previous = this.sourceOperations.get(source) || Promise.resolve();
    const task = previous.catch(() => {}).then(operation);
    const tracked = task.finally(() => {
      if (this.sourceOperations.get(source) === tracked)
        this.sourceOperations.delete(source);
    });
    this.sourceOperations.set(source, tracked);
    tracked.catch(() => {});
    return tracked;
  }

  async addSourceInternal(
    this: NativeMediasoupSfuSession,
    entry: NativeSourceEntry,
  ) {
    if (!entry?.source)
      throw new Error("A native source identifier is required");
    const previousSource = this.sources.get(entry.source);
    const existing = this.producers.get(entry.source);
    const kind =
      entry.kind ||
      (entry.source === "camera" || entry.source === "screen"
        ? "video"
        : "audio");
    const normalized: NativeSourceEntry = {
      ...entry,
      kind,
      audioBitrate: entry.audioBitrate ?? this.getAudioBitrate?.(entry.source),
      audioStereo:
        entry.audioStereo ?? this.getAudioStereo?.(entry.source) ?? undefined,
      videoSettings:
        entry.videoSettings || this.getVideoSettings?.(entry.source) || null,
      logicalStreamId:
        entry.logicalStreamId ||
        (kind === "audio" ? null : defaultLogicalStreamId(entry.source)),
      codec: kind === "video" ? entry.codec || null : null,
      codecAcceleration:
        kind === "video" ? entry.codecAcceleration || null : null,
      codecImplementation:
        kind === "video" ? entry.codecImplementation || null : null,
      producerKey: entry.producerKey || null,
    };
    if (kind === "video") {
      const logicalStreamId = String(normalized.logicalStreamId || "");
      const requestedCodec = normalizeVideoCodecName(entry.codec);
      const requestedVariantId = entry.variantId
        ? String(entry.variantId)
        : null;
      const planned = plannedBaseVariant(
        this,
        logicalStreamId,
        requestedCodec,
        requestedVariantId,
      );
      const requestedCapability = requestedCodec
        ? normalizeParticipantMediaCapabilities(this.mediaCapabilities)
            .videoCodecs[requestedCodec].encode
        : null;
      const requestedIsSafe = Boolean(
        requestedCodec &&
        requestedCapability &&
        (isRealtimeEfficient(requestedCapability) ||
          (entry.emergency === true && isEmergencyUsable(requestedCapability))),
      );
      normalized.codec =
        String(
          planned?.codec ||
            (requestedIsSafe ? requestedCodec : null) ||
            preferredVideoCodec(this, entry) ||
            "",
        ).toUpperCase() || null;
      Object.assign(normalized, nativeVideoMetadata(normalized));
      if (planned) {
        normalized.variantId = String(
          planned.variantId ||
            defaultVariantId(logicalStreamId, normalized.codec) ||
            "",
        );
        normalized.receivers = [...planned.receivers];
        normalized.emergency = planned.emergency === true;
        normalized.routingScore = planned.score;
        if (planned.target) {
          normalized.target = { ...planned.target };
          normalized.targetAdjusted = planned.targetAdjusted === true;
          for (const key of ["width", "height", "fps", "bitrate"] as const) {
            const value = Number(planned.target[key]);
            if (Number.isFinite(value) && value > 0)
              normalized[key] = Math.floor(value);
          }
        }
      }
    }
    normalized.variantId =
      normalized.kind === "video"
        ? normalized.variantId ||
          entry.variantId ||
          defaultVariantId(
            String(normalized.logicalStreamId),
            String(normalized.codec || "") || null,
          )
        : entry.variantId || null;
    if (normalized.kind === "video" && isVideoCodecName(normalized.codec)) {
      const capability = normalizeParticipantMediaCapabilities(
        this.mediaCapabilities,
      ).videoCodecs[normalized.codec].encode;
      normalized.codecAcceleration =
        entry.codecAcceleration || capability.acceleration;
      normalized.codecImplementation =
        entry.codecImplementation || capability.implementation || null;
    }
    if (existing) {
      try {
        await this.invoke("media_replace_producer_track", {
          producerId: existing.id,
          source: normalized.source,
          kind: normalized.kind,
        });
      } catch (error) {
        if (previousSource) this.sources.set(entry.source, previousSource);
        throw error;
      }
      const paused = this.sourceTransmission.get(normalized.source) === false;
      if (existing.paused !== paused) {
        await this.invoke("media_set_producer_paused", {
          source: normalized.source,
          paused,
        });
        existing.paused = paused;
      }
      existing.entry = normalized;
      this.sources.set(entry.source, normalized);
      if (normalized.kind === "video")
        this.localVideoFeeds.set(normalized.source, {
          source: normalized.source,
          producerId: existing.id || `local:${normalized.source}`,
          native: true,
          frame: null,
        });
      this._sendSourceState();
      this._emitState();
      this.scheduleCodecRoutingEvaluation();
      return existing;
    }
    this.sources.set(entry.source, normalized);
    if (
      normalized.kind === "video" &&
      !this.localVideoFeeds.has(normalized.source)
    ) {
      this.localVideoFeeds.set(normalized.source, {
        source: normalized.source,
        producerId: `local:${normalized.source}`,
        native: true,
        frame: null,
      });
    }
    if (!this.sendTransport) {
      this._emitState();
      return null;
    }
    const previousFeed = this.localVideoFeeds.get(normalized.source);
    let producer;
    try {
      producer = await this.publish(normalized);
    } catch (error) {
      if (previousSource) this.sources.set(entry.source, previousSource);
      else this.sources.delete(entry.source);
      if (previousFeed)
        this.localVideoFeeds.set(normalized.source, previousFeed);
      else this.localVideoFeeds.delete(normalized.source);
      throw error;
    }
    if (normalized.kind === "video") {
      this.localVideoFeeds.set(normalized.source, {
        source: normalized.source,
        producerId: producer?.id || `local:${normalized.source}`,
        native: true,
        frame: null,
      });
    }
    this._emitState();
    this.scheduleCodecRoutingEvaluation();
    return producer;
  }

  async _republishSources(this: NativeMediasoupSfuSession) {
    for (const entry of this.sources.values()) {
      if (!this.producers.has(entry.source)) {
        const producer = await this.publish(entry);
        if (entry.kind === "video") {
          this.localVideoFeeds.set(entry.source, {
            source: entry.source,
            producerId: producer?.id || `local:${entry.source}`,
            native: true,
            frame: null,
          });
        }
      }
    }
    for (const plan of this.codecRoutingPlans.values())
      await this.applyCodecRoutingPlan(plan);
    this.scheduleCodecRoutingEvaluation();
    this._emitState();
  }

  scheduleCodecRoutingEvaluation(this: NativeMediasoupSfuSession) {
    if (
      this.closed ||
      !["mediasoup", "cloudflare-realtime"].includes(this.selectedProvider) ||
      !this.mediaCapabilities ||
      !this.localPeerId ||
      (!this.lastInRoom.length &&
        !this.codecRoutingPlans.size &&
        !this.producerVariants.size)
    )
      return false;
    if (this.codecRoutingEvaluationTimer)
      clearTimeout(this.codecRoutingEvaluationTimer);
    const timer = setTimeout(() => {
      this.codecRoutingEvaluationTimer = null;
      if (this.codecRoutingEvaluationOperation) return;
      const operation = this.evaluateCodecRoutingPlans()
        .catch((error) => {
          this.onError?.(
            asError(error, "Native codec routing evaluation failed"),
          );
        })
        .finally(() => {
          if (this.codecRoutingEvaluationOperation === operation)
            this.codecRoutingEvaluationOperation = null;
        });
      this.codecRoutingEvaluationOperation = operation;
    }, 150);
    timer.unref?.();
    this.codecRoutingEvaluationTimer = timer;
    return true;
  }

  async evaluateCodecRoutingPlans(this: NativeMediasoupSfuSession) {
    if (
      this.closed ||
      !["mediasoup", "cloudflare-realtime"].includes(this.selectedProvider) ||
      !this.mediaCapabilities ||
      !this.localPeerId
    )
      return false;
    const receivers = routingParticipants(this);
    if (!receivers) return false;
    if (!receivers.length) {
      const plans = [...this.codecRoutingPlans.values()];
      this.codecRoutingPlans.clear();
      this.codecRoutingCandidatePlans.clear();
      this.codecMigrationAcks.clear();
      if (this.selectedProvider === "cloudflare-realtime") {
        let retired = false;
        for (const plan of plans)
          retired =
            Boolean(
              await this.cloudflareSession?.retireVariants?.(
                plan.logicalStreamId,
                [],
              ),
            ) || retired;
        return retired;
      }
      const variants = [...this.producerVariants.values()].filter(
        (producer) =>
          !isVariantMigrationActive(this, producer.entry.variantId || ""),
      );
      await Promise.all(
        variants.map((producer) =>
          this.removeVariant(producer.producerKey || ""),
        ),
      );
      return variants.length > 0;
    }
    let applied = false;
    for (const entry of this.sources.values()) {
      if (entry.kind !== "video") continue;
      const logicalStreamId = String(
        entry.logicalStreamId || defaultLogicalStreamId(entry.source),
      );
      const target = routingTarget(entry);
      const routingOptions: NativeCodecRoutingOptions = {
        allowEmergencySoftware: true,
        allowTargetAdaptation: true,
        sfuSupportedCodecs: deviceVideoCodecs(this),
      };
      if (target) routingOptions.target = target;
      const plan = createCodecRoutingPlan(
        {
          participantId: this.localPeerId,
          logicalStreamId,
          source: entry.source,
          mediaCapabilities: this.mediaCapabilities,
        },
        receivers,
        routingOptions,
      );
      if (
        !plan.desiredVariants.length ||
        plan.uncoveredReceivers.length ||
        !routingPlanNeedsApplication(this, entry.source, plan)
      )
        continue;
      if (!routingPlanStableForApplication(this, plan)) {
        this.scheduleCodecRoutingEvaluation();
        continue;
      }
      if (await this.applyCodecRoutingPlan(plan)) applied = true;
    }
    return applied;
  }

  async publish(
    this: NativeMediasoupSfuSession,
    entry: NativeSourceEntry,
  ): Promise<NativeProducerEntry | null> {
    if (!this.sendTransport || this.producers.has(entry.source))
      return this.producers.get(entry.source) || null;
    const activePublication = this.sourcePublications.get(entry.source);
    if (activePublication) return activePublication;
    const publication = this._publishSource(entry).finally(() => {
      if (this.sourcePublications.get(entry.source) === publication)
        this.sourcePublications.delete(entry.source);
    });
    this.sourcePublications.set(entry.source, publication);
    return publication;
  }

  async _publishSource(
    this: NativeMediasoupSfuSession,
    entry: NativeSourceEntry,
  ): Promise<NativeProducerEntry | null> {
    const mediaRevision = this.mediaRevision;
    const kind =
      entry.kind ||
      (entry.source === "camera" || entry.source === "screen"
        ? "video"
        : "audio");
    const effectiveEntry: NativeSourceEntry = {
      ...entry,
      kind,
    };
    if (kind === "video")
      effectiveEntry.codec = preferredVideoCodec(this, entry);
    const key = producerKey(effectiveEntry);
    const registry = effectiveEntry.producerKey
      ? this.producerVariants
      : this.producers;
    await this.producerRemovals.get(key);
    if (registry.has(key)) return registry.get(key) || null;
    const codecParameters: Record<string, unknown> | null =
      kind === "video" && effectiveEntry.codec && this.device?.rtpCapabilities
        ? recordArray(this.device.rtpCapabilities.codecs).find((candidate) => {
            const candidateRecord = recordValue(candidate);
            const mimeType = String(
              candidateRecord.mimeType || candidateRecord.mime_type || "",
            ).toUpperCase();
            return (
              mimeType === `VIDEO/${String(effectiveEntry.codec).toUpperCase()}`
            );
          }) || null
        : null;
    const appData = {
      ...nativeProducerAppData(effectiveEntry, kind),
    };
    if (codecParameters) appData.codecParameters = codecParameters;
    if (kind === "video" && effectiveEntry.codec) {
      const normalizedCapabilities = normalizeParticipantMediaCapabilities(
        this.mediaCapabilities,
      );
      const codec = String(effectiveEntry.codec).toUpperCase();
      const capability = isVideoCodecName(codec)
        ? normalizedCapabilities.videoCodecs[codec]
        : null;
      if (capability) {
        appData.codecAcceleration = capability.encode.acceleration;
        appData.codecImplementation = capability.encode.implementation || null;
      }
    }
    const previousDirection = this.pendingNativeDirection;
    this.pendingNativeDirection = "send";
    try {
      const request: NativeMediasoupProducerRequest = {
        kind,
        appData,
      };
      if (effectiveEntry.producerKey) request.producerKey = key;
      const result = await this.invoke(
        "media_create_capture_producer",
        request,
      );
      const producer: NativeProducerEntry = {
        id: String(result?.id || ""),
        source: effectiveEntry.source,
        kind,
        entry: effectiveEntry,
        paused: false,
        producerKey: key,
      };
      if (!producer.id)
        throw new Error("Native producer did not return an identifier");
      if (this.closed || mediaRevision !== this.mediaRevision) {
        const request: NativeMediasoupProducerRequest = {
          source: effectiveEntry.source,
        };
        if (effectiveEntry.producerKey) request.producerKey = key;
        await this.invoke("media_remove_capture_producer", request).catch(
          () => {},
        );
        return null;
      }
      registry.set(key, producer);
      if (this.sourceTransmission.get(effectiveEntry.source) === false) {
        const request: NativeMediasoupProducerRequest = {
          source: effectiveEntry.source,
          paused: true,
        };
        if (effectiveEntry.producerKey) request.producerKey = key;
        await this.invoke("media_set_producer_paused", request);
        producer.paused = true;
      }
      this._sendSourceState();
      this._emitState();
      return producer;
    } finally {
      this.pendingNativeDirection = previousDirection;
    }
  }

  async publishVariant(
    this: NativeMediasoupSfuSession,
    source: string,
    variant: {
      codec: string;
      variantId?: string;
      generation?: number;
      receivers?: string[];
      emergency?: boolean;
      score?: number;
      target?: CodecRoutingTarget;
      targetAdjusted?: boolean;
    },
  ) {
    const normalizedSource = String(source || "");
    const current = this.sources.get(normalizedSource);
    const codec = String(variant.codec || "").toUpperCase();
    if (
      !current ||
      current.kind !== "video" ||
      !codec ||
      !this.sendTransport ||
      !isVideoCodecName(codec) ||
      !deviceVideoCodecs(this).includes(codec)
    )
      return null;
    const capability = normalizeParticipantMediaCapabilities(
      this.mediaCapabilities,
    ).videoCodecs[codec].encode;
    if (
      !isRealtimeEfficient(capability) &&
      !(variant.emergency === true && isEmergencyUsable(capability))
    )
      return null;
    const id = variantKey(
      normalizedSource,
      String(variant.variantId || ""),
      codec,
    );
    const existing = this.producerVariants.get(id);
    if (existing) return existing;
    const entry: NativeSourceEntry = {
      ...current,
      logicalStreamId: current.logicalStreamId || `source:${normalizedSource}`,
      generation: Math.max(
        1,
        Math.floor(Number(variant.generation || current.generation) || 1),
      ),
      variantId: id,
      codec,
      receivers: Array.isArray(variant.receivers)
        ? [...variant.receivers]
        : current.receivers,
      emergency: variant.emergency === true,
      routingScore: Number.isFinite(Number(variant.score))
        ? Number(variant.score)
        : current.routingScore,
      producerKey: id,
    };
    if (variant.target) entry.target = { ...variant.target };
    if (variant.targetAdjusted) entry.targetAdjusted = true;
    if (variant.target) {
      for (const key of ["width", "height", "fps", "bitrate"] as const) {
        const value = Number(variant.target[key]);
        if (Number.isFinite(value) && value > 0) entry[key] = Math.floor(value);
      }
    }
    if (isVideoCodecName(codec)) {
      entry.codecAcceleration = capability.acceleration;
      entry.codecImplementation = capability.implementation || null;
    }
    return this._publishSource(entry);
  }

  async removeVariant(
    this: NativeMediasoupSfuSession,
    variantId: string,
    force = false,
  ) {
    const key = String(variantId || "");
    const producer = this.producerVariants.get(key);
    if (!producer) return false;
    if (
      !force &&
      (isVariantStillPlanned(this, key) || isVariantMigrationActive(this, key))
    )
      return false;
    this.producerVariants.delete(key);
    const closeMessage = {
      type: "close-producer",
      data: {
        producerId: producer.id,
        logicalStreamId: producer.entry.logicalStreamId || null,
        variantId: key,
      },
    };
    let sent: boolean | void = undefined;
    if (this.providerSignaling?.send)
      sent = this.providerSignaling.send(closeMessage);
    else if (!this.controlTicket) sent = this.signaling?.send(closeMessage);
    const removal = this.invoke("media_remove_capture_producer", {
      source: producer.source,
      producerKey: key,
    })
      .catch((error) =>
        this.onError?.(asError(error, "Native codec variant close failed")),
      )
      .finally(() => {
        if (this.producerRemovals.get(key) === removal)
          this.producerRemovals.delete(key);
      });
    this.producerRemovals.set(key, removal);
    if (sent === false) this._closeMedia(false).catch(() => {});
    return removal;
  }

  async applyCodecRoutingPlan(
    this: NativeMediasoupSfuSession,
    plan: CodecRoutingPlan,
  ) {
    if (!plan || !Array.isArray(plan.desiredVariants)) return false;
    const source = sourceForPlan(plan);
    return this.enqueueSourceOperation(source || plan.logicalStreamId, () =>
      applyCodecRoutingPlanInternal(this, plan),
    );
  }

  removeSource(this: NativeMediasoupSfuSession, source: string) {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.removeSource(source);
    const key = String(source || "");
    return this.enqueueSourceOperation(key, () =>
      this.removeSourceInternal(key),
    );
  }

  async removeSourceInternal(
    this: NativeMediasoupSfuSession,
    source: string,
  ): Promise<MediaCommandResult> {
    const entry = this.sources.get(source);
    this.sources.delete(source);
    this.localVideoFeeds.delete(source);
    const producer = this.producers.get(source);
    const variants = [...this.producerVariants.values()].filter(
      (candidate) => candidate.source === source,
    );
    for (const [logicalStreamId, plan] of this.codecRoutingPlans)
      if (sourceForPlan(plan) === source)
        this.codecRoutingPlans.delete(logicalStreamId);
    let controlUnavailable = false;
    if (producer) {
      this.producers.delete(source);
      const closeMessage = {
        type: "close-producer",
        data: { producerId: producer.id },
      };
      let sent: boolean | void = undefined;
      if (this.providerSignaling?.send)
        sent = this.providerSignaling.send(closeMessage);
      else if (!this.controlTicket) sent = this.signaling?.send(closeMessage);
      const producerKey = String(
        producer.producerKey || producer.entry.producerKey || source,
      );
      const removalRequest: NativeMediasoupProducerRequest = {
        source,
      };
      if (producerKey !== source) removalRequest.producerKey = producerKey;
      const removal = this.invoke(
        "media_remove_capture_producer",
        removalRequest,
      )
        .catch((error) =>
          this.onError?.(asError(error, "Native producer close failed")),
        )
        .finally(() => {
          if (this.producerRemovals.get(source) === removal)
            this.producerRemovals.delete(source);
        });
      this.producerRemovals.set(source, removal);
      controlUnavailable = sent === false;
    }
    await Promise.all(
      variants.map((candidate) =>
        this.removeVariant(candidate.producerKey || ""),
      ),
    );
    this._sendSourceState();
    this._emitState();
    if (controlUnavailable) {
      this._closeMedia(false).catch(() => {});
      await this.producerRemovals.get(source);
      throw new Error("Media control is unavailable");
    }
    return this.producerRemovals.get(source) || Promise.resolve(entry || null);
  }

  async setSourceTransmission(
    this: NativeMediasoupSfuSession,
    source: string,
    enabled: boolean,
  ) {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.setSourceTransmission(source, enabled);
    const normalizedSource = String(source || "");
    const nextEnabled = Boolean(enabled);
    this.sourceTransmission.set(normalizedSource, nextEnabled);
    const producer = this.producers.get(normalizedSource);
    const targets = [
      ...(producer ? [producer] : []),
      ...[...this.producerVariants.values()].filter(
        (candidate) => candidate.source === normalizedSource,
      ),
    ];
    if (!targets.length) return false;
    await Promise.all(
      targets.map(async (target) => {
        const request: NativeMediasoupProducerRequest = {
          source: normalizedSource,
          paused: !nextEnabled,
        };
        if (target.producerKey !== normalizedSource)
          request.producerKey = target.producerKey;
        await this.invoke("media_set_producer_paused", request);
        target.paused = !nextEnabled;
      }),
    );
    this._emitState();
    return true;
  }

  async updateAudioBitrate(
    this: NativeMediasoupSfuSession,
    source: string,
    maxBitrate: number,
  ) {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.updateAudioBitrate(source, maxBitrate);
    const producer = this.producers.get(String(source || ""));
    const bitrate = Number(maxBitrate);
    if (
      !producer ||
      producer.kind !== "audio" ||
      !Number.isFinite(bitrate) ||
      bitrate <= 0
    )
      return false;
    const parameters = {
      maxBitrate: Math.floor(bitrate),
      priority: "high",
      networkPriority: "high",
      dtx: false,
    };
    await Promise.all(
      [
        producer,
        ...[...this.producerVariants.values()].filter(
          (candidate) => candidate.source === producer.source,
        ),
      ].map((target) => {
        const request: NativeMediasoupProducerRequest = {
          source: target.source,
          parameters,
        };
        if (target.producerKey !== target.source)
          request.producerKey = target.producerKey;
        return this.invoke("media_set_producer_parameters", request);
      }),
    );
    return true;
  }

  async updateVideoBitrate(
    this: NativeMediasoupSfuSession,
    source: string,
    maxBitrate: number,
  ) {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.updateVideoBitrate(source, maxBitrate);
    const producer = this.producers.get(String(source || ""));
    const bitrate = Number(maxBitrate);
    if (
      !producer ||
      producer.kind !== "video" ||
      !Number.isFinite(bitrate) ||
      bitrate <= 0
    )
      return false;
    await Promise.all(
      [
        producer,
        ...[...this.producerVariants.values()].filter(
          (candidate) => candidate.source === producer.source,
        ),
      ].map((target) => {
        const request: NativeMediasoupProducerRequest = {
          source: target.source,
          parameters: { maxBitrate: Math.floor(bitrate) },
        };
        if (target.producerKey !== target.source)
          request.producerKey = target.producerKey;
        return this.invoke("media_set_producer_parameters", request);
      }),
    );
    return true;
  }

  async updateVideoParameters(
    this: NativeMediasoupSfuSession,
    source: string,
    parameters: Record<string, unknown>,
  ) {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.updateVideoParameters(source, parameters);
    const producer = this.producers.get(String(source || ""));
    if (!producer || producer.kind !== "video") return false;
    const updates = Object.fromEntries(
      Object.entries(parameters || {}).filter(([key, value]) => {
        if (key === "maxFramerate")
          return Number.isFinite(Number(value)) && Number(value) > 0;
        if (key === "scaleResolutionDownBy")
          return Number.isFinite(Number(value)) && Number(value) >= 1;
        if (key === "maxBitrate")
          return Number.isFinite(Number(value)) && Number(value) > 0;
        return false;
      }),
    );
    if (Object.keys(updates).length === 0) return false;
    await Promise.all(
      [
        producer,
        ...[...this.producerVariants.values()].filter(
          (candidate) => candidate.source === producer.source,
        ),
      ].map((target) => {
        const request: NativeMediasoupProducerRequest = {
          source: target.source,
          parameters: updates,
        };
        if (target.producerKey !== target.source)
          request.producerKey = target.producerKey;
        return this.invoke("media_set_producer_parameters", request);
      }),
    );
    return true;
  }

  _sendSourceState(this: NativeMediasoupSfuSession) {
    if (!this.signaling && !this.providerSignaling) return;
    const publications = [...this.producers.values()].map((producer) => {
      const plan = [...this.codecRoutingPlans.values()].find(
        (candidate) =>
          candidate.logicalStreamId === producer.entry.logicalStreamId,
      );
      const plannedVariant = plan?.desiredVariants.find(
        (candidate) =>
          String(candidate.codec).toUpperCase() ===
          String(producer.entry.codec || "").toUpperCase(),
      );
      const publication: NativeMediaPublication = {
        producerId: producer.id,
        source: producer.source,
        logicalStreamId: producer.entry.logicalStreamId || null,
        generation: producer.entry.generation || 1,
        variantId:
          plannedVariant?.variantId || producer.entry.variantId || null,
        codec: producer.entry.codec || null,
        codecAcceleration: producer.entry.codecAcceleration || null,
        codecImplementation: producer.entry.codecImplementation || null,
        width: producer.entry.width || null,
        height: producer.entry.height || null,
        fps: producer.entry.fps || null,
        bitrate: producer.entry.bitrate || null,
        receivers: plannedVariant?.receivers || producer.entry.receivers || [],
        emergency:
          plannedVariant?.emergency === true ||
          producer.entry.emergency === true,
        score: plannedVariant?.score ?? producer.entry.routingScore,
        base: true,
      };
      const target = plannedVariant?.target || producer.entry.target;
      if (target) publication.target = { ...target };
      if (plannedVariant?.targetAdjusted || producer.entry.targetAdjusted)
        publication.targetAdjusted = true;
      return publication;
    });
    publications.push(
      ...[...this.producerVariants.values()].map((producer) => {
        const plan = [...this.codecRoutingPlans.values()].find(
          (candidate) =>
            candidate.logicalStreamId === producer.entry.logicalStreamId,
        );
        const plannedVariant = plan?.desiredVariants.find(
          (candidate) =>
            String(candidate.variantId || "") ===
            String(producer.entry.variantId || ""),
        );
        const publication: NativeMediaPublication = {
          producerId: producer.id,
          source: producer.source,
          logicalStreamId: producer.entry.logicalStreamId || null,
          generation: producer.entry.generation || 1,
          variantId: producer.entry.variantId || null,
          codec: producer.entry.codec || null,
          codecAcceleration: producer.entry.codecAcceleration || null,
          codecImplementation: producer.entry.codecImplementation || null,
          width: producer.entry.width || null,
          height: producer.entry.height || null,
          fps: producer.entry.fps || null,
          bitrate: producer.entry.bitrate || null,
          receivers:
            plannedVariant?.receivers || producer.entry.receivers || [],
          emergency:
            plannedVariant?.emergency === true ||
            producer.entry.emergency === true,
          score: plannedVariant?.score ?? producer.entry.routingScore,
          base: false,
        };
        const target = plannedVariant?.target || producer.entry.target;
        if (target) publication.target = { ...target };
        if (plannedVariant?.targetAdjusted || producer.entry.targetAdjusted)
          publication.targetAdjusted = true;
        return publication;
      }),
    );
    this.signaling?.send?.({
      type: "media-sources",
      data: {
        sources: [...this.sources.keys()],
        publications,
        variants: publications.filter(
          (publication) => publication.base !== true,
        ),
      },
    });
    for (const publication of publications)
      this.providerSignaling?.send?.({
        type: "update-producer-metadata",
        data: publication,
      });
  }
}
