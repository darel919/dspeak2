import { createMediaEngine } from "./media/createMediaEngine.js";

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
  return createMediaEngine(options);
}

export { isTauriRuntime } from "./media/media-runtime.js";

export default useMediasoupSfu;
