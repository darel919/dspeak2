import { mediaDebug } from "./media-debug.ts";

export function createProviderRecoveryState({
  error,
  transportReady,
  mediaConnectionState,
  setConnectionPhase,
}: {
  error: { value: string | null };
  transportReady: { value: boolean };
  mediaConnectionState: { value: string };
  setConnectionPhase: (
    phase: string,
    details?: Record<string, unknown>,
  ) => unknown;
}) {
  let retryAt = 0;
  return {
    receive(data: Record<string, unknown> = {}) {
      const nextRetryAt = Number(data.retryAt);
      if (Number.isFinite(nextRetryAt) && nextRetryAt > Date.now())
        retryAt = Math.max(retryAt, nextRetryAt);
      error.value = null;
      transportReady.value = false;
      mediaConnectionState.value = "recovering";
      mediaDebug("provider.recovery-announced", {
        retryAt: retryAt || null,
        retryAfterMs: data.retryAfterMs,
        reason: data.reason,
      });
      setConnectionPhase("reconnecting", {
        reason: data.reason || "provider-recovering",
        retryAt: retryAt || null,
      });
    },
    reset() {
      retryAt = 0;
    },
    timeout() {
      const recoveryRemaining = retryAt
        ? Math.max(0, retryAt - Date.now()) + 10_000
        : 0;
      return Math.max(15_000, recoveryRemaining);
    },
  };
}
