import {
  classifyMediaSignalingClientHello,
  MEDIA_SIGNALING_CLIENT_HELLO,
  MEDIA_SIGNALING_HANDSHAKE_TIMEOUT_MS,
  MEDIA_SIGNALING_HEARTBEAT_INTERVAL_MS,
  MEDIA_SIGNALING_HEARTBEAT_TIMEOUT_MS,
  MEDIA_SIGNALING_PROTOCOL_CLOSE_CODE,
  MEDIA_SIGNALING_PROTOCOL_CLOSE_REASON,
  MEDIA_SIGNALING_PROTOCOL_VERSION,
  MEDIA_SIGNALING_SERVER_HELLO,
} from "../../shared/media-signaling-protocol.js";

export function startMediaProtocolHandshake({
  close,
  mediaSessionId,
  now = Date.now,
  onTimeout,
  send,
  session,
  setTimer = setTimeout,
}) {
  session.handshakeTimer = setTimer(() => {
    if (session.protocolReady || session.closed) return;
    console.warn("[SFU] media signaling handshake timed out", {
      mediaSessionId,
    });
    onTimeout();
    close(
      MEDIA_SIGNALING_PROTOCOL_CLOSE_CODE,
      MEDIA_SIGNALING_PROTOCOL_CLOSE_REASON,
    );
  }, MEDIA_SIGNALING_HANDSHAKE_TIMEOUT_MS);
  session.handshakeTimer.unref?.();
  send(MEDIA_SIGNALING_SERVER_HELLO, {
    protocolVersion: MEDIA_SIGNALING_PROTOCOL_VERSION,
    heartbeatIntervalMs: MEDIA_SIGNALING_HEARTBEAT_INTERVAL_MS,
    heartbeatTimeoutMs: MEDIA_SIGNALING_HEARTBEAT_TIMEOUT_MS,
    serverTime: now(),
    mediaSessionId,
  });
}

export function createPendingMediaProtocolSession({
  deviceId,
  mediaSessionId,
  peer,
  profile,
  room,
  signalingBudget,
  userId,
}) {
  return {
    peer,
    userId,
    deviceId,
    profile,
    room,
    transports: new Map(),
    producers: new Map(),
    consumers: new Map(),
    sources: new Set(),
    muted: true,
    deafened: false,
    rtpCapabilities: null,
    queue: Promise.resolve(),
    queueDepth: 0,
    ...signalingBudget,
    closed: false,
    activated: false,
    protocolReady: false,
    mediaSessionId,
    roomReservationHeld: true,
    handshakeTimer: null,
    lastHeartbeatAt: Date.now(),
  };
}

export async function handleMediaProtocolHandshake({
  activate,
  close,
  message,
  onReject,
  session,
}) {
  const decision = classifyMediaSignalingClientHello({
    data: message.data,
    mediaSessionId: session.mediaSessionId,
    protocolReady: session.protocolReady,
    type: message.type,
  });
  if (!session.protocolReady && decision === "accept") {
    session.protocolReady = true;
    session.lastHeartbeatAt = Date.now();
    await activate();
    return true;
  }
  if (!session.protocolReady || decision === "duplicate") {
    onReject(decision === "duplicate" ? "duplicate" : "rejected");
    close(
      MEDIA_SIGNALING_PROTOCOL_CLOSE_CODE,
      MEDIA_SIGNALING_PROTOCOL_CLOSE_REASON,
    );
    return true;
  }
  return message.type === MEDIA_SIGNALING_CLIENT_HELLO;
}

export async function activateMediaProtocolSession({
  closeSuperseded,
  createUserState,
  persistPresence,
  reconcile,
  releaseReservation,
  sendConnected,
  session,
  supersededSessions,
  synchronizeChannel,
}) {
  if (session.activated || session.closed) return false;
  session.activated = true;
  clearTimeout(session.handshakeTimer);
  session.handshakeTimer = null;
  if (session.roomReservationHeld) {
    releaseReservation();
    session.roomReservationHeld = false;
  }
  const predecessors = supersededSessions();
  session.room.sessions.set(session.peer.id, session);
  for (const superseded of predecessors) closeSuperseded(superseded);
  sendConnected();
  synchronizeChannel();
  reconcile();
  const results = await Promise.allSettled([
    persistPresence(),
    createUserState(),
  ]);
  for (const result of results) {
    if (result.status === "rejected")
      console.error(
        "[SFU] failed to persist opened media session",
        result.reason,
      );
  }
  return true;
}
