import { createMediaEngine } from "./media/createMediaEngine.ts";

/**
 * Creates the application-facing media session.
 *
 * The browser hybrid session is created lazily, after the runtime has selected
 * the browser engine. Tauri receives the native-only boundary instead.
 *
 * @returns {import("./media/browserMediaEngine.ts").BrowserMediaEngine}
 *   or a native compatibility engine in the Tauri runtime.
 */
export function useMediasoupSfu(options = {} as any) {
  return createMediaEngine(options);
}

export { isTauriRuntime } from "./media/media-runtime.ts";

export default useMediasoupSfu;
