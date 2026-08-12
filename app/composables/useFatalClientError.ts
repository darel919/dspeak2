import { FATAL_CLIENT_ERROR_MESSAGE } from "~/shared/fatal-client-error.ts";

export function useFatalClientError() {
  const active = useState("fatal-client-error", () => false);

  function report(error: unknown) {
    if (active.value) return;
    active.value = true;
    console.error("[FatalClientError] The application cannot recover:", error);
  }

  function refresh() {
    if (import.meta.client) window.location.reload();
  }

  return {
    active: readonly(active),
    message: FATAL_CLIENT_ERROR_MESSAGE,
    report,
    refresh,
  };
}
