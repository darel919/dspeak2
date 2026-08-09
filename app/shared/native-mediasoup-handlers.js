export function installHandlers(session) {
  session.messageHandlers.set("hi919", (data) => {
    if (session.signaling.acceptServerHello(data))
      session.protocolState = session.signaling.getProtocolState();
  });
  session.messageHandlers.set("connected", (data) => {
    session.connected = true;
    session.localPeerId = String(data?.peerId || "");
    session.closed = false;
    session.connectionPhase = "signaling-ready";
    session.signaling.markReady();
    session.onCurrentlyInChannel?.(data);
    session._resolveConnect();
    session._emitState();
    if (!session.controlTicket)
      session._startNegotiation().catch((error) => session._fail(error));
  });
  session.messageHandlers.set("provider-ticket", (data) => {
    session._handleProviderTicket(data).catch((error) => session._fail(error));
  });
  session.messageHandlers.set("rtp-capabilities", (data) =>
    session._handleRtpCapabilities(data),
  );
  session.messageHandlers.set("transport-params", (data) =>
    session._handleTransportParams(data),
  );
  session.messageHandlers.set("transport-connected", (data) => {
    session.pending.get(data.requestId)?.resolve(data);
  });
  session.messageHandlers.set("producer-id", (data) => {
    session.pendingProduce.get(data.requestId)?.resolve({ id: data.id });
  });
  session.messageHandlers.set("consumer-params", (data) =>
    session._createConsumer(data),
  );
  session.messageHandlers.set("new-producer", (data) => {
    session.requestConsumer(data.producerId);
  });
  session.messageHandlers.set("available-producers", (data) => {
    for (const producerId of data?.producers || [])
      session.requestConsumer(producerId);
  });
  session.messageHandlers.set("producer-closed", (data) => {
    session.closeConsumerByProducer(data.producerId);
  });
  session.messageHandlers.set("consumer-resumed", (data) => {
    session._resolveConsumerControl(data, true);
  });
  session.messageHandlers.set("consumer-paused", (data) => {
    session._resolveConsumerControl(data, false);
  });
  session.messageHandlers.set("ice-restarted", (data) => {
    session.pending.get(data.requestId)?.resolve(data.iceParameters);
  });
  session.messageHandlers.set("transport-state", (data) => {
    session._handleTransportState(data);
  });
  session.messageHandlers.set("topology-state", (data) => {
    session.topologyState = { ...data, localPeerId: session.localPeerId };
    session._emitState();
  });
  session.messageHandlers.set("route-commit", (data) => {
    const route = data?.route || data;
    session.topologyState = {
      ...session.topologyState,
      ...route,
      route,
      epoch: Number(route?.epoch) || 0,
      sourceRevision: Number(route?.sourceRevision) || 0,
      localPeerId: session.localPeerId,
    };
    session._emitState();
  });
  session.messageHandlers.set("provider-failure", (data) => {
    if (data?.provider === session.selectedProvider) {
      session.mediaConnectionState = "recovering";
      session.connectionPhase = "reconnecting";
      session._emitState();
    }
  });
  session.messageHandlers.set("provider-draining", (data) => {
    const failure = {
      provider: "mediasoup",
      epoch: Number(session.topologyState?.epoch) || 0,
      reason: data?.reason || "provider-draining",
    };
    session.signaling?.send?.({ type: "provider-failure", data: failure });
    session.mediaConnectionState = "recovering";
    session.connectionPhase = "reconnecting";
    session._emitState();
  });
  session.messageHandlers.set("heartbeat-ack", (data) => {
    session._acknowledgeHeartbeat(data);
  });
  session.messageHandlers.set("heartbeat-nack", (data) => {
    session._acknowledgeHeartbeat(data);
  });
  session.messageHandlers.set("currentlyInChannel", (data) => {
    session.lastInRoom = Array.isArray(data?.inRoom) ? data.inRoom : [];
    session.onCurrentlyInChannel?.(data);
  });
  session.messageHandlers.set("error", (data) =>
    session._handleServerError(data),
  );
  session.messageHandlers.set("p2p-signal", (data) =>
    session.onP2pSignal?.(data),
  );
}
