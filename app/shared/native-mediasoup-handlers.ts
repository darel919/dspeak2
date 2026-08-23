import type { NativeMediasoupSfuSession } from "./native-mediasoup-session.ts";
import {
  isExternalBoolean,
  isExternalNumber,
  isExternalRecord,
  isExternalString,
  type ExternalObject,
} from "./types/boundary.ts";
import {
  normalizeParticipantMediaCapabilities,
  normalizeVideoCodecName,
} from "./types/video-codec-capabilities.ts";
import type {
  CodecRoutingPlan,
  CodecRoutingTarget,
} from "./video-codec-routing.ts";

type NativeMessageData = ExternalObject;
type NativeMessageHandler = (
  data: NativeMessageData,
) => import("./types/boundary.ts").MediaCommandResult;

function recordValue<T>(value: T): ExternalObject | null {
  return isExternalRecord(value) ? value : null;
}

function stringValue<T>(value: T) {
  return isExternalString(value) ? value : "";
}

function numberValue<T>(value: T) {
  return isExternalNumber(value) ? value : null;
}

function producerAnnouncementMetadata<T>(value: T): ExternalObject {
  const record = recordValue(value);
  if (!record) return {};
  const appData = recordValue(record.appData) || {};
  return { ...appData, ...record };
}

function updateParticipantCapabilities<T>(
  session: NativeMediasoupSfuSession,
  values: T,
) {
  if (!Array.isArray(values)) return;
  for (const value of values) {
    const entry = recordValue(value);
    if (!entry) continue;
    const participantIds = new Set(
      [entry.participantId, entry.peerId, entry.deviceId, entry.userId]
        .map((value) => String(value || ""))
        .filter(Boolean),
    );
    if (!participantIds.size || !entry.mediaCapabilities) continue;
    const capabilities = normalizeParticipantMediaCapabilities(
      entry.mediaCapabilities,
    );
    for (const participantId of participantIds)
      session.remoteParticipantCapabilities.set(participantId, capabilities);
  }
}

function codecRoutingTarget<T>(value: T): CodecRoutingTarget | undefined {
  const record = recordValue(value);
  if (!record) return undefined;
  const target: CodecRoutingTarget = {};
  const width = numberValue(record.width);
  const height = numberValue(record.height);
  const fps = numberValue(record.fps);
  const bitrate = numberValue(record.bitrate);
  if (width !== null) target.width = width;
  if (height !== null) target.height = height;
  if (fps !== null) target.fps = fps;
  if (bitrate !== null) target.bitrate = bitrate;
  return Object.keys(target).length ? target : undefined;
}

function codecRoutingPlan<T>(value: T): CodecRoutingPlan | null {
  const record = recordValue(value);
  if (!record || !Array.isArray(record.desiredVariants)) return null;
  const logicalStreamId = stringValue(record.logicalStreamId);
  if (!logicalStreamId) return null;
  const desiredVariants: CodecRoutingPlan["desiredVariants"] = [];
  for (const value of record.desiredVariants) {
    const variant = recordValue(value);
    if (!variant || !Array.isArray(variant.receivers)) return null;
    const codec = normalizeVideoCodecName(variant.codec);
    if (!codec) return null;
    const score = numberValue(variant.score);
    const generation = numberValue(variant.generation);
    const estimatedBitrateBps = numberValue(variant.estimatedBitrateBps);
    const variantId = stringValue(variant.variantId);
    const target = codecRoutingTarget(variant.target);
    const normalizedVariant: CodecRoutingPlan["desiredVariants"][number] = {
      codec,
      receivers: variant.receivers.map(String),
      score: score === null ? 0 : score,
      hardwareEncode: isExternalBoolean(variant.hardwareEncode)
        ? variant.hardwareEncode
        : false,
    };
    if (generation !== null) normalizedVariant.generation = generation;
    if (estimatedBitrateBps !== null)
      normalizedVariant.estimatedBitrateBps = estimatedBitrateBps;
    if (variant.emergency === true) normalizedVariant.emergency = true;
    if (variant.targetAdjusted === true)
      normalizedVariant.targetAdjusted = true;
    if (variantId) normalizedVariant.variantId = variantId;
    if (target) normalizedVariant.target = target;
    desiredVariants.push(normalizedVariant);
  }
  const publisher = stringValue(record.publisher);
  const source = stringValue(record.source);
  const variantCount = numberValue(record.variantCount);
  const createdAt = numberValue(record.createdAt);
  const plan: CodecRoutingPlan = {
    publisher,
    logicalStreamId,
    desiredVariants,
    uncoveredReceivers: Array.isArray(record.uncoveredReceivers)
      ? record.uncoveredReceivers.map(String)
      : [],
    emergencyReceivers: Array.isArray(record.emergencyReceivers)
      ? record.emergencyReceivers.map(String)
      : [],
    variantCount: variantCount === null ? desiredVariants.length : variantCount,
    createdAt: createdAt === null ? Date.now() : createdAt,
  };
  if (source) plan.source = source;
  const target = codecRoutingTarget(record.target);
  if (target) plan.target = target;
  const estimatedUploadBitrateBps = numberValue(
    record.estimatedUploadBitrateBps,
  );
  if (estimatedUploadBitrateBps !== null)
    plan.estimatedUploadBitrateBps = estimatedUploadBitrateBps;
  return plan;
}

