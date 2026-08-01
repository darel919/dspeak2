import { BrowserMediaEngine } from "./browserMediaEngine.js";
import { NativeMediaEngine } from "./nativeMediaEngine.js";
import { useRuntimeStore } from "../../stores/runtime.js";

function isTauriRuntime() {
  return useRuntimeStore().isTauri;
}

function environmentFlag(name, fallback = false) {
  const value = import.meta.env?.[name];
  if (value === undefined) return fallback;
  return value === "1" || value === "true";
}

export function resolveNativeMediaFlags(overrides = {}) {
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

function resolveSfuPath() {
  if (typeof useRuntimeConfig === "function") {
    try {
      const rc = useRuntimeConfig();
      if (rc?.public?.sfuPath) return rc.public.sfuPath;
    } catch {
      // useRuntimeConfig unavailable (test environment)
    }
  }
  return import.meta.env?.VITE_DSPEAK_SFU_PATH || "";
}

export function useMediaEngine(sessionOrFactory, options = {}) {
  const tauriRuntime = options.isTauri ?? isTauriRuntime();
  if (tauriRuntime) {
    const runtimeConfig =
      typeof useRuntimeConfig === "function" ? useRuntimeConfig() : {};
    const publicConfig = runtimeConfig?.public || {};
    const serverUrl =
      publicConfig.baseApiPath ||
      String(publicConfig.authPath || "").replace(/\/auth\/?$/, "");
    return new NativeMediaEngine({
      flags: resolveNativeMediaFlags({ nativeRtc: true, ...options.flags }),
      tauri: options.tauri,
      nativeConfig: {
        signalingPath: resolveSfuPath(),
        serverUrl,
        apiPath: publicConfig.apiPath || "/api",
        ...options.nativeConfig,
      },
      nativeOnly: true,
      voiceStore: options.voiceStore || null,
      settingsStore: options.settingsStore || null,
      channelsStore: options.channelsStore || null,
    });
  }
  const session =
    typeof sessionOrFactory === "function"
      ? sessionOrFactory()
      : sessionOrFactory;
  return new BrowserMediaEngine(session);
}

export { isTauriRuntime };
