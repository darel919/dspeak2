import { BrowserMediaEngine } from "./browserMediaEngine.js";
import { NativeMediaEngine } from "./nativeMediaEngine.js";

function isTauriRuntime() {
  return Boolean(
    import.meta.client && (window.__TAURI_INTERNALS__ || window.__TAURI__),
  );
}

function environmentFlag(name, fallback = false) {
  const value = import.meta.env[name];
  if (value === undefined) return fallback;
  return value === "1" || value === "true";
}

export function resolveNativeMediaFlags(overrides = {}) {
  const nativeRtc = environmentFlag("VITE_DSPEAK_NATIVE_MEDIA");
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
    nativeMicrophone: environmentFlag("VITE_DSPEAK_NATIVE_MICROPHONE"),
    nativeCamera: environmentFlag("VITE_DSPEAK_NATIVE_CAMERA", nativeRtc),
    nativeAudioReceive: environmentFlag("VITE_DSPEAK_NATIVE_AUDIO_RECEIVE"),
    nativeVideoReceive: environmentFlag("VITE_DSPEAK_NATIVE_VIDEO_RECEIVE"),
    ...overrides,
  };
}

export function useMediaEngine(session, options = {}) {
  const browserEngine = new BrowserMediaEngine(session);
  if (!isTauriRuntime()) return browserEngine;
  return new NativeMediaEngine({
    browserEngine,
    flags: resolveNativeMediaFlags(options.flags),
    tauri: options.tauri,
  });
}

export { isTauriRuntime };
