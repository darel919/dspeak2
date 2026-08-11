export function hasUsableVoiceRoute({
  activeProvider,
  p2pReady,
  sfuReady,
  signalingConnected,
  topologyMode,
  transportReady,
}) {
  if (!signalingConnected) return false;
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
  const startedAt = now();
  const resolveTimeoutMs = () => {
    const value =
      typeof timeoutMs === "function"
        ? (timeoutMs as any)()
        : Number(timeoutMs);
    return Number.isFinite(value) && value > 0 ? value : 15000;
  };
  let deadline = startedAt + resolveTimeoutMs();
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
    deadline = Math.max(deadline, startedAt + resolveTimeoutMs());
    await wait(pollIntervalMs);
  }
  throw new Error("Call Failed: Media transport timed out");
}
