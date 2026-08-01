import { isFatalClientError } from "~/shared/fatal-client-error.js";

export default defineNuxtPlugin(() => {
  const { report } = useFatalClientError();

  function handleError(event) {
    const error = event.error || event.reason || event.message;
    if (!isFatalClientError(error)) return;
    report(error);
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

  window.addEventListener("error", handleError);
  window.addEventListener("unhandledrejection", handleError);
});
