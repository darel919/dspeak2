import {
  classifyFatalClientError,
  isNativeMediaWorkerFatalError,
  nativeMediaWorkerFatalDescriptor,
} from "~/shared/fatal-client-error.ts";

export default defineNuxtPlugin((nuxtApp) => {
  const { reportDescriptor } = useFatalClientError();
  let disposed = false;
  let nativeUnlisten: (() => void) | null = null;

  function handleError(event: ErrorEvent | PromiseRejectionEvent) {
    const error =
      event instanceof ErrorEvent ? event.error || event.message : event.reason;
    const descriptor = classifyFatalClientError(error);
    if (!descriptor) return;
    reportDescriptor(descriptor);
    if (window.__TAURI__ || window.__TAURI_INTERNALS__) {
      const message = error instanceof Error ? error.message : String(error);
      import("@tauri-apps/api/core")
        .then(({ invoke }) =>
          invoke("show_notification", {
            title: "dSpeak encountered a fatal error",
            body: message,
          }),
        )
        .catch(() => {});
    }
  }

  async function installNativeWorkerListener() {
    const markedAsTauri =
      Boolean(window.__TAURI__) || Boolean(window.__TAURI_INTERNALS__);
    let isTauri = markedAsTauri;
    if (!isTauri) {
      try {
        const { isTauri: detectTauri } = await import("@tauri-apps/api/core");
        isTauri = typeof detectTauri === "function" && detectTauri();
      } catch {}
    }
    if (!isTauri || disposed) return;
    try {
      const { listen } = await import("@tauri-apps/api/event");
      const unlisten = await listen(
        "media:error",
        ({ payload }: { payload: unknown }) => {
          console.error("[FatalClientError] Native media event:", payload);
          if (!isNativeMediaWorkerFatalError(payload)) return;
          reportDescriptor(
            nativeMediaWorkerFatalDescriptor(
              payload && typeof payload === "object"
                ? (payload as Record<string, unknown>)
                : {},
            ),
          );
          void invalidateVoiceMediaState();
        },
      );
      if (disposed) unlisten();
      else nativeUnlisten = unlisten;
    } catch (error) {
      console.warn(
        "[FatalClientError] Native media event listener unavailable:",
        error,
      );
    }
  }

  async function invalidateVoiceMediaState() {
    try {
      const { useVoiceStore } = await import("~/stores/voice");
      useVoiceStore().invalidateAfterFatalMediaError?.();
    } catch (error) {
      console.error(
        "[FatalClientError] Native media state invalidation failed:",
        error,
      );
    }
  }

  function dispose() {
    disposed = true;
    window.removeEventListener("error", handleError);
    window.removeEventListener("unhandledrejection", handleError);
    nativeUnlisten?.();
    nativeUnlisten = null;
  }

  window.addEventListener("error", handleError);
  window.addEventListener("unhandledrejection", handleError);
  void installNativeWorkerListener();
  const registerHook = nuxtApp.hook as unknown as (
    name: string,
    callback: () => void,
  ) => void;
  registerHook("app:beforeUnmount", dispose);
});
