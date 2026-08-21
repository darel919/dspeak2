import type {
  MediasoupClientSessionLike,
  MediasoupTransportState,
} from "./types/mediasoup-client.ts";

export function getMediasoupConnectionState(
  session: MediasoupClientSessionLike,
) {
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

export function handleMediasoupTransportState(
  session: MediasoupClientSessionLike,
  data: Record<string, unknown>,
) {
  const direction = data.direction;
  if (direction !== "send" && direction !== "recv") return false;
  const state = data.state === "completed" ? "connected" : data.state;
  const validState: MediasoupTransportState | null =
    state === "new" ||
    state === "connecting" ||
    state === "connected" ||
    state === "disconnected" ||
    state === "failed" ||
    state === "closed"
      ? state
      : null;
  if (!validState) return false;
  session.transportStates.set(direction, validState);
  const summary = getMediasoupConnectionState(session);
  session.onStateChange?.(direction, validState, summary);
  session.handleTransportRecovery(direction, validState);
  return true;
}
