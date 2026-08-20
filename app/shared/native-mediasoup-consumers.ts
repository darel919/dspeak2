import {
  asError,
  nativeRemoteFeedKey,
  waitFor,
} from "./native-mediasoup-utils.ts";
import { isPairedScreenAudio } from "./media-source-ownership.ts";
import {
  candidateFrameCount,
  createCodecMigrationTelemetry,
  isPresentableVideoFrame,
  logicalVideoStreamId,
} from "./video-codec-migration.ts";
import {
  efficientDecodeCodecs,
  efficiencyRank,
  isEmergencyUsable,
  isRealtimeEfficient,
  normalizeVideoCodecName,
} from "./types/video-codec-capabilities.ts";
import { supportsCodecDirectionTarget } from "./video-codec-routing.ts";
import type { NativeConsumerEntry } from "./types/native-mediasoup.ts";
import type { NativeMediasoupSfuSession } from "./native-mediasoup-session.ts";

export const NATIVE_CODEC_MIGRATION_TIMEOUT_MS = 5000;
export const NATIVE_CODEC_MIGRATION_STABILIZATION_MS = 1500;
export const NATIVE_CODEC_MIGRATION_REQUIRED_FRAMES = 3;
export const NATIVE_CODEC_MIGRATION_MAX_FRAME_GAP_MS = 1000;

