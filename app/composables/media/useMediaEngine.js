import { BrowserMediaEngine } from "./browserMediaEngine.js";
import { NativeMediaEngine } from "./nativeMediaEngine.js";
import { isTauriRuntime, resolveNativeMediaFlags } from "./media-runtime.js";

export function useMediaEngine(sessionOrFactory, options = {}) {
  const tauriRuntime = options.isTauri ?? isTauriRuntime();
  if (tauriRuntime) {
    const runtimeConfig =
      typeof useRuntimeConfig === "function" ? useRuntimeConfig() : {};
    const publicConfig = runtimeConfig?.public || {};
    const serverUrl =
      publicConfig.baseApiPath || import.meta.env?.VITE_DSPEAK_API_PATH || "";
    return new NativeMediaEngine({
      flags: resolveNativeMediaFlags({ nativeRtc: true, ...options.flags }),
      tauri: options.tauri,
      nativeConfig: {
        serverUrl,
        apiPath: publicConfig.apiPath || "/api",
        ...options.nativeConfig,
      },
      nativeOnly: true,
      voiceStore: options.voiceStore || null,
      settingsStore: options.settingsStore || null,
      channelsStore: options.channelsStore || null,
      onQoe: options.onQoe,
    });
  }
  const session =
    typeof sessionOrFactory === "function"
      ? sessionOrFactory()
      : sessionOrFactory;
  return new BrowserMediaEngine(session, { onQoe: options.onQoe });
}

export { isTauriRuntime };
export { resolveNativeMediaFlags };
