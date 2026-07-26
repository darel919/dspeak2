import {
  isMediaSignalingServerHello,
  MEDIA_SIGNALING_CLIENT_HELLO,
  MEDIA_SIGNALING_PROTOCOL_CLOSE_CODE,
  MEDIA_SIGNALING_PROTOCOL_CLOSE_REASON,
  MEDIA_SIGNALING_PROTOCOL_VERSION,
} from "~~/shared/media-signaling-protocol.js";

export function createMediaSignalingSocket({
  buildHeartbeatData,
  buildUrl,
  connectionTimeoutMs,
  defaultHeartbeatIntervalMs,
  defaultHeartbeatTimeoutMs,
  handleMessage,
  isIntentionalClose,
  onClose,
  onError,
  onOpen,
  onProtocolRejected,
  onReconnect,
}) {
  let socket = null;
  let pendingReady = null;
  let heartbeatTimer = null;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let heartbeatSequence = 0;
  let lastHeartbeatAckSequence = 0;
  let lastHeartbeatAckAt = 0;
  let heartbeatIntervalMs = defaultHeartbeatIntervalMs;
  let heartbeatTimeoutMs = defaultHeartbeatTimeoutMs;
  let protocolState = null;

  function send(message) {
    if (isIntentionalClose()) return false;
    if (socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }

  function stopHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function startHeartbeat() {
    stopHeartbeat();
    lastHeartbeatAckAt = Date.now();
    lastHeartbeatAckSequence = heartbeatSequence;
    const heartbeat = () => {
      if (Date.now() - lastHeartbeatAckAt >= heartbeatTimeoutMs) {
        console.warn("[Media] signaling heartbeat acknowledgement timed out");
        socket?.close(4000, "Signaling heartbeat timed out");
        return;
      }
      heartbeatSequence += 1;
      send({
        type: "heartbeat",
        data: buildHeartbeatData(heartbeatSequence),
      });
    };
    heartbeat();
    heartbeatTimer = setInterval(heartbeat, heartbeatIntervalMs);
  }

  function open() {
    return new Promise((resolve, reject) => {
      const candidate = new WebSocket(buildUrl());
      socket = candidate;
      const timeout = setTimeout(() => {
        candidate.close(4000, "Media signaling connection timed out");
        pendingReady = null;
        reject(new Error("Media signaling connection timed out"));
      }, connectionTimeoutMs);
      pendingReady = { candidate, resolve, reject, timeout };
      candidate.onopen = () => {
        if (socket === candidate) onOpen();
      };
      candidate.onmessage = (event) => {
        if (socket === candidate) handleMessage(event.data);
      };
      candidate.onerror = () => {
        clearTimeout(timeout);
        pendingReady = null;
        reject(new Error("Media signaling connection failed"));
      };
      candidate.onclose = (event) => {
        clearTimeout(timeout);
        if (socket !== candidate) return;
        if (pendingReady?.candidate === candidate) {
          pendingReady = null;
          const closeError = new Error(
            event.code === MEDIA_SIGNALING_PROTOCOL_CLOSE_CODE
              ? MEDIA_SIGNALING_PROTOCOL_CLOSE_REASON
              : "Media signaling connection closed",
          );
          closeError.code =
            event.code === MEDIA_SIGNALING_PROTOCOL_CLOSE_CODE
              ? "MEDIA_PROTOCOL_UPDATE_REQUIRED"
              : "MEDIA_SIGNALING_CLOSED";
          reject(closeError);
        }
        socket = null;
        protocolState = null;
        stopHeartbeat();
        const protocolRejected =
          event.code === MEDIA_SIGNALING_PROTOCOL_CLOSE_CODE;
        if (protocolRejected) onProtocolRejected(event);
        onClose(event, protocolRejected);
        if (!isIntentionalClose() && !protocolRejected) scheduleReconnect();
      };
    });
  }

  function acceptServerHello(data) {
    if (!isMediaSignalingServerHello(data)) {
      socket?.close(
        MEDIA_SIGNALING_PROTOCOL_CLOSE_CODE,
        MEDIA_SIGNALING_PROTOCOL_CLOSE_REASON,
      );
      return false;
    }
    protocolState = { ...data };
    heartbeatIntervalMs = data.heartbeatIntervalMs;
    heartbeatTimeoutMs = data.heartbeatTimeoutMs;
    return send({
      type: MEDIA_SIGNALING_CLIENT_HELLO,
      data: {
        protocolVersion: MEDIA_SIGNALING_PROTOCOL_VERSION,
        mediaSessionId: data.mediaSessionId,
      },
    });
  }

  function markReady() {
    const pending = pendingReady;
    if (pending?.candidate !== socket) return false;
    clearTimeout(pending.timeout);
    pendingReady = null;
    reconnectAttempt = 0;
    startHeartbeat();
    pending.resolve();
    return true;
  }

  function scheduleReconnect() {
    if (reconnectTimer || isIntentionalClose()) return;
    const delay =
      Math.min(10000, 500 * 2 ** reconnectAttempt) +
      Math.floor(Math.random() * 250);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      onReconnect();
      try {
        await open();
      } catch (error) {
        onError(error);
        scheduleReconnect();
      }
    }, delay);
  }

  function stop() {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (pendingReady) clearTimeout(pendingReady.timeout);
    pendingReady = null;
    stopHeartbeat();
  }

  return {
    acceptServerHello,
    acknowledgeHeartbeat: (sequence, acknowledgedAt) => {
      lastHeartbeatAckSequence = sequence;
      lastHeartbeatAckAt = acknowledgedAt;
    },
    getHeartbeatSequence: () => heartbeatSequence,
    getLastHeartbeatAckSequence: () => lastHeartbeatAckSequence,
    getProtocolState: () => protocolState,
    getSocket: () => socket,
    markReady,
    open,
    send,
    stop,
  };
}

export function dispatchMediaSignalingMessage(raw, { getHandler, onFailure }) {
  let message;
  try {
    if (typeof raw !== "string" || raw.length > 96000)
      throw new Error("Invalid signaling payload");
    message = JSON.parse(raw);
  } catch {
    onFailure("The media server sent an invalid message");
    return;
  }
  const handler = getHandler(message.type);
  if (!handler) return;
  Promise.resolve(handler(message.data || {})).catch((error) => {
    onFailure(error.message || "Media message handling failed");
  });
}