function metadataRecord(value: unknown) {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

function metadataCodec(metadata: Record<string, unknown>) {
  return normalizeVideoCodecName(metadata.codec);
}

function metadataNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

function metadataTarget(metadata: Record<string, unknown>) {
  const nestedTarget =
    metadata.target && typeof metadata.target === "object"
      ? (metadata.target as Record<string, unknown>)
      : null;
  const target: {
    width?: number;
    height?: number;
    fps?: number;
  } = {};
  for (const key of ["width", "height", "fps"] as const) {
    const value = metadataNumber(nestedTarget?.[key] ?? metadata[key]);
    if (value) target[key] = value;
  }
  return Object.keys(target).length ? target : undefined;
}

function normalizePreferredLayers(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const spatialLayer = Number(record.spatialLayer);
  const temporalLayer = Number(record.temporalLayer);
  const result: { spatialLayer?: number; temporalLayer?: number } = {};
  if (Number.isFinite(spatialLayer))
    result.spatialLayer = Math.max(0, Math.min(2, Math.floor(spatialLayer)));
  if (Number.isFinite(temporalLayer))
    result.temporalLayer = Math.max(0, Math.min(2, Math.floor(temporalLayer)));
  return Object.keys(result).length ? result : null;
}

function reportCodecMigrationState(
  session: NativeMediasoupSfuSession,
  entry: NativeConsumerEntry,
  state: "stable" | "abort",
  reason?: string,
) {
  return session.providerSignaling?.send?.({
    type: "codec-migration-state",
    data: {
      receiverId: session.localPeerId,
      logicalStreamId: entry.logicalStreamId || null,
      variantId: entry.variantId || null,
      generation: entry.generation || 1,
      state,
      ...(reason ? { reason } : {}),
    },
  });
}

function decodePreferenceScore(
  session: NativeMediasoupSfuSession,
  codec: ReturnType<typeof metadataCodec>,
) {
  if (!codec || !session.mediaCapabilities) return null;
  const capability = session.mediaCapabilities.videoCodecs[codec].decode;
  if (!isRealtimeEfficient(capability)) return null;
  return (
    efficiencyRank(capability.realtimeEfficiency) +
    (capability.acceleration === "hardware" ? 2 : 0)
  );
}

function updateStableVideoConsumerMetadata(
  session: NativeMediasoupSfuSession,
  entry: NativeConsumerEntry,
  metadata: Record<string, unknown>,
) {
  if (
    entry.kind !== "video" ||
    entry.closed ||
    entry.visible === false ||
    entry.migrationState !== "stable"
  )
    return false;
  const logicalStreamId =
    typeof metadata.logicalStreamId === "string"
      ? metadata.logicalStreamId
      : entry.logicalStreamId;
  if (logicalStreamId) entry.logicalStreamId = logicalStreamId;
  const generation = Number(metadata.generation);
  if (Number.isFinite(generation) && generation > 0)
    entry.generation = Math.max(1, Math.floor(generation));
  if (typeof metadata.variantId === "string" && metadata.variantId)
    entry.variantId = metadata.variantId;
  const codec = metadataCodec(metadata);
  if (codec) entry.codec = codec;
  if (typeof metadata.codecAcceleration === "string")
    entry.codecAcceleration = metadata.codecAcceleration;
  if (typeof metadata.codecImplementation === "string")
    entry.codecImplementation = metadata.codecImplementation;
  entry.width = metadataNumber(metadata.width) ?? entry.width;
  entry.height = metadataNumber(metadata.height) ?? entry.height;
  entry.fps = metadataNumber(metadata.fps) ?? entry.fps;
  entry.bitrate = metadataNumber(metadata.bitrate) ?? entry.bitrate;
  const logicalState = session.logicalVideoStreams.get(
    String(entry.logicalStreamId || ""),
  );
  if (logicalState?.currentConsumerId === entry.consumerId) {
    logicalState.currentVariantId = entry.variantId || null;
    logicalState.generation = Math.max(
      1,
      Math.floor(Number(entry.generation) || 1),
    );
    logicalState.state = "stable";
  }
  session.remoteVideoFeeds.set(entry.key, entry);
  if (entry.variantId) reportCodecMigrationState(session, entry, "stable");
  session.onRemoteTrack?.(entry);
  session._emitState();
  return true;
}

function shouldRequestProducer(
  session: NativeMediasoupSfuSession,
  producerId: string,
  metadata: Record<string, unknown>,
) {
  const receiverValues = Array.isArray(metadata.receivers)
    ? metadata.receivers
    : null;
  const hasReceiverCohort = receiverValues !== null;
  const receivers = receiverValues ? receiverValues.map(String) : [];
  if (
    hasReceiverCohort &&
    session.localPeerId &&
    !receivers.includes(session.localPeerId)
  )
    return false;
  const codec = metadataCodec(metadata);
  if (!codec || !session.mediaCapabilities) return true;
  const capability = session.mediaCapabilities.videoCodecs[codec].decode;
  if (!supportsCodecDirectionTarget(capability, metadataTarget(metadata)))
    return false;
  if (
    !isRealtimeEfficient(capability) &&
    !(metadata.emergency === true && isEmergencyUsable(capability))
  )
    return false;
  const logicalStreamId =
    typeof metadata.logicalStreamId === "string"
      ? metadata.logicalStreamId
      : null;
  if (!logicalStreamId) return true;
  const logicalState = session.logicalVideoStreams.get(logicalStreamId);
  if (logicalState?.candidateConsumerId) return false;
  if (metadata.force === true) return true;
  const current = logicalState?.currentConsumerId
    ? session.consumers.get(logicalState.currentConsumerId)
    : [...session.consumers.values()].find(
        (entry) =>
          entry.kind === "video" &&
          entry.logicalStreamId === logicalStreamId &&
          entry.visible !== false &&
          !entry.closed,
      );
  if (!current) return true;
  if (current.producerId === producerId) return true;
  if (receivers.length > 0 && receivers.includes(session.localPeerId))
    return true;
  const currentScore = decodePreferenceScore(
    session,
    normalizeVideoCodecName(current.codec),
  );
  const candidateScore = decodePreferenceScore(session, codec);
  if (candidateScore === null) return currentScore === null;
  if (currentScore === null) return true;
  return candidateScore > currentScore;
}

function clearRetryTimer(
  session: NativeMediasoupSfuSession,
  producerId: string,
) {
  const timer = session.consumerRetryTimers.get(producerId);
  if (timer) clearTimeout(timer);
}

export function requestConsumer(
  session: NativeMediasoupSfuSession,
  producerId: string,
  metadata: Record<string, unknown> = {},
) {
  const normalizedProducerId = String(producerId || "");
  if (!normalizedProducerId) return false;
  const force = metadataRecord(metadata).force === true;
  const resolvedMetadata = {
    ...(session.remoteProducerMetadata.get(normalizedProducerId) || {}),
    ...metadataRecord(metadata),
  };
  delete resolvedMetadata.force;
  if (Object.keys(resolvedMetadata).length)
    session.remoteProducerMetadata.set(normalizedProducerId, resolvedMetadata);
  if (
    !shouldRequestProducer(session, normalizedProducerId, {
      ...resolvedMetadata,
      ...(force ? { force: true } : {}),
    })
  )
    return false;
  if (producersHasId(session, normalizedProducerId)) return false;
  if (!force) {
    const logicalStreamId =
      typeof resolvedMetadata.logicalStreamId === "string"
        ? resolvedMetadata.logicalStreamId
        : null;
    const current = logicalStreamId
      ? [...session.consumers.values()].find(
          (entry) =>
            entry.kind === "video" &&
            entry.logicalStreamId === logicalStreamId &&
            entry.visible !== false &&
            !entry.closed,
        )
      : null;
    if (current?.producerId === normalizedProducerId) {
      updateStableVideoConsumerMetadata(session, current, resolvedMetadata);
      return false;
    }
  }
  if (!session.recvTransport || !session.device) {
    session.pendingConsumers.add(normalizedProducerId);
    return false;
  }
  clearRetryTimer(session, normalizedProducerId);
  session.consumerRetryTimers.delete(normalizedProducerId);
  session.pendingConsumers.delete(normalizedProducerId);
  if (
    (!force && session.requestedConsumers.has(normalizedProducerId)) ||
    [...session.consumers.values()].some(
      (entry) => entry.producerId === normalizedProducerId && !force,
    )
  )
    return false;
  const preferredLayers = normalizePreferredLayers(
    metadataRecord(metadata).preferredLayers,
  );
  session.requestedConsumers.add(normalizedProducerId);
  const requestId = session.requestId("consume");
  try {
    session.sendOrThrow(
      {
        type: "consume",
        data: {
          requestId,
          transportId: session.recvTransport.id,
          producerId: normalizedProducerId,
          rtpCapabilities: session.lastSentClientRtpCapabilities,
          mediaCapabilities: session.mediaCapabilities,
          preferredCodecs: session.mediaCapabilities
            ? efficientDecodeCodecs(session.mediaCapabilities)
            : [],
          ...(metadataCodec(resolvedMetadata)
            ? { preferredCodec: metadataCodec(resolvedMetadata) }
            : {}),
          ...(preferredLayers ? { preferredLayers } : {}),
        },
      },
      "SFU consumer request",
    );
  } catch (_) {
    session.requestedConsumers.delete(normalizedProducerId);
    session.pendingConsumers.add(normalizedProducerId);
  }
  return true;
}

export function producersHasId(
  session: NativeMediasoupSfuSession,
  producerId: string,
) {
  return (
    [...session.producers.values()].some((entry) => entry.id === producerId) ||
    [...session.producerVariants.values()].some(
      (entry) => entry.id === producerId,
    )
  );
}

export async function createConsumer(
  session: NativeMediasoupSfuSession,
  data: Record<string, unknown>,
) {
  const producerId = String(data.producerId || "");
  const dataId = String(data.id || "");
  const appData =
    data.appData && typeof data.appData === "object"
      ? (data.appData as Record<string, unknown>)
      : {};
  session.remoteProducerMetadata.set(producerId, {
    ...(session.remoteProducerMetadata.get(producerId) || {}),
    ...appData,
    ...data,
  });
  session.requestedConsumers.delete(producerId);
  session.pendingConsumers.delete(producerId);
  session.consumerRetryAttempts.delete(producerId);
  clearRetryTimer(session, producerId);
  session.consumerRetryTimers.delete(producerId);
  if (!session.recvTransport || session.consumers.has(dataId)) return null;
  const mediaRevision = session.mediaRevision;
  session.lastReceivedConsumerParams = data;
  const previousDirection = session.pendingNativeDirection;
  session.pendingNativeDirection = "recv";
  try {
    const result = await session.invoke("media_consume", {
      id: dataId,
      producerId,
      kind: String(data.kind ?? appData.kind ?? "audio"),
      rtpParameters: data.rtpParameters,
      appData: {
        userId: data.userId ?? appData.userId,
        source: data.source ?? appData.source,
        ownerSource:
          typeof (data.ownerSource ?? appData.ownerSource) === "string"
            ? String(data.ownerSource ?? appData.ownerSource)
            : null,
        logicalStreamId:
          data.logicalStreamId || appData.logicalStreamId || null,
        generation: data.generation || appData.generation || null,
        variantId: data.variantId || appData.variantId || null,
        codec: data.codec || appData.codec || null,
        codecAcceleration:
          data.codecAcceleration || appData.codecAcceleration || null,
        codecImplementation:
          data.codecImplementation || appData.codecImplementation || null,
        target: data.target || appData.target || null,
        targetAdjusted:
          data.targetAdjusted === true || appData.targetAdjusted === true,
        emergency: data.emergency === true || appData.emergency === true,
        width: data.width ?? appData.width ?? null,
        height: data.height ?? appData.height ?? null,
        fps: data.fps ?? appData.fps ?? null,
        bitrate: data.bitrate ?? appData.bitrate ?? null,
      },
    });
    const consumerId = String(result?.id || data.id || "");
    if (session.closed || mediaRevision !== session.mediaRevision) {
      await session
        .invoke("media_close_consumer", {
          consumerId,
        })
        .catch(() => {});
      return null;
    }
    const source = String(
      data.source ?? appData.source ?? data.kind ?? "audio",
    );
    const userId =
      typeof (data.userId ?? appData.userId) === "string" ||
      typeof (data.userId ?? appData.userId) === "number"
        ? ((data.userId ?? appData.userId) as string | number)
        : null;
    const feedKey = nativeRemoteFeedKey(userId, source, consumerId);
    const logicalStream = String(
      data.logicalStreamId ||
        appData.logicalStreamId ||
        logicalVideoStreamId(userId, source),
    );
    const previous = [...session.consumers.values()].find(
      (candidate) =>
        candidate.key === feedKey ||
        (candidate.kind === "video" &&
          candidate.logicalStreamId === logicalStream),
    );
    const isVideoMigration = Boolean(
      previous &&
      String(data.kind || "audio") === "video" &&
      previous.kind === "video" &&
      previous.consumerId !== consumerId,
    );
    if (previous && !isVideoMigration) closeConsumer(session, previous);
    const entry: NativeConsumerEntry = {
      key: feedKey,
      id: consumerId,
      consumerId,
      producerId: String(result?.producerId || producerId),
      userId,
      source,
      ownerSource:
        typeof (data.ownerSource ?? appData.ownerSource) === "string"
          ? String(data.ownerSource ?? appData.ownerSource)
          : null,
      kind: String(result?.kind || data.kind || "audio"),
      track: null,
      stream: null,
      native: true,
      playback: String(data.kind) === "audio" ? "coreaudio" : "native-frame",
      frame: null,
      receiving: false,
      desiredReceiving: false,
      receivingRevision: 0,
      closed: false,
      connectionEpoch: session.getControlConnectionEpoch?.() || 1,
      logicalStreamId: logicalStream,
      generation: Math.max(
        1,
        Math.floor(Number(data.generation || appData.generation) || 1),
      ),
      receiverIncarnationId: `native-sfu:${consumerId}:${
        session.getControlConnectionEpoch?.() || 1
      }:${Math.max(1, Math.floor(Number(data.generation || appData.generation) || 1))}`,
      variantId:
        typeof (data.variantId || appData.variantId) === "string"
          ? String(data.variantId || appData.variantId)
          : null,
      codec:
        typeof (data.codec || appData.codec) === "string"
          ? String(data.codec || appData.codec)
          : null,
      codecAcceleration:
        typeof (data.codecAcceleration || appData.codecAcceleration) ===
        "string"
          ? String(data.codecAcceleration || appData.codecAcceleration)
          : null,
      codecImplementation:
        typeof (data.codecImplementation || appData.codecImplementation) ===
        "string"
          ? String(data.codecImplementation || appData.codecImplementation)
          : null,
      width: metadataNumber(data.width ?? appData.width),
      height: metadataNumber(data.height ?? appData.height),
      fps: metadataNumber(data.fps ?? appData.fps),
      bitrate: metadataNumber(data.bitrate ?? appData.bitrate),
      target:
        (data.target ?? appData.target) &&
        typeof (data.target ?? appData.target) === "object"
          ? ((data.target ?? appData.target) as Record<string, unknown>)
          : null,
      targetAdjusted:
        data.targetAdjusted === true || appData.targetAdjusted === true,
      emergency: data.emergency === true || appData.emergency === true,
      preferredLayers: normalizePreferredLayers(
        data.preferredLayers ||
          appData.preferredLayers ||
          session.remoteProducerMetadata.get(producerId)?.preferredLayers,
      ),
      migrationState: isVideoMigration ? "warming-receivers" : "stable",
      presentableFrames: 0,
      lastFrameTimestamp: null,
      lastFrameAt: null,
      visible: !isVideoMigration,
      superseded: false,
      migrationStartedAt: isVideoMigration ? Date.now() : null,
      migrationTimer: null,
    };
    session.consumers.set(entry.consumerId, entry);
    if (entry.kind === "audio") session.remoteAudioFeeds.set(entry.key, entry);
    if (entry.kind === "video") {
      const logicalState = session.logicalVideoStreams.get(logicalStream);
      if (isVideoMigration && previous) {
        logicalState?.candidateConsumerId &&
          session.consumers.get(logicalState.candidateConsumerId) &&
          closeConsumer(
            session,
            session.consumers.get(
              logicalState.candidateConsumerId,
            ) as NativeConsumerEntry,
          );
        session.logicalVideoStreams.set(logicalStream, {
          logicalStreamId: logicalStream,
          generation: entry.generation || 1,
          currentVariantId: previous.variantId || null,
          candidateVariantId: entry.variantId || null,
          state: "warming-receivers",
          currentConsumerId: previous.consumerId,
          candidateConsumerId: entry.consumerId,
        });
        entry.migrationTimer = setTimeout(() => {
          abortVideoMigration(session, entry, "candidate-timeout");
        }, NATIVE_CODEC_MIGRATION_TIMEOUT_MS);
        entry.migrationTimer.unref?.();
        session.codecMigrationTelemetry.push(
          createCodecMigrationTelemetry(logicalStream, "warming-receivers", {
            codec: entry.codec || undefined,
            previousCodec: previous.codec || undefined,
            generation: entry.generation,
          }),
        );
      } else {
        session.logicalVideoStreams.set(logicalStream, {
          logicalStreamId: logicalStream,
          generation: entry.generation || 1,
          currentVariantId: entry.variantId || null,
          candidateVariantId: null,
          state: "stable",
          currentConsumerId: entry.consumerId,
          candidateConsumerId: null,
        });
        session.remoteVideoFeeds.set(entry.key, entry);
      }
    }
    if (entry.kind === "video" && !isVideoMigration)
      reportCodecMigrationState(session, entry, "stable");
    if (shouldReceive(session, entry.userId, entry.source, entry.ownerSource))
      await setConsumerReceiving(session, entry, true);
    await session.applyJitterBufferConfig(entry);
    if (entry.kind !== "video" || entry.visible !== false)
      session.onRemoteTrack?.(entry);
    session._emitState();
    return entry;
  } finally {
    session.pendingNativeDirection = previousDirection;
  }
}

export async function adaptVideoReceiver(
  session: NativeMediasoupSfuSession,
  logicalStreamId: string,
  preferredLayers: { spatialLayer?: number; temporalLayer?: number },
) {
  if (session.selectedProvider === "cloudflare-realtime") return false;
  const logicalState = session.logicalVideoStreams.get(String(logicalStreamId));
  if (logicalState?.candidateConsumerId) return false;
  const current = logicalState?.currentConsumerId
    ? session.consumers.get(logicalState.currentConsumerId)
    : [...session.consumers.values()].find(
        (entry) =>
          entry.kind === "video" &&
          entry.logicalStreamId === String(logicalStreamId) &&
          entry.visible !== false &&
          !entry.closed,
      );
  if (!current || current.kind !== "video" || !current.producerId) return false;
  const normalized = normalizePreferredLayers(preferredLayers);
  if (!normalized) return false;
  const metadata = {
    ...(session.remoteProducerMetadata.get(current.producerId) || {}),
    force: true,
    preferredLayers: normalized,
  };
  return requestConsumer(session, current.producerId, metadata);
}

export function setRemoteReceiving(
  session: NativeMediasoupSfuSession,
  userIdOrKey: string,
  sourceOrReceiving: string | boolean,
  receivingValue?: boolean,
): Promise<unknown> | false {
  if (typeof sourceOrReceiving === "boolean" && receivingValue === undefined) {
    const entry =
      session.consumers.get(userIdOrKey) ||
      session.remoteVideoFeeds.get(userIdOrKey) ||
      session.remoteAudioFeeds.get(userIdOrKey);
    return entry
      ? setRemoteReceiving(
          session,
          String(entry.userId),
          String(entry.source || ""),
          sourceOrReceiving,
        )
      : Promise.resolve(false);
  }
  const userId = userIdOrKey;
  const source = sourceOrReceiving;
  const receiving = Boolean(receivingValue);
  const operations: Array<Promise<unknown>> = [];
  session.remoteReceiving.set(
    `${String(userId)}:${String(source)}`,
    Boolean(receiving),
  );
  for (const entry of session.consumers.values()) {
    if (String(entry.userId) === String(userId) && entry.source === source)
      operations.push(setConsumerReceiving(session, entry, receiving));
  }
  return Promise.all(operations);
}

export function shouldReceive(
  session: NativeMediasoupSfuSession,
  userId: string | number | null | undefined,
  source: string,
  ownerSource: string | null = null,
) {
  const key = `${String(userId)}:${String(source)}`;
  if (session.remoteReceiving.has(key)) return session.remoteReceiving.get(key);
  return !isPairedScreenAudio({ source, ownerSource });
}

export function setConsumerVolume(
  session: NativeMediasoupSfuSession,
  userId: string | number,
  source: string,
  volume: number,
) {
  const normalized = Math.max(0, Math.min(2, Number(volume)));
  const operations = [...session.consumers.values()]
    .filter(
      (entry) =>
        String(entry.userId) === String(userId) &&
        (!source || entry.source === source),
    )
    .map((entry) =>
      session.invoke("media_set_consumer_volume", {
        consumerId: entry.consumerId,
        volume: normalized,
      }),
    );
  return Promise.all(operations);
}

export function sendParticipantVoiceState(
  session: NativeMediasoupSfuSession,
  state: { muted?: boolean; deafened?: boolean } = {},
) {
  return session.signaling?.send?.({
    type: "participant-voice-state",
    data: {
      muted: Boolean(state.muted),
      deafened: Boolean(state.deafened),
    },
  });
}

export async function setConsumerReceiving(
  session: NativeMediasoupSfuSession,
  entry: NativeConsumerEntry,
  receiving: boolean,
) {
  if (!entry || entry.closed) return false;
  const desired = Boolean(receiving);
  entry.desiredReceiving = desired;
  entry.receivingRevision = (entry.receivingRevision || 0) + 1;
  const revision = entry.receivingRevision;
  const requestId = session.requestId(
    desired ? "resume-consumer" : "pause-consumer",
  );
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const retryRequestId =
      attempt === 0
        ? requestId
        : session.requestId(desired ? "resume-consumer" : "pause-consumer");
    const acknowledgement = waitFor(
      session.pending,
      retryRequestId,
      session.consumerControlTimeoutMs,
      `SFU consumer ${desired ? "resume" : "pause"}`,
    );
    try {
      session.sendOrThrow(
        {
          type: desired ? "resume-consumer" : "pause-consumer",
          data: {
            consumerId: entry.consumerId,
            requestId: retryRequestId,
            revision,
          },
        },
        `SFU consumer ${desired ? "resume" : "pause"}`,
      );
    } catch (error) {
      session.pending.get(retryRequestId)?.reject(error);
    }
    try {
      const result: unknown = await acknowledgement;
      if (
        result &&
        typeof result === "object" &&
        "consumerClosed" in result &&
        result.consumerClosed === true
      ) {
        if (entry.receivingRevision === revision) entry.receiving = false;
        closeConsumer(session, entry);
        return false;
      }
      if (entry.receivingRevision !== revision) return false;
      await session.invoke("media_set_consumer_enabled", {
        consumerId: entry.consumerId,
        enabled: desired,
      });
      if (entry.closed || entry.receivingRevision !== revision) return false;
      entry.receiving = desired;
      session._emitState();
      return true;
    } catch (error) {
      lastError = error;
    }
  }
  if (entry.receivingRevision === revision) entry.receiving = false;
  session._emitState();
  throw lastError;
}

