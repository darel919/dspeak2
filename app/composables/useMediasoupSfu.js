import { useMediaEngine } from "./media/useMediaEngine.js";
import { useHybridMediaSession } from "./useHybridMediaSession.js";

/**
 * Creates the application-facing media session.
 *
 * The hybrid session remains the browser implementation and is wrapped by the
 * runtime-selected engine so existing consumers can migrate incrementally.
 *
 * @returns {import("./media/browserMediaEngine.js").BrowserMediaEngine}
 *   or a native compatibility engine in the Tauri runtime.
 */
export function useMediasoupSfu() {
  return useMediaEngine(useHybridMediaSession());
}

export default useMediasoupSfu;
