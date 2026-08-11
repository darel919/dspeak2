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

export function nativeOnlyError(operation: string): Error {
  return new Error(`Native WebRTC operation is unavailable: ${operation}`);
}

export function capabilityBackend(
  enabled: boolean,
  hybrid = false,
  nativeOnly = false,
): "unavailable" | "browser" | "hybrid" | "native" {
  if (!enabled) return nativeOnly ? "unavailable" : "browser";
  return hybrid ? "hybrid" : "native";
}

export function hasNativeCapability(flags: NativeMediaFlags): boolean {
  return flags.nativeRtc === true && flags.nativeBackendReady === true;
}

export function canAttemptNativeCapture(flags: NativeMediaFlags): boolean {
  return hasNativeCapability(flags);
}

export function getCaptureSelection(
  request: NativeCaptureRequest | null | undefined,
): NativeCaptureRequest | null {
  const selection = request?.captureSelection;
  if (selection && typeof selection === "object" && !Array.isArray(selection))
    return selection as NativeCaptureRequest;
  const source = request?.source;
  if (
    source &&
    typeof source === "object" &&
    !Array.isArray(source) &&
    typeof (source as Record<string, unknown>).sourceId === "string"
  )
    return request;
  return null;
}

export function isSourceAwareCaptureRequest(
  request: NativeCaptureRequest | null | undefined,
): boolean {
  const selection = getCaptureSelection(request);
  return Boolean(
    selection &&
    typeof selection === "object" &&
    selection.source &&
    typeof selection.source === "object" &&
    !Array.isArray(selection.source) &&
    typeof (selection.source as Record<string, unknown>).sourceId ===
      "string" &&
    typeof (selection.source as Record<string, unknown>).sourceType ===
      "string" &&
    typeof (selection.source as Record<string, unknown>).sourceKey === "string",
  );
}

export function channelMediaPolicy(
  channelsStore: NativeMediaStore | null | undefined,
  voiceStore: NativeMediaStore | null | undefined,
): Record<string, unknown> | null {
  return (
    channelsStore?.getChannelById?.(voiceStore?.currentChannelId)
      ?.mediaPolicy || null
  );
}
import type {
  NativeCaptureRequest,
  NativeMediaFlags,
  NativeMediaStore,
} from "../../shared/types/native-media.ts";
