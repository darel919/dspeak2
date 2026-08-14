import type { NativeMediasoupSfuSession } from "./native-mediasoup-session.ts";
import { normalizeParticipantMediaCapabilities } from "./types/video-codec-capabilities.ts";
import type { CodecRoutingPlan } from "./video-codec-routing.ts";

type NativeMessageHandler = (data: Record<string, unknown>) => unknown;

function producerAnnouncementMetadata(value: unknown) {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const appData =
    record.appData && typeof record.appData === "object"
      ? (record.appData as Record<string, unknown>)
      : {};
  return { ...appData, ...record };
}

function updateParticipantCapabilities(
  session: NativeMediasoupSfuSession,
  values: unknown,
) {
  if (!Array.isArray(values)) return;
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
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

export function installHandlers(session: NativeMediasoupSfuSession) {
  const messageHandlers = session.messageHandlers as Map<
    string,
    NativeMessageHandler
  >;
  messageHandlers.set("hi919", (data) => {
    if (session.signaling?.acceptServerHello(data))
      session.protocolState = session.signaling.getProtocolState();
  });
  messageHandlers.set("connected", (data) => {
    session.connected = true;
    session.localPeerId = String(data?.peerId || "");
    session.lastInRoom = Array.isArray(data?.inRoom)
      ? data.inRoom.filter(
          (entry): entry is Record<string, unknown> =>
            Boolean(entry) && typeof entry === "object",
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
        .catch((error: unknown) => session._fail(error));
  });
  messageHandlers.set("provider-ticket", (data) => {
    session
      ._handleProviderTicket(data)
      .catch((error: unknown) => session._fail(error));
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
    session.remoteProducerMetadata.set(producerId, {
      ...(session.remoteProducerMetadata.get(producerId) || {}),
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
            (typeof producer === "string" || typeof producer === "number"
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
    session.cloudflareSession?.handleMessage("cloudflare-response", data),
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
    session.pending.get(String(data.requestId))?.resolve(data.iceParameters);
  });
  messageHandlers.set("transport-state", (data) => {
    session._handleTransportState(data);
  });
  messageHandlers.set("topology-state", (data) => {
    session.topologyState = { ...data, localPeerId: session.localPeerId };
    const route =
      data?.route && typeof data.route === "object"
        ? (data.route as Record<string, unknown>)
        : null;
    const targetRoute =
      data?.targetRoute && typeof data.targetRoute === "object"
        ? (data.targetRoute as Record<string, unknown>)
        : null;
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
    const route =
      data?.route && typeof data.route === "object"
        ? (data.route as Record<string, unknown>)
        : data;
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
    const failure = {
      provider: "mediasoup",
      ...(session.activeSfuProviderId
        ? { providerId: session.activeSfuProviderId }
        : {}),
      epoch: Number(session.topologyState?.epoch) || 0,
      sourceRevision: Number(session.topologyState?.sourceRevision) || 0,
      reason: String(data?.reason || "provider-draining"),
    };
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
  messageHandlers.set("currentlyInChannel", (data) => {
    session.lastInRoom = Array.isArray(data?.inRoom)
      ? data.inRoom.filter(
          (entry): entry is Record<string, unknown> =>
            Boolean(entry) && typeof entry === "object",
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
    const rawPlan =
      data?.plan && typeof data.plan === "object" ? data.plan : data;
    if (!rawPlan || typeof rawPlan !== "object") return false;
    return session.applyCodecRoutingPlan(rawPlan as CodecRoutingPlan);
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
