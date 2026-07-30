import { useMediaEngine } from "./media/useMediaEngine.js";
import { useHybridMediaSession } from "./useHybridMediaSession.js";

/**
 * Creates the application-facing media session.
 *
 * The browser hybrid session is created lazily, after the runtime has selected
 * the browser engine. Tauri receives the native-only boundary instead.
 *
 * @returns {import("./media/browserMediaEngine.js").BrowserMediaEngine}
 *   or a native compatibility engine in the Tauri runtime.
 */
export function useMediasoupSfu(options = {}) {
  return useMediaEngine(useHybridMediaSession, options);
}

export { isTauriRuntime } from "./media/useMediaEngine.js";

export default useMediasoupSfu;