export function installHandlers(session: NativeMediasoupSfuSession) {
  const messageHandlers: Map<string, NativeMessageHandler> =
    session.messageHandlers;
  messageHandlers.set("hi919", (data) => {
    if (session.signaling?.acceptServerHello(data))
      session.protocolState = session.signaling.getProtocolState();
  });
  messageHandlers.set("connected", (data) => {
    session.connected = true;
    session.localPeerId = String(data?.peerId || "");
    session.lastInRoom = Array.isArray(data?.inRoom)
      ? data.inRoom.filter((entry): entry is ExternalObject =>
          isExternalRecord(entry),
        )
      : [];
    if (session.cloudflareSession)
      session.cloudflareSession.localPeerId = session.localPeerId;
    session.closed = false;
    session.connectionPhase = "signaling-ready";
    session.signaling?.markReady();
    updateParticipantCapabilities(session, data.participants);
    updateParticipantCapabilities(session, data.inRoom);
    session.onCurrentlyInChannel?.(data);
    session._resolveConnect();
    session._emitState();
    session.scheduleCodecRoutingEvaluation();
    if (!session.controlTicket)
      session
        ._startNegotiation()
        .catch((error) => session._fail(String(error)));
  });
  messageHandlers.set("provider-ticket", (data) => {
    session
      ._handleProviderTicket(data)
      .catch((error) => session._fail(String(error)));
  });
  messageHandlers.set("rtp-capabilities", (data) =>
    session._handleRtpCapabilities(data),
  );
  messageHandlers.set("transport-params", (data) =>
    session._handleTransportParams(data),
  );
  messageHandlers.set("transport-connected", (data) => {
    session.pending.get(String(data.requestId))?.resolve(data);
  });
  messageHandlers.set("producer-id", (data) => {
    session.pendingProduce
      .get(String(data.requestId))
      ?.resolve({ id: data.id });
  });
  messageHandlers.set("consumer-params", (data) =>
    session._createConsumer(data),
  );
  messageHandlers.set("new-producer", (data) => {
    const producerId = String(data.producerId || data.id || "");
    session.requestConsumer(producerId, producerAnnouncementMetadata(data));
  });
  messageHandlers.set("producer-updated", (data) => {
    const producerId = String(data.producerId || data.id || "");
    if (!producerId) return false;
    const metadata = producerAnnouncementMetadata(data);
    const previousMetadata =
      session.remoteProducerMetadata.get(producerId) || {};
    session.remoteProducerMetadata.set(producerId, {
      ...previousMetadata,
      ...metadata,
    });
    session.requestConsumer(producerId, metadata);
    return true;
  });
  messageHandlers.set("available-producers", (data) => {
    if (Array.isArray(data?.producers))
      for (const producer of data.producers) {
        const metadata = producerAnnouncementMetadata(producer);
        const producerId = String(
          metadata.producerId ||
            metadata.id ||
            (isExternalString(producer) || isExternalNumber(producer)
              ? producer
              : ""),
        );
        session.requestConsumer(producerId, metadata);
      }
  });
  messageHandlers.set("producer-closed", (data) => {
    session.closeConsumerByProducer(String(data.producerId || ""));
  });
  messageHandlers.set("consumer-resumed", (data) => {
    session._resolveConsumerControl(data, true);
  });
  messageHandlers.set("consumer-paused", (data) => {
    session._resolveConsumerControl(data, false);
  });
  messageHandlers.set("cloudflare-response", (data) =>
    session.cloudflareSession?.handleMessage(
      "cloudflare-response",
      data,
      session.cloudflareSession.sessionGeneration,
    ),
  );
  messageHandlers.set("cloudflare-publication-available", (data) => {
    const trackName = String(data?.trackName || "");
    if (!trackName) return false;
    if (data?.closed) session.pendingCloudflarePublications.delete(trackName);
    for (const [
      currentTrackName,
      current,
    ] of session.pendingCloudflarePublications) {
      if (
        !data?.closed &&
        (currentTrackName === trackName ||
          (data?.peerId &&
            data?.source &&
            current?.peerId === data.peerId &&
            current?.source === data.source))
      )
        session.pendingCloudflarePublications.delete(currentTrackName);
    }
    if (!data?.closed)
      session.pendingCloudflarePublications.set(trackName, data);
    if (session.cloudflareSession && !session.cloudflareSession.closed)
      return session.cloudflareSession.handleMessage(
        "cloudflare-publication-available",
        data,
      );
    return true;
  });
  messageHandlers.set("ice-restarted", (data) => {
    const iceParameters = isExternalRecord(data.iceParameters)
      ? data.iceParameters
      : null;
    session.pending.get(String(data.requestId))?.resolve(iceParameters);
  });
  messageHandlers.set("transport-state", (data) => {
    session._handleTransportState(data);
  });
  messageHandlers.set("topology-state", (data) => {
    session.topologyState = { ...data, localPeerId: session.localPeerId };
    const route = recordValue(data.route);
    const targetRoute = recordValue(data.targetRoute);
    const provider = String(
      data?.provider || data?.targetProvider || route?.provider || "",
    );
    const providerId =
      data?.providerId ||
      data?.targetProviderId ||
      route?.providerId ||
      targetRoute?.providerId ||
      null;
    if (provider) session.selectedProvider = provider;
    session.selectedProviderId = providerId == null ? null : String(providerId);
    session._emitState();
  });
  messageHandlers.set("route-commit", (data) => {
    const route = recordValue(data.route) || data;
    session.topologyState = {
      ...session.topologyState,
      ...route,
      route,
      epoch: Number(route?.epoch) || 0,
      sourceRevision: Number(route?.sourceRevision) || 0,
      localPeerId: session.localPeerId,
    };
    const provider = String(route?.provider || data?.targetProvider || "");
    const providerId =
      route?.providerId || data?.targetProviderId || data?.providerId || null;
    if (provider) session.selectedProvider = provider;
    session.selectedProviderId = providerId == null ? null : String(providerId);
    session._emitState();
  });
  messageHandlers.set("provider-failure", (data) => {
    const activeProviderId =
      session.activeSfuProviderId || session.topologyState?.providerId;
    if (
      String(data?.provider || "") === session.activeSfuProvider &&
      (!data?.providerId ||
        !activeProviderId ||
        String(data.providerId) === activeProviderId)
    ) {
      session.mediaConnectionState = "recovering";
      session.connectionPhase = "reconnecting";
      session._emitState();
    }
  });
  messageHandlers.set("provider-draining", (data) => {
    if (session.activeSfuProvider !== "mediasoup") return;
    const failure: ExternalObject = {
      provider: "mediasoup",
      epoch: Number(session.topologyState?.epoch) || 0,
      sourceRevision: Number(session.topologyState?.sourceRevision) || 0,
      reason: String(data?.reason || "provider-draining"),
    };
    if (session.activeSfuProviderId)
      failure.providerId = session.activeSfuProviderId;
    session.signaling?.send?.({ type: "provider-failure", data: failure });
    session.mediaConnectionState = "recovering";
    session.connectionPhase = "reconnecting";
    session._emitState();
  });
  messageHandlers.set("heartbeat-ack", (data) => {
    session._acknowledgeHeartbeat(data);
  });
  messageHandlers.set("heartbeat-nack", (data) => {
    session._acknowledgeHeartbeat(data);
  });
  messageHandlers.set("state-nack", (data) => {
    session._acknowledgeHeartbeat(data);
    const topology = recordValue(data.topology);
    if (!topology || !session.localPeerId) return;
    const digest = recordValue(topology.sourceStates);
    const participantStates = digest
      ? recordValue(digest[session.localPeerId])
      : null;
    const participants = Array.isArray(topology.participants)
      ? topology.participants.filter((entry): entry is ExternalObject =>
          isExternalRecord(entry),
        )
      : [];
    const localParticipant = participants.find(
      (entry) => String(entry.peerId || "") === session.localPeerId,
    );
    const fromList = recordValue(localParticipant?.sourceStates);
    const resolved = participantStates || fromList;
    if (!resolved) return;
    let changed = false;
    for (const [source, value] of Object.entries(resolved)) {
      const state = recordValue(value);
      if (!state) continue;
      const generation = Number(state.generation);
      const desiredState = String(state.desiredState || "inactive");
      if (
        !Number.isSafeInteger(generation) ||
        generation < (session.sourceStates.get(source)?.generation || 0)
      )
        continue;
      session.sourceStates.set(source, { generation, desiredState });
      changed = true;
    }
    if (changed) session._emitState();
  });
  messageHandlers.set("currentlyInChannel", (data) => {
    session.lastInRoom = Array.isArray(data?.inRoom)
      ? data.inRoom.filter((entry): entry is ExternalObject =>
          isExternalRecord(entry),
        )
      : [];
    updateParticipantCapabilities(session, data.inRoom);
    updateParticipantCapabilities(session, data.participants);
    session.onCurrentlyInChannel?.(data);
    session.scheduleCodecRoutingEvaluation();
  });
  messageHandlers.set("media-capabilities", (data) => {
    const participantIds = new Set(
      [data?.participantId, data?.peerId, data?.deviceId, data?.userId]
        .map((value) => String(value || ""))
        .filter(Boolean),
    );
    if (!participantIds.size || !data?.mediaCapabilities) return false;
    const capabilities = normalizeParticipantMediaCapabilities(
      data.mediaCapabilities,
    );
    for (const participantId of participantIds)
      session.remoteParticipantCapabilities.set(participantId, capabilities);
    session._emitState();
    session.scheduleCodecRoutingEvaluation();
    return true;
  });
  messageHandlers.set("participant-capabilities", (data) => {
    const participantIds = new Set(
      [data?.participantId, data?.peerId, data?.deviceId, data?.userId]
        .map((value) => String(value || ""))
        .filter(Boolean),
    );
    if (!participantIds.size || !data?.mediaCapabilities) return false;
    const capabilities = normalizeParticipantMediaCapabilities(
      data.mediaCapabilities,
    );
    for (const participantId of participantIds)
      session.remoteParticipantCapabilities.set(participantId, capabilities);
    session._emitState();
    session.scheduleCodecRoutingEvaluation();
    return true;
  });
  messageHandlers.set("codec-routing-plan", (data) => {
    const plan = codecRoutingPlan(data.plan || data);
    if (!plan) return false;
    return session.applyCodecRoutingPlan(plan);
  });
  messageHandlers.set("codec-routing-retire", async (data) => {
    const variantIds = Array.isArray(data?.variantIds)
      ? data.variantIds.map(String).filter(Boolean)
      : [];
    const results = await Promise.all(
      variantIds.map((variantId) => session.removeVariant(variantId)),
    );
    return results.every((result) => result !== false);
  });
  messageHandlers.set("codec-migration-state", (data) =>
    session.handleCodecMigrationState(data),
  );
  messageHandlers.set("error", (data) => session._handleServerError(data));
  messageHandlers.set("p2p-signal", (data) => session.onP2pSignal?.(data));
}
