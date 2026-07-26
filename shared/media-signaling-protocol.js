export const MEDIA_SIGNALING_PROTOCOL_VERSION = 919;
export const MEDIA_SIGNALING_SERVER_HELLO = "hi919";
export const MEDIA_SIGNALING_CLIENT_HELLO = "hello919";
export const MEDIA_SIGNALING_PROTOCOL_CLOSE_CODE = 4002;
export const MEDIA_SIGNALING_PROTOCOL_CLOSE_REASON =
  "Media client update required";
export const MEDIA_SIGNALING_HANDSHAKE_TIMEOUT_MS = 10_000;
export const MEDIA_SIGNALING_TRACE_LIMIT = 64;
export const MEDIA_SIGNALING_HEARTBEAT_INTERVAL_MS = 5_000;
export const MEDIA_SIGNALING_HEARTBEAT_TIMEOUT_MS = 20_000;

export function isMediaSignalingServerHello(data) {
  return (
    data?.protocolVersion === MEDIA_SIGNALING_PROTOCOL_VERSION &&
    typeof data.mediaSessionId === "string" &&
    data.mediaSessionId.length > 0 &&
    data.mediaSessionId.length <= 160 &&
    Number.isInteger(data.heartbeatIntervalMs) &&
    data.heartbeatIntervalMs >= 1_000 &&
    Number.isInteger(data.heartbeatTimeoutMs) &&
    data.heartbeatTimeoutMs > data.heartbeatIntervalMs &&
    Number.isFinite(data.serverTime)
  );
}

export function isMediaSignalingClientHello(data, mediaSessionId) {
  return (
    data?.protocolVersion === MEDIA_SIGNALING_PROTOCOL_VERSION &&
    typeof data.mediaSessionId === "string" &&
    data.mediaSessionId === mediaSessionId
  );
}

export function classifyMediaSignalingClientHello({
  data,
  mediaSessionId,
  protocolReady,
  type,
}) {
  if (protocolReady)
    return type === MEDIA_SIGNALING_CLIENT_HELLO ? "duplicate" : "ready";
  if (
    type === MEDIA_SIGNALING_CLIENT_HELLO &&
    isMediaSignalingClientHello(data, mediaSessionId)
  )
    return "accept";
  return "reject";
}