export function resolveConsumerControl(
  session: NativeMediasoupSfuSession,
  data: Record<string, unknown>,
  receiving: boolean,
) {
  const consumerId = String(data.consumerId || "");
  const requestId = String(data.requestId || "");
  const entry = session.consumers.get(consumerId);
  if (!entry) {
    session.pending.get(requestId)?.resolve({ ...data, consumerClosed: true });
    return;
  }
  session.pending.get(requestId)?.resolve({ ...data, receiving });
}

export function closeConsumerByProducer(
  session: NativeMediasoupSfuSession,
  producerId: string,
) {
  session.remoteProducerMetadata.delete(producerId);
  session.requestedConsumers.delete(producerId);
  session.pendingConsumers.delete(producerId);
  session.consumerRetryAttempts.delete(producerId);
  clearRetryTimer(session, producerId);
  session.consumerRetryTimers.delete(producerId);
  const entries = [...session.consumers.values()].filter(
    (candidate) => candidate.producerId === producerId,
  );
  for (const entry of entries) {
    if (entry.closed || !session.consumers.has(entry.consumerId)) continue;
    if (
      entry.kind === "video" &&
      entry.visible !== false &&
      entry.migrationState === "committing"
    ) {
      if (!rollbackVideoMigration(session, entry, "candidate-producer-closed"))
        closeConsumer(session, entry);
      continue;
    }
    if (
      entry.kind === "video" &&
      entry.visible === false &&
      entry.migrationState === "warming-receivers"
    ) {
      abortVideoMigration(session, entry, "candidate-producer-closed");
      continue;
    }
    const replacement =
      entry.kind === "video"
        ? [...session.consumers.values()].find(
            (candidate) =>
              candidate !== entry &&
              candidate.kind === "video" &&
              candidate.logicalStreamId === entry.logicalStreamId &&
              candidate.visible === false &&
              candidate.migrationState === "warming-receivers" &&
              !candidate.closed,
          )
        : null;
    if (replacement) {
      entry.receiving = false;
      entry.transportEnded = true;
      session._emitState();
      continue;
    }
    closeConsumer(session, entry);
  }
}

