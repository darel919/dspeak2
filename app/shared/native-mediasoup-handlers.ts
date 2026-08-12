import type { NativeMediasoupSfuSession } from "./native-mediasoup-session.ts";

type NativeMessageHandler = (data: Record<string, unknown>) => unknown;

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
    session.closed = false;
    session.connectionPhase = "signaling-ready";
    session.signaling?.markReady();
    session.onCurrentlyInChannel?.(data);
    session._resolveConnect();
    session._emitState();
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
    session.requestConsumer(String(data.producerId || ""));
  });
  messageHandlers.set("available-producers", (data) => {
    if (Array.isArray(data?.producers))
      for (const producerId of data.producers)
        session.requestConsumer(String(producerId));
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
    session.onCurrentlyInChannel?.(data);
  });
  messageHandlers.set("error", (data) => session._handleServerError(data));
  messageHandlers.set("p2p-signal", (data) => session.onP2pSignal?.(data));
}
