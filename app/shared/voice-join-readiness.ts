import type {
  VoiceJoinReadinessOptions,
  VoiceTransportReadinessOptions,
} from "./types/shared-utilities.ts";
import { isExternalString } from "./types/boundary.ts";

export const VOICE_JOIN_TIMEOUT_MS = 10_000;

export function hasUsableVoiceRoute({
  activeProvider,
  p2pReady,
  sfuReady,
  signalingConnected,
  topologyMode,
  transportReady,
}: VoiceJoinReadinessOptions) {
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
  timeoutMs = VOICE_JOIN_TIMEOUT_MS,
  wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
}: VoiceTransportReadinessOptions) {
  const startedAt = now();
  const resolveTimeoutMs = () => {
    const value =
      timeoutMs instanceof Function ? timeoutMs() : Number(timeoutMs);
    return Number.isFinite(value) && value > 0 ? value : VOICE_JOIN_TIMEOUT_MS;
  };
  let deadline = startedAt + resolveTimeoutMs();
  while (now() < deadline) {
    if (!isCurrent()) {
      const error = new Error("Voice connection was cancelled");
      error.code = "VOICE_JOIN_CANCELLED";
      throw error;
    }
    const sessionError = getError();
    const sessionErrorMessage = isExternalString(sessionError)
      ? sessionError
      : sessionError?.message ||
        sessionError?.code ||
        sessionError?.cause?.code ||
        null;
    if (sessionErrorMessage) throw new Error(sessionErrorMessage);
    if (isReady()) return;
    deadline = Math.max(deadline, startedAt + resolveTimeoutMs());
    await wait(pollIntervalMs);
  }
  throw new Error("Call Failed: Media transport timed out");
}