export function abortVideoMigration(
  session: NativeMediasoupSfuSession,
  candidate: NativeConsumerEntry,
  reason: string,
) {
  if (candidate.closed) return false;
  const logicalStreamId = String(candidate.logicalStreamId || "");
  const logicalState = session.logicalVideoStreams.get(logicalStreamId);
  if (candidate.migrationTimer) clearTimeout(candidate.migrationTimer);
  candidate.migrationTimer = null;
  candidate.migrationState = "abort";
  const current = logicalState?.currentConsumerId
    ? session.consumers.get(logicalState.currentConsumerId)
    : [...session.consumers.values()].find(
        (entry) =>
          entry !== candidate &&
          entry.kind === "video" &&
          entry.logicalStreamId === logicalStreamId &&
          entry.visible !== false &&
          !entry.closed,
      );
  if (logicalState?.candidateConsumerId === candidate.consumerId) {
    logicalState.candidateConsumerId = null;
    logicalState.candidateVariantId = null;
    logicalState.state = "stable";
    if (current)
      logicalState.generation = current.generation || logicalState.generation;
  }
  session.codecMigrationTelemetry.push(
    createCodecMigrationTelemetry(logicalStreamId, "abort", {
      codec: candidate.codec || undefined,
      generation: candidate.generation,
      durationMs: Number.isFinite(Number(candidate.migrationStartedAt))
        ? Math.max(0, Date.now() - Number(candidate.migrationStartedAt))
        : undefined,
      abortReason: reason,
      frameCount: candidate.presentableFrames,
    }),
  );
  reportCodecMigrationState(session, candidate, "abort", reason);
  closeConsumer(session, candidate);
  if (current?.transportEnded) closeConsumer(session, current);
  session._emitState();
  return true;
}

