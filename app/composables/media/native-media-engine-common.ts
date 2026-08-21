import {
  isDesktopCaptureSelection,
  type DesktopCaptureSelection,
} from "../../shared/desktop-capture.ts";
import {
  isExternalRecord,
  isExternalString,
} from "../../shared/types/boundary.ts";
import type {
  NativeCaptureRequest,
  NativeMediaFlags,
  NativeMediaStore,
} from "../../shared/types/native-media.ts";

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
  "media:native-action",
  "media:native-receive-event",
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
  "media:native-action": "native-action",
  "media:native-receive-event": "native-receive-event",
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
): DesktopCaptureSelection | null {
  const selection = request?.captureSelection;
  return isDesktopCaptureSelection(selection) ? selection : null;
}

export function isSourceAwareCaptureRequest(
  request: NativeCaptureRequest | null | undefined,
): boolean {
  const selection = getCaptureSelection(request);
  if (selection) return true;
  const source = request?.source;
  if (!isExternalRecord(source)) return false;
  return (
    "sourceId" in source &&
    isExternalString(source.sourceId) &&
    "sourceType" in source &&
    isExternalString(source.sourceType) &&
    "sourceKey" in source &&
    isExternalString(source.sourceKey)
  );
}

export function channelMediaPolicy(
  channelsStore: NativeMediaStore | null | undefined,
  voiceStore: Pick<NativeMediaStore, "currentChannelId"> | null | undefined,
): Record<string, unknown> | null {
  return (
    channelsStore?.getChannelById?.(voiceStore?.currentChannelId || null)
      ?.mediaPolicy || null
  );
}
