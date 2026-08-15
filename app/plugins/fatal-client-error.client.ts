import {
  classifyFatalClientError,
  isNativeMediaWorkerFatalError,
  nativeMediaWorkerFatalDescriptor,
} from "~/shared/fatal-client-error.ts";

type NativeFatalListenerState = {
  handled: boolean;
  owners: number;
  unlisten: (() => void) | null;
  installation: Promise<void> | null;
  handle: ((payload: unknown) => void) | null;
};

type NativeFatalListenerWindow = Window & {
  __DSPEAK_NATIVE_FATAL_LISTENER__?: NativeFatalListenerState;
};

function nativeFatalListenerState() {
  const target = window as NativeFatalListenerWindow;
  return (target.__DSPEAK_NATIVE_FATAL_LISTENER__ ??= {
    handled: false,
    owners: 0,
    unlisten: null,
    installation: null,
    handle: null,
  });
}

export default defineNuxtPlugin((nuxtApp) => {
  const { reportDescriptor } = useFatalClientError();
  let disposed = false;
  const listenerState = nativeFatalListenerState();
  listenerState.owners += 1;

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
    if (!isTauri || listenerState.owners === 0) return;
    if (listenerState.installation) return listenerState.installation;
    if (listenerState.unlisten) return;
    listenerState.installation = (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const unlisten = await listen(
          "media:error",
          ({ payload }: { payload: unknown }) => {
            listenerState.handle?.(payload);
          },
        );
        if (listenerState.owners === 0) {
          unlisten();
          return;
        }
        listenerState.unlisten = unlisten;
      } catch (error) {
        console.warn(
          "[FatalClientError] Native media event listener unavailable:",
          error,
        );
      }
    })().finally(() => {
      listenerState.installation = null;
    });
    return listenerState.installation;
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
    if (disposed) return;
    disposed = true;
    window.removeEventListener("error", handleError);
    window.removeEventListener("unhandledrejection", handleError);
    listenerState.owners = Math.max(0, listenerState.owners - 1);
    if (listenerState.owners === 0) {
      listenerState.unlisten?.();
      listenerState.unlisten = null;
      listenerState.installation = null;
      listenerState.handle = null;
      listenerState.handled = false;
    }
  }

  listenerState.handle = (payload) => {
    if (!isNativeMediaWorkerFatalError(payload)) return;
    if (listenerState.handled) return;
    listenerState.handled = true;
    console.error("[FatalClientError] Native media event:", payload);
    const details =
      payload && typeof payload === "object"
        ? (payload as Record<string, unknown>)
        : {};
    const diagnostics =
      details.diagnostics && typeof details.diagnostics === "object"
        ? (details.diagnostics as Record<string, unknown>)
        : {};
    if (diagnostics.nativeCrash) {
      console.error(
        "[FatalClientError] Native crash evidence:",
        diagnostics.nativeCrash,
      );
    }
    reportDescriptor(nativeMediaWorkerFatalDescriptor(details));
    void invalidateVoiceMediaState();
  };
  window.addEventListener("error", handleError);
  window.addEventListener("unhandledrejection", handleError);
  void installNativeWorkerListener();
  nuxtApp.vueApp.onUnmount(dispose);
});
