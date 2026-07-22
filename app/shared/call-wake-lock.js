export function createCallWakeLockController({ wakeLock, documentTarget }) {
  let connected = false;
  let sentinel = null;
  let pendingRequest = null;
  let generation = 0;
  let listening = false;

  const isVisible = () => documentTarget?.visibilityState !== "hidden";

  const handleRelease = (releasedSentinel) => {
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
    let request;
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
    if (!listening) return;
    documentTarget.removeEventListener(
      "visibilitychange",
      handleVisibilityChange,
    );
    listening = false;
  }

  async function setConnected(nextConnected) {
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
