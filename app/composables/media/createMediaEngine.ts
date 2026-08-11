import { isTauriRuntime, resolveNativeMediaFlags } from "./media-runtime.ts";

function nativeEngineOptions(options) {
  const runtimeConfig: any =
    typeof useRuntimeConfig === "function" ? useRuntimeConfig() : {};
  const publicConfig = runtimeConfig?.public || {};
  const serverUrl =
    publicConfig.baseApiPath || import.meta.env?.VITE_DSPEAK_API_PATH || "";
  return {
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
  };
}

export async function createMediaEngine(options = {} as any) {
  const tauriRuntime = options.isTauri ?? isTauriRuntime();
  if (tauriRuntime) {
    const { NativeMediaEngine } = await import("./nativeMediaEngine.ts");
    return new NativeMediaEngine(nativeEngineOptions(options));
  }

  const [{ BrowserMediaEngine }, { useHybridMediaSession }] = await Promise.all(
    [import("./browserMediaEngine.ts"), import("../useHybridMediaSession.ts")],
  );
  return new BrowserMediaEngine(useHybridMediaSession(), {
    onQoe: options.onQoe,
  });
}
