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
  protocol,
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
    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch {
      socket.close(4000, "Media signaling send failed");
      return false;
    }
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
    if (pendingReady?.promise) return pendingReady.promise;
    if (socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    const promise = new Promise((resolve, reject) => {
      const candidate = new WebSocket(buildUrl());
      socket = candidate;
      const timeout = setTimeout(() => {
        candidate.close(4000, "Media signaling connection timed out");
        pendingReady = null;
        reject(new Error("Media signaling connection timed out"));
      }, connectionTimeoutMs);
      pendingReady = { candidate, resolve, reject, timeout, promise: null };
      candidate.onopen = () => {
        if (socket === candidate) onOpen();
      };
      candidate.onmessage = (event) => {
        if (socket === candidate) handleMessage(event.data);
      };
      candidate.onerror = () => {
        candidate.close(4000, "Media signaling connection failed");
      };
      candidate.onclose = (event) => {
        clearTimeout(timeout);
        if (socket !== candidate) return;
        if (pendingReady?.candidate === candidate) {
          pendingReady = null;
          const closeError = new Error(
            event.code === protocol.closeCode
              ? protocol.closeReason
              : "Media signaling connection closed",
          );
          closeError.code =
            event.code === protocol.closeCode
              ? "MEDIA_PROTOCOL_UPDATE_REQUIRED"
              : "MEDIA_SIGNALING_CLOSED";
          reject(closeError);
        }
        socket = null;
        protocolState = null;
        stopHeartbeat();
        const protocolRejected = event.code === protocol.closeCode;
        if (protocolRejected) onProtocolRejected(event);
        onClose(event, protocolRejected);
        if (!isIntentionalClose() && !protocolRejected) scheduleReconnect();
      };
    });
    if (pendingReady) pendingReady.promise = promise;
    return promise;
  }

  function acceptServerHello(data) {
    if (!protocol.isServerHello(data)) {
      socket?.close(protocol.closeCode, protocol.closeReason);
      return false;
    }
    protocolState = { ...data };
    heartbeatIntervalMs = data.heartbeatIntervalMs;
    heartbeatTimeoutMs = data.heartbeatTimeoutMs;
    return send({
      type: protocol.clientHello,
      data: {
        protocolVersion: protocol.version,
        contractRevision: protocol.contractRevision,
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
        if (!isIntentionalClose()) {
          onError(error);
          scheduleReconnect();
        }
      }
    }, delay);
  }

  function stop() {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    const pending = pendingReady;
    pendingReady = null;
    if (pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Media signaling connection stopped"));
    }
    stopHeartbeat();
    socket?.close(1000, "Media signaling stopped");
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