export function rollbackVideoMigration(
  session: NativeMediasoupSfuSession,
  candidate: NativeConsumerEntry,
  reason: string,
) {
  if (candidate.closed) return false;
  const logicalStreamId = String(candidate.logicalStreamId || "");
  const logicalState = session.logicalVideoStreams.get(logicalStreamId);
  const previous = [...session.consumers.values()].find(
    (entry) =>
      entry !== candidate &&
      entry.kind === "video" &&
      entry.logicalStreamId === logicalStreamId &&
      entry.visible === false &&
      entry.superseded === true &&
      entry.migrationState === "committing" &&
      entry.transportEnded !== true &&
      !entry.closed,
  );
  if (!previous) return false;
  if (candidate.migrationTimer) clearTimeout(candidate.migrationTimer);
  candidate.migrationTimer = null;
  candidate.visible = false;
  candidate.superseded = true;
  candidate.migrationState = "abort";
  if (logicalState) {
    logicalState.currentConsumerId = previous.consumerId;
    logicalState.currentVariantId = previous.variantId || null;
    logicalState.candidateConsumerId = null;
    logicalState.candidateVariantId = null;
    logicalState.state = "stable";
    logicalState.generation = previous.generation || logicalState.generation;
  }
  const feed = session.remoteVideoFeeds.get(candidate.key);
  if (feed?.consumerId === candidate.consumerId)
    session.remoteVideoFeeds.delete(candidate.key);
  session.remoteVideoFeeds.set(previous.key, previous);
  session.codecMigrationTelemetry.push(
    createCodecMigrationTelemetry(logicalStreamId, "abort", {
      codec: candidate.codec || undefined,
      previousCodec: previous.codec || undefined,
      generation: candidate.generation,
      durationMs: Number.isFinite(Number(candidate.migrationStartedAt))
        ? Math.max(0, Date.now() - Number(candidate.migrationStartedAt))
        : undefined,
      abortReason: reason,
      frameCount: candidate.presentableFrames,
    }),
  );
  reportCodecMigrationState(session, candidate, "abort", reason);
  closeConsumer(session, candidate);
  previous.visible = true;
  previous.superseded = false;
  previous.migrationState = "stable";
  session.onRemoteTrack?.(previous);
  session._emitState();
  return true;
}

