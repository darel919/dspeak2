import type {
  CallWakeLockApi,
  CallWakeLockTarget,
  WakeLockSentinelLike,
} from "./types/call-wake-lock.ts";

export function createCallWakeLockController({
  wakeLock,
  documentTarget,
}: {
  wakeLock?: CallWakeLockApi | null;
  documentTarget?: CallWakeLockTarget | null;
}) {
  let connected = false;
  let sentinel: WakeLockSentinelLike | null = null;
  let pendingRequest: Promise<WakeLockSentinelLike> | null = null;
  let generation = 0;
  let listening = false;

  const isVisible = () => documentTarget?.visibilityState !== "hidden";

  const handleRelease = (releasedSentinel: WakeLockSentinelLike) => {
    if (sentinel === releasedSentinel) sentinel = null;
  };

  async function acquire() {
    if (
      !connected ||
      sentinel ||
      pendingRequest ||
      !isVisible() ||
      typeof wakeLock?.request !== "function"
    ) {
      return false;
    }

    const requestGeneration = generation;
    let request: Promise<WakeLockSentinelLike>;
    try {
      request = Promise.resolve(wakeLock.request("screen"));
    } catch {
      return false;
    }
    pendingRequest = request;

    try {
      const acquiredSentinel = await request;
      if (!connected || requestGeneration !== generation) {
        await acquiredSentinel.release();
        return false;
      }

      sentinel = acquiredSentinel;
      acquiredSentinel.addEventListener?.(
        "release",
        () => handleRelease(acquiredSentinel),
        { once: true },
      );
      return true;
    } catch {
      return false;
    } finally {
      if (pendingRequest === request) pendingRequest = null;
    }
  }

  function handleVisibilityChange() {
    if (connected && isVisible()) void acquire();
  }

  function startListening() {
    if (listening || !documentTarget?.addEventListener) return;
    documentTarget.addEventListener("visibilitychange", handleVisibilityChange);
    listening = true;
  }

  function stopListening() {
    if (!listening || !documentTarget) return;
    documentTarget.removeEventListener(
      "visibilitychange",
      handleVisibilityChange,
    );
    listening = false;
  }

  async function setConnected(nextConnected: unknown) {
    const next = nextConnected === true;
    if (connected === next) {
      if (next) return acquire();
      return false;
    }

    connected = next;
    generation += 1;

    if (connected) {
      startListening();
      return acquire();
    }

    stopListening();
    const heldSentinel = sentinel;
    sentinel = null;
    if (heldSentinel) {
      try {
        await heldSentinel.release();
      } catch {
        return false;
      }
    }
    return true;
  }

  async function dispose() {
    await setConnected(false);
    stopListening();
  }

  return { setConnected, dispose };
}
