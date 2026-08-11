export function getMediasoupConnectionState(session) {
  const sendRequired = session.sources.size > 0;
  const receiveRequired =
    session.consumers.size > 0 || session.requestedConsumers.size > 0;
  const sendConnected =
    !sendRequired || session.transportStates.get("send") === "connected";
  const receiveConnected =
    !receiveRequired || session.transportStates.get("recv") === "connected";
  return {
    ready: sendConnected && receiveConnected,
    sendRequired,
    receiveRequired,
    send: session.transportStates.get("send") || "new",
    recv: session.transportStates.get("recv") || "new",
  };
}

export function handleMediasoupTransportState(session, data) {
  const direction = data?.direction;
  if (direction !== "send" && direction !== "recv") return false;
  const state = data.state === "completed" ? "connected" : data.state;
  if (
    ![
      "new",
      "connecting",
      "connected",
      "disconnected",
      "failed",
      "closed",
    ].includes(state)
  )
    return false;
  session.transportStates.set(direction, state);
  const summary = getMediasoupConnectionState(session);
  session.onStateChange?.(direction, state, summary);
  session.handleTransportRecovery(direction, state);
  return true;
}