export function finalizeVideoMigration(
  session: NativeMediasoupSfuSession,
  candidate: NativeConsumerEntry,
) {
  if (candidate.closed || candidate.migrationState !== "committing")
    return false;
  const healthy = Boolean(
    isPresentableVideoFrame(candidate.frame) &&
    Number(candidate.presentableFrames) >=
      NATIVE_CODEC_MIGRATION_REQUIRED_FRAMES &&
    Number.isFinite(Number(candidate.lastFrameAt)) &&
    Date.now() - Number(candidate.lastFrameAt) <=
      NATIVE_CODEC_MIGRATION_MAX_FRAME_GAP_MS,
  );
  if (!healthy) {
    if (rollbackVideoMigration(session, candidate, "candidate-stalled"))
      return true;
    const logicalState = session.logicalVideoStreams.get(
      String(candidate.logicalStreamId || ""),
    );
    if (
      !logicalState ||
      logicalState.currentConsumerId !== candidate.consumerId
    )
      return false;
    if (candidate.migrationTimer) clearTimeout(candidate.migrationTimer);
    candidate.migrationTimer = null;
    candidate.migrationState = "stable";
    logicalState.state = "stable";
    const previous = [...session.consumers.values()].find(
      (entry) =>
        entry !== candidate &&
        entry.kind === "video" &&
        entry.logicalStreamId === candidate.logicalStreamId &&
        entry.visible === false &&
        entry.superseded === true &&
        !entry.closed,
    );
    if (previous) closeConsumer(session, previous);
    session.codecMigrationTelemetry.push(
      createCodecMigrationTelemetry(
        String(candidate.logicalStreamId || ""),
        "stable",
        {
          codec: candidate.codec || undefined,
          generation: candidate.generation,
          durationMs: Number.isFinite(Number(candidate.migrationStartedAt))
            ? Math.max(0, Date.now() - Number(candidate.migrationStartedAt))
            : undefined,
          frameCount: candidate.presentableFrames,
        },
      ),
    );
    reportCodecMigrationState(session, candidate, "stable");
    session._emitState();
    return true;
  }
  const logicalStreamId = String(candidate.logicalStreamId || "");
  const logicalState = session.logicalVideoStreams.get(logicalStreamId);
  if (!logicalState || logicalState.currentConsumerId !== candidate.consumerId)
    return false;
  if (candidate.migrationTimer) clearTimeout(candidate.migrationTimer);
  candidate.migrationTimer = null;
  const previous = [...session.consumers.values()].find(
    (entry) =>
      entry !== candidate &&
      entry.kind === "video" &&
      entry.logicalStreamId === logicalStreamId &&
      entry.visible === false &&
      entry.superseded === true &&
      !entry.closed,
  );
  candidate.migrationState = "stable";
  logicalState.state = "stable";
  if (previous) closeConsumer(session, previous);
  session.codecMigrationTelemetry.push(
    createCodecMigrationTelemetry(logicalStreamId, "stable", {
      codec: candidate.codec || undefined,
      previousCodec: previous?.codec || undefined,
      generation: candidate.generation,
      durationMs: Number.isFinite(Number(candidate.migrationStartedAt))
        ? Math.max(0, Date.now() - Number(candidate.migrationStartedAt))
        : undefined,
      frameCount: candidate.presentableFrames,
    }),
  );
  reportCodecMigrationState(session, candidate, "stable");
  session._emitState();
  return true;
}

