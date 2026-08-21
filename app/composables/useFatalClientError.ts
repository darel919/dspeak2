import {
  FATAL_CLIENT_ERROR_MESSAGE,
  classifyFatalClientError,
  type FatalClientErrorDescriptor,
} from "~/shared/fatal-client-error.ts";
import type { ExternalField } from "~~/shared/types/external.ts";

export function useFatalClientError() {
  const fatal = useState<FatalClientErrorDescriptor | null>(
    "fatal-client-error",
    () => null,
  );
  const recoveryPending = useState(
    "fatal-client-error-recovery-pending",
    () => false,
  );
  const recoveryError = useState<string | null>(
    "fatal-client-error-recovery-error",
    () => null,
  );

  function report(error: ExternalField) {
    const descriptor = classifyFatalClientError(error);
    if (!descriptor) return false;
    return reportDescriptor(descriptor);
  }

  function reportDescriptor(descriptor: FatalClientErrorDescriptor) {
    if (fatal.value) {
      const shouldReplaceWithNativeFatal =
        descriptor.kind === "native-media-worker" &&
        fatal.value.kind !== "native-media-worker";
      if (!shouldReplaceWithNativeFatal) return false;
      recoveryPending.value = false;
      recoveryError.value = null;
    }
    fatal.value = descriptor;
    console.error(
      "[FatalClientError] The application cannot recover:",
      descriptor,
    );
    return true;
  }

  function refresh() {
    if (import.meta.client) window.location.reload();
  }

  async function recover() {
    const descriptor = fatal.value;
    if (!descriptor || recoveryPending.value) return;
    recoveryPending.value = true;
    recoveryError.value = null;
    try {
      if (descriptor.recoveryAction === "restart-app") {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("desktop_restart_app");
        return;
      }
      refresh();
    } catch (error) {
      recoveryPending.value = false;
      recoveryError.value =
        "Automatic restart failed. Close dSpeak and open it again.";
      console.error("[FatalClientError] Recovery action failed:", error);
    }
  }

  return {
    active: computed(() => fatal.value !== null),
    descriptor: readonly(fatal),
    message: computed(() => fatal.value?.message || FATAL_CLIENT_ERROR_MESSAGE),
    recoveryPending: readonly(recoveryPending),
    recoveryError: readonly(recoveryError),
    report,
    reportDescriptor,
    recover,
    refresh,
  };
}
