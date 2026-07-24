const maximumSignalBytes = 96_000;
const signalBurstCapacity = 80;
const signalRefillPerSecond = 20;

function signalingDepth(value, depth = 0) {
  if (depth > 12) return depth;
  if (!value || typeof value !== "object") return depth;
  let maximum = depth;
  for (const child of Object.values(value))
    maximum = Math.max(maximum, signalingDepth(child, depth + 1));
  return maximum;
}

function maximumMessageBytes(type) {
  if (type === "p2p-signal") return maximumSignalBytes;
  if (
    [
      "client-rtp-capabilities",
      "connect-transport",
      "produce",
      "consume",
    ].includes(type)
  )
    return 48_000;
  return 8_000;
}

export function createSignalingBudget(now = Date.now()) {
  return {
    protocolViolations: 0,
    signalTokens: signalBurstCapacity,
    signalRefillAt: now,
  };
}

export function consumeSignalingToken(session, now = Date.now()) {
  const elapsed = Math.max(0, now - session.signalRefillAt) / 1000;
  session.signalTokens = Math.min(
    signalBurstCapacity,
    session.signalTokens + elapsed * signalRefillPerSecond,
  );
  session.signalRefillAt = now;
  if (session.signalTokens < 1) return false;
  session.signalTokens -= 1;
  return true;
}

export function parseSignalingMessage(payload) {
  if (typeof payload !== "string" || payload.length > maximumSignalBytes)
    throw new Error("Invalid signaling payload");
  const message = JSON.parse(payload);
  if (
    !message ||
    typeof message !== "object" ||
    Array.isArray(message) ||
    typeof message.type !== "string" ||
    message.type.length > 64 ||
    signalingDepth(message) > 12
  )
    throw new Error("Invalid signaling message");
  if (payload.length > maximumMessageBytes(message.type))
    throw new Error("Signaling message exceeds its type budget");
  return message;
}

export const mediaSignalingLimits = Object.freeze({
  maximumQueuedSignals: 32,
  maximumSignalBytes,
  signalBurstCapacity,
  signalRefillPerSecond,
});