export function commitVideoMigration(
  session: NativeMediasoupSfuSession,
  candidate: NativeConsumerEntry,
) {
  const logicalStreamId = String(candidate.logicalStreamId || "");
  const logicalState = session.logicalVideoStreams.get(logicalStreamId);
  if (
    !logicalState ||
    logicalState.candidateConsumerId !== candidate.consumerId
  )
    return false;
  const previous = logicalState.currentConsumerId
    ? session.consumers.get(logicalState.currentConsumerId)
    : null;
  if (candidate.migrationTimer) clearTimeout(candidate.migrationTimer);
  candidate.migrationTimer = null;
  candidate.visible = true;
  candidate.migrationState = "committing";
  logicalState.currentConsumerId = candidate.consumerId;
  logicalState.currentVariantId = candidate.variantId || null;
  logicalState.candidateConsumerId = null;
  logicalState.candidateVariantId = null;
  logicalState.state = "committing";
  logicalState.generation = candidate.generation || logicalState.generation;
  for (const [key, feed] of session.remoteVideoFeeds) {
    if (key !== candidate.key && feed.logicalStreamId === logicalStreamId)
      session.remoteVideoFeeds.delete(key);
  }
  session.remoteVideoFeeds.set(candidate.key, candidate);
  if (previous && previous.consumerId !== candidate.consumerId) {
    previous.superseded = true;
    previous.visible = false;
    previous.migrationState = "committing";
  }
  candidate.migrationTimer = setTimeout(
    () => finalizeVideoMigration(session, candidate),
    NATIVE_CODEC_MIGRATION_STABILIZATION_MS,
  );
  candidate.migrationTimer.unref?.();
  session.onRemoteTrack?.(candidate);
  session._emitState();
  return true;
}

