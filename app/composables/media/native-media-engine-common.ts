export const NATIVE_ACTION_POLL_IDLE_MS = 100;
export const NATIVE_ACTION_POLL_ACTIVE_MS = 5;

export const NATIVE_EVENT_NAMES = [
  "media:state",
  "media:local-track",
  "media:producer-created",
  "media:producer-closed",
  "media:consumer-created",
  "media:ice-state",
  "media:signal",
  "media:stats",
  "media:device-change",
  "media:permission",
  "media:error",
];

export const EVENT_ALIASES = Object.freeze({
  "media:state": "state",
  "media:local-track": "local-track",
  "media:producer-created": "producer-created",
  "media:producer-closed": "producer-closed",
  "media:consumer-created": "consumer-created",
  "media:ice-state": "ice-state",
  "media:signal": "signal",
  "media:stats": "stats",
  "media:device-change": "device-change",
  "media:permission": "permission",
  "media:error": "error",
});

export const DEFAULT_FLAGS = Object.freeze({
  nativeRtc: false,
  nativeBackendReady: false,
  nativeScreenShare: false,
  nativeScreenAudio: false,
  nativeP2P: false,
  nativeSfu: false,
  nativeMicrophone: false,
  nativeCamera: false,
  nativeAudioReceive: false,
  nativeVideoReceive: false,
});

export function nativeOnlyError(operation) {
  return new Error(`Native WebRTC operation is unavailable: ${operation}`);
}

export function capabilityBackend(enabled, hybrid = false, nativeOnly = false) {
  if (!enabled) return nativeOnly ? "unavailable" : "browser";
  return hybrid ? "hybrid" : "native";
}

export function hasNativeCapability(flags) {
  return flags.nativeRtc === true && flags.nativeBackendReady === true;
}

export function canAttemptNativeCapture(flags) {
  return hasNativeCapability(flags);
}

export function getCaptureSelection(request) {
  if (request?.captureSelection) return request.captureSelection;
  if (
    request?.source &&
    typeof request.source === "object" &&
    typeof request.source.sourceId === "string"
  )
    return request;
  return null;
}

export function isSourceAwareCaptureRequest(request) {
  const selection = getCaptureSelection(request);
  return Boolean(
    selection &&
    typeof selection === "object" &&
    selection.source &&
    typeof selection.source.sourceId === "string" &&
    typeof selection.source.sourceType === "string" &&
    typeof selection.source.sourceKey === "string",
  );
}

export function channelMediaPolicy(channelsStore, voiceStore) {
  return (
    channelsStore?.getChannelById?.(voiceStore?.currentChannelId)
      ?.mediaPolicy || null
  );
}
