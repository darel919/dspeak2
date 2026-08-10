import { closeSocketOnPageHide } from "./socket-lifecycle.js";
import { mediaDebug, shortMediaId } from "./media-debug.js";

export function mediaSignalingUrl(
  configuredPath,
  channelId,
  location = globalThis.window?.location || {
    protocol: "http:",
    host: "localhost",
  },
  accessToken = "",
) {
  if (typeof configuredPath === "string" && /^wss?:\/\//.test(configuredPath)) {
    const endpoint = new URL(configuredPath);
    endpoint.searchParams.set("channelId", channelId);
    if (accessToken) endpoint.searchParams.set("accessToken", accessToken);
    return endpoint.toString();
  }
  const origin = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`;
  const base = configuredPath || `${origin}/socket`;
  const separator = base.includes("?") ? "&" : "?";
  const token = accessToken
    ? `&accessToken=${encodeURIComponent(accessToken)}`
    : "";
  return `${base}${separator}channelId=${encodeURIComponent(channelId)}${token}`;
}

export function closeMediaSignalingForRecovery(socket) {
  try {
    socket?.close(4000, "Media signaling session recovery required");
  } catch (error) {
    console.warn("[Media] failed to recycle signaling socket", error);
  }
}

export function createMediaSignalingSocket({
  buildHeartbeatData,
  buildClientHelloData,
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
  reconnectBaseDelayMs = 500,
  reconnectJitterMs = 250,
  reconnectMaxDelayMs = 10000,
  reconnectMaxElapsedMs = 120000,
}) {
  let socket = null;
  let pendingReady = null;
  let heartbeatTimer = null;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let reconnectStartedAt = 0;
  let heartbeatSequence = 0;
  let lastHeartbeatAckSequence = 0;
  let lastHeartbeatAckAt = 0;
  let heartbeatIntervalMs = defaultHeartbeatIntervalMs;
  let heartbeatTimeoutMs = defaultHeartbeatTimeoutMs;
  let protocolState = null;

  function reportError(error) {
    try {
      onError(error);
    } catch (reportingError) {
      console.error("[Media] signaling error reporter failed", reportingError);
    }
  }

  function send(message) {
    if (isIntentionalClose()) return false;
    if (socket?.readyState !== WebSocket.OPEN) {
      if (socket && socket.readyState !== WebSocket.CLOSED)
        socket.close(4000, "Media signaling socket is not writable");
      return false;
    }
    try {
      socket.send(JSON.stringify(message));
      mediaDebug("control.send", {
        type: message?.type,
        sequence: message?.data?.sequence,
      });
      return true;
    } catch (error) {
      mediaDebug("control.send-failed", { type: message?.type, error });
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
      try {
        if (Date.now() - lastHeartbeatAckAt >= heartbeatTimeoutMs) {
          console.warn("[Media] signaling heartbeat acknowledgement timed out");
          mediaDebug("control.heartbeat-timeout", {
            sequence: heartbeatSequence,
            lastAckSequence: lastHeartbeatAckSequence,
          });
          socket?.close(4000, "Signaling heartbeat timed out");
          return;
        }
        heartbeatSequence += 1;
        send({
          type: "heartbeat",
          data: buildHeartbeatData(heartbeatSequence),
        });
      } catch (error) {
        reportError(error);
        socket?.close(4000, "Signaling heartbeat failed");
      }
    };
    heartbeat();
    heartbeatTimer = setInterval(heartbeat, heartbeatIntervalMs);
  }

  function stopReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function open() {
    if (pendingReady?.promise) return pendingReady.promise;
    if (socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    stopReconnect();
    const promise = new Promise((resolve, reject) => {
      let candidate;
      try {
        candidate = new WebSocket(buildUrl());
      } catch (error) {
        reject(error);
        if (!isIntentionalClose()) scheduleReconnect();
        return;
      }
      socket = candidate;
      mediaDebug("control.socket-created", {
        reconnectAttempt,
        reconnecting: reconnectAttempt > 0,
      });
      closeSocketOnPageHide(candidate);
      const timeout = setTimeout(() => {
        candidate.close(4000, "Media signaling connection timed out");
        pendingReady = null;
        reject(new Error("Media signaling connection timed out"));
        if (!isIntentionalClose()) scheduleReconnect();
      }, connectionTimeoutMs);
      pendingReady = { candidate, resolve, reject, timeout, promise: null };
      candidate.onopen = () => {
        if (socket !== candidate) return;
        mediaDebug("control.socket-open");
        try {
          onOpen();
        } catch (error) {
          reportError(error);
          candidate.close(4000, "Media signaling open handler failed");
        }
      };
      candidate.onmessage = (event) => {
        if (socket !== candidate) return;
        try {
          mediaDebug("control.message-received", {
            bytes: typeof event.data === "string" ? event.data.length : null,
          });
          handleMessage(event.data);
        } catch (error) {
          reportError(error);
          candidate.close(4000, "Media signaling message handler failed");
        }
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
        mediaDebug("control.socket-close", {
          code: event.code,
          reason: event.reason,
          protocolRejected: event.code === protocol.closeCode,
        });
        const protocolRejected = event.code === protocol.closeCode;
        if (protocolRejected) {
          try {
            onProtocolRejected(event);
          } catch (error) {
            reportError(error);
          }
        }
        try {
          onClose(event, protocolRejected);
        } catch (error) {
          reportError(error);
        } finally {
          if (!isIntentionalClose() && !protocolRejected) scheduleReconnect();
        }
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
    mediaDebug("control.server-hello", {
      mediaSessionId: shortMediaId(data.mediaSessionId),
      protocolVersion: data.protocolVersion,
      contractRevision: data.contractRevision,
      heartbeatIntervalMs: data.heartbeatIntervalMs,
    });
    heartbeatIntervalMs = data.heartbeatIntervalMs;
    heartbeatTimeoutMs = data.heartbeatTimeoutMs;
    return send({
      type: protocol.clientHello,
      data: {
        protocolVersion: protocol.version,
        contractRevision: protocol.contractRevision,
        ...buildClientHelloData?.({ mediaSessionId: data.mediaSessionId }),
        mediaSessionId: data.mediaSessionId,
      },
    });
  }

  function markReady() {
    const pending = pendingReady;
    if (pending?.candidate !== socket) return false;
    clearTimeout(pending.timeout);
    stopReconnect();
    pendingReady = null;
    reconnectAttempt = 0;
    reconnectStartedAt = 0;
    startHeartbeat();
    mediaDebug("control.ready", {
      mediaSessionId: shortMediaId(protocolState?.mediaSessionId),
    });
    pending.resolve();
    return true;
  }

  function scheduleReconnect() {
    if (reconnectTimer || isIntentionalClose()) return;
    if (!reconnectStartedAt) reconnectStartedAt = Date.now();
    if (Date.now() - reconnectStartedAt >= reconnectMaxElapsedMs) {
      reportError(new Error("Media control recovery window expired"));
      return;
    }
    const delay =
      Math.min(
        reconnectMaxDelayMs,
        reconnectBaseDelayMs * 2 ** reconnectAttempt,
      ) + Math.floor(Math.random() * reconnectJitterMs);
    reconnectAttempt += 1;
    mediaDebug("control.reconnect-scheduled", {
      attempt: reconnectAttempt,
      delay,
    });
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      try {
        await onReconnect?.();
      } catch (error) {
        reportError(error);
        if (!isIntentionalClose()) scheduleReconnect();
        return;
      }
      try {
        await open();
      } catch (error) {
        if (!isIntentionalClose()) {
          reportError(error);
          scheduleReconnect();
        }
      }
    }, delay);
  }

  function stop() {
    stopReconnect();
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
    const detail = error?.message || String(error || "Unknown handler error");
    const failure = new Error(
      `Media message handling failed for ${message.type}: ${detail}`,
    );
    failure.code = "MEDIA_MESSAGE_HANDLER_FAILED";
    failure.cause = error;
    onFailure(failure);
  });
}
