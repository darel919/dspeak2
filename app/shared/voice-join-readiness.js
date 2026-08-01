export function hasUsableVoiceRoute({
  activeProvider,
  p2pReady,
  sfuReady,
  signalingConnected,
  topologyMode,
  transportReady,
}) {
  if (!signalingConnected) return false;
  if (transportReady) return true;
  if (activeProvider === "p2p") return p2pReady === true;
  if (activeProvider === "sfu") return sfuReady === true;
  return topologyMode === "idle" && transportReady === true;
}

export async function waitForVoiceTransportReady({
  getError,
  isCurrent,
  isReady,
  now = Date.now,
  pollIntervalMs = 50,
  timeoutMs = 15000,
  wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
}) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    if (!isCurrent()) {
      const error = new Error("Voice connection was cancelled");
      error.code = "VOICE_JOIN_CANCELLED";
      throw error;
    }
    const sessionError = getError();
    if (sessionError)
      throw new Error(sessionError?.message || String(sessionError));
    if (isReady()) return;
    await wait(pollIntervalMs);
  }
  throw new Error("Call Failed: Media transport timed out");
}
