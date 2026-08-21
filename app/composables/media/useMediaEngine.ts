import { BrowserMediaEngine } from "./browserMediaEngine.ts";
import { NativeMediaEngine } from "./nativeMediaEngine.ts";
import { isTauriRuntime, resolveNativeMediaFlags } from "./media-runtime.ts";
import {
  isExternalFunction,
  isExternalRecord,
  isExternalString,
} from "../../shared/types/boundary.ts";
import type { RuntimeConfig } from "../../shared/types/runtime-config.ts";
import type {
  BrowserMediaEngineSession,
  MediaEngineFactoryOptions,
} from "../../shared/types/media-engine-adapters.ts";

function readRuntimeConfig(): RuntimeConfig {
  const factory = Object.getOwnPropertyDescriptor(
    globalThis,
    "useRuntimeConfig",
  )?.value;
  if (!isExternalFunction(factory)) return {};
  const value = factory();
  if (!isExternalRecord(value)) return {};
  const publicValue = isExternalRecord(value.public) ? value.public : {};
  const publicConfig: NonNullable<RuntimeConfig["public"]> = {};
  if (isExternalString(publicValue.apiPath))
    publicConfig.apiPath = publicValue.apiPath;
  if (isExternalString(publicValue.baseApiPath))
    publicConfig.baseApiPath = publicValue.baseApiPath;
  return { public: publicConfig };
}

export function useMediaEngine(
  sessionOrFactory:
    BrowserMediaEngineSession | (() => BrowserMediaEngineSession),
  options: MediaEngineFactoryOptions = {},
) {
  const tauriRuntime = options.isTauri ?? isTauriRuntime();
  if (tauriRuntime) {
    const runtimeConfig = readRuntimeConfig();
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
      voiceStore: options.voiceStore,
      settingsStore: options.settingsStore,
      channelsStore: options.channelsStore,
      onQoe: options.onQoe,
    });
  }
  const session =
    sessionOrFactory instanceof Function
      ? sessionOrFactory()
      : sessionOrFactory;
  return new BrowserMediaEngine(session, { onQoe: options.onQoe });
}

export { isTauriRuntime };
export { resolveNativeMediaFlags };
