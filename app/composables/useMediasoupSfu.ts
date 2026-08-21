import { createMediaEngine } from "./media/createMediaEngine.ts";
import type { MediaEngineFactoryOptions } from "../shared/types/media-engine-adapters.ts";

export function useMediasoupSfu(options: MediaEngineFactoryOptions = {}) {
  return createMediaEngine(options);
}

export { isTauriRuntime } from "./media/media-runtime.ts";

export default useMediasoupSfu;