export function closeConsumer(
  session: NativeMediasoupSfuSession,
  entry: NativeConsumerEntry,
  { releaseNative = true }: { releaseNative?: boolean } = {},
) {
  if (!entry?.consumerId || entry.closed) return false;
  if (entry.migrationTimer) clearTimeout(entry.migrationTimer);
  entry.migrationTimer = null;
  entry.closed = true;
  session.consumers.delete(entry.consumerId);
  const audioFeed = session.remoteAudioFeeds.get(entry.key);
  if (
    audioFeed &&
    String(audioFeed.consumerId || "") === String(entry.consumerId)
  )
    session.remoteAudioFeeds.delete(entry.key);
  const videoFeed = session.remoteVideoFeeds.get(entry.key);
  if (
    videoFeed &&
    String(videoFeed.consumerId || "") === String(entry.consumerId)
  )
    session.remoteVideoFeeds.delete(entry.key);
  entry.receiving = false;
  if (entry.visible !== false && !entry.superseded)
    session.onRemoteTrackEnded?.(entry);
  if (releaseNative) {
    try {
      if (session.providerSignaling?.send)
        session.providerSignaling.send({
          type: "close-consumer",
          data: { consumerId: entry.consumerId },
        });
      else if (!session.controlTicket)
        session.signaling?.send?.({
          type: "close-consumer",
          data: { consumerId: entry.consumerId },
        });
    } catch {}
    session
      .invoke("media_close_consumer", { consumerId: entry.consumerId })
      .catch((error: unknown) =>
        session.onError?.(asError(error, "Native consumer close failed")),
      );
  }
  session._emitState();
  return true;
}
