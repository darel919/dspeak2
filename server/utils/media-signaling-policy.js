const maximumSignalBytes = 96_000;
const signalBurstCapacity = 80;
const signalRefillPerSecond = 20;
const supportedMessageTypes = new Set([
  "ping",
  "heartbeat",
  "media-sources",
  "participant-voice-state",
  "p2p-signal",
  "p2p-ready",
  "topology-ready",
  "topology-failed",
  "p2p-failed",
  "sfu-failed",
  "client-sfu-rtt",
  "get-rtp-capabilities",
  "client-rtp-capabilities",
  "create-transport",
  "connect-transport",
  "restart-ice",
  "produce",
  "close-producer",
  "close-media",
  "consume",
  "resume-consumer",
  "pause-consumer",
]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIdentifier(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 160;
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function isNonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0;
}

function isTopologyTarget(value) {
  return value === "p2p" || value === "sfu";
}

function validTopologyResult(data) {
  return (
    isRecord(data) &&
    isNonNegativeInteger(data.epoch) &&
    isTopologyTarget(data.target) &&
    isNonNegativeInteger(data.sourceRevision)
  );
}

function validFailure(data) {
  return (
    isRecord(data) &&
    isNonNegativeInteger(data.epoch) &&
    (data.reason === undefined ||
      (typeof data.reason === "string" && data.reason.length <= 500))
  );
}

function validMessageData(type, data) {
  if (["ping", "get-rtp-capabilities", "close-media"].includes(type))
    return data === undefined || isRecord(data);
  if (!isRecord(data)) return false;
  switch (type) {
    case "heartbeat":
      return (
        isNonNegativeInteger(data.sequence) &&
        isNonNegativeInteger(data.topologyEpoch) &&
        isNonNegativeInteger(data.sourceRevision)
      );
    case "media-sources":
      return (
        Array.isArray(data.sources) &&
        data.sources.length <= 4 &&
        data.sources.every((source) => typeof source === "string")
      );
    case "participant-voice-state":
      return (
        typeof data.muted === "boolean" && typeof data.deafened === "boolean"
      );
    case "p2p-signal":
      return (
        isIdentifier(data.targetPeerId) &&
        isNonNegativeInteger(data.epoch) &&
        isRecord(data.signal)
      );
    case "p2p-ready":
      return (
        isNonNegativeInteger(data.epoch) &&
        Array.isArray(data.qualifiedPeerIds) &&
        data.qualifiedPeerIds.length <= 32 &&
        data.qualifiedPeerIds.every(isIdentifier)
      );
    case "topology-ready":
      return validTopologyResult(data);
    case "topology-failed":
      return validTopologyResult(data) && validFailure(data);
    case "p2p-failed":
    case "sfu-failed":
      return validFailure(data);
    case "client-sfu-rtt":
      return isFiniteNumber(data.rttMs);
    case "client-rtp-capabilities":
      return isRecord(data.rtpCapabilities);
    case "create-transport":
      return data.type === "send" || data.type === "recv";
    case "connect-transport":
      return (
        isIdentifier(data.requestId) &&
        isIdentifier(data.transportId) &&
        isRecord(data.dtlsParameters)
      );
    case "restart-ice":
      return isIdentifier(data.requestId) && isIdentifier(data.transportId);
    case "produce":
      return (
        isIdentifier(data.requestId) &&
        isIdentifier(data.transportId) &&
        (data.kind === "audio" || data.kind === "video") &&
        isRecord(data.rtpParameters) &&
        (data.appData === undefined || isRecord(data.appData))
      );
    case "close-producer":
      return isIdentifier(data.producerId);
    case "consume":
      return (
        isIdentifier(data.requestId) &&
        isIdentifier(data.transportId) &&
        isIdentifier(data.producerId) &&
        (data.rtpCapabilities === undefined || isRecord(data.rtpCapabilities))
      );
    case "resume-consumer":
    case "pause-consumer":
      return (
        isIdentifier(data.requestId) &&
        isIdentifier(data.consumerId) &&
        isNonNegativeInteger(data.revision)
      );
    default:
      return false;
  }
}

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
  if (!supportedMessageTypes.has(message.type))
    throw new Error("Unsupported signaling message type");
  if (payload.length > maximumMessageBytes(message.type))
    throw new Error("Signaling message exceeds its type budget");
  if (!validMessageData(message.type, message.data))
    throw new Error("Invalid signaling message data");
  return message;
}

export const mediaSignalingLimits = Object.freeze({
  maximumQueuedSignals: 32,
  maximumSignalBytes,
  signalBurstCapacity,
  signalRefillPerSecond,
});
