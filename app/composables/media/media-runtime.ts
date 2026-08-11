import { useRuntimeStore } from "../../stores/runtime.ts";

export function isTauriRuntime() {
  return useRuntimeStore().isTauri;
}

function environmentFlag(name, fallback = false) {
  const value = import.meta.env?.[name];
  if (value === undefined) return fallback;
  return value === "1" || value === "true";
}

export function resolveNativeMediaFlags(overrides = {} as any) {
  const nativeRtc =
    overrides.nativeRtc ?? environmentFlag("VITE_DSPEAK_NATIVE_MEDIA");
  return {
    nativeRtc,
    nativeScreenShare: environmentFlag(
      "VITE_DSPEAK_NATIVE_SCREEN_SHARE",
      nativeRtc,
    ),
    nativeScreenAudio: environmentFlag(
      "VITE_DSPEAK_NATIVE_SCREEN_AUDIO",
      nativeRtc,
    ),
    nativeP2P: environmentFlag("VITE_DSPEAK_NATIVE_P2P", nativeRtc),
    nativeSfu: environmentFlag("VITE_DSPEAK_NATIVE_SFU", nativeRtc),
    nativeMicrophone: environmentFlag(
      "VITE_DSPEAK_NATIVE_MICROPHONE",
      nativeRtc,
    ),
    nativeCamera: environmentFlag("VITE_DSPEAK_NATIVE_CAMERA", nativeRtc),
    nativeAudioReceive: environmentFlag(
      "VITE_DSPEAK_NATIVE_AUDIO_RECEIVE",
      nativeRtc,
    ),
    nativeVideoReceive: environmentFlag(
      "VITE_DSPEAK_NATIVE_VIDEO_RECEIVE",
      nativeRtc,
    ),
    ...overrides,
  };
}
