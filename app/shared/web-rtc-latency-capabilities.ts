import {
  isExternalBoolean,
  isExternalNumber,
  isExternalRecord,
  isExternalString,
} from "./types/boundary.ts";
import type {
  BrowserReceiverTuningResult,
  WebRtcEnvironmentCapabilities,
  WebRtcLatencyCapabilitiesV1,
  WebRtcLatencyCapabilityState,
} from "./types/web-rtc-latency.ts";

type JitterTargetReceiver = RTCRtpReceiver & { jitterBufferTarget: number };

type TargetLatencyReceiver = RTCRtpReceiver & { targetLatency: number };

export function supportsJitterBufferTarget(
  receiver: RTCRtpReceiver,
): receiver is JitterTargetReceiver {
  return "jitterBufferTarget" in receiver;
}

export function supportsTargetLatency(
  receiver: RTCRtpReceiver,
): receiver is TargetLatencyReceiver {
  return "targetLatency" in receiver;
}

export function probeWebRtcEnvironment(): WebRtcEnvironmentCapabilities {
  if (!(globalThis.RTCPeerConnection instanceof Function))
    return {
      peerConnection: false,
      receiverJitterBufferTargetProperty: false,
      receiverTargetLatencyProperty: false,
      getStats: false,
    };
  const pc = new RTCPeerConnection();
  try {
    const receiver = pc.getReceivers()[0] || null;
    return {
      peerConnection: true,
      receiverJitterBufferTargetProperty:
        receiver != null && supportsJitterBufferTarget(receiver),
      receiverTargetLatencyProperty:
        receiver != null && supportsTargetLatency(receiver),
      getStats:
        receiver?.getStats instanceof Function &&
        pc.getStats instanceof Function,
    };
  } finally {
    pc.close();
  }
}

const SUPPORTED: WebRtcLatencyCapabilityState = "supported";
const UNSUPPORTED: WebRtcLatencyCapabilityState = "unsupported";

export function buildInitialCapabilityReport(
  environment: WebRtcEnvironmentCapabilities,
): WebRtcLatencyCapabilitiesV1 {
  return {
    version: 1,
    receiverJitterBufferTarget: environment.receiverJitterBufferTargetProperty
      ? SUPPORTED
      : UNSUPPORTED,
    receiverTargetLatency: environment.receiverTargetLatencyProperty
      ? SUPPORTED
      : UNSUPPORTED,
    senderSetParameters: "unknown",
    senderMaxBitrate: "unknown",
    senderMaxFramerate: "unknown",
    senderScaleResolutionDownBy: "unknown",
    senderDegradationPreference: "unknown",
    rtcStats: {
      selectedCandidatePairRtt: "unknown",
      inboundJitter: "unknown",
      jitterBufferDelay: "unknown",
      jitterBufferTargetDelay: "unknown",
      jitterBufferMinimumDelay: "unknown",
      framesDropped: "unknown",
      framesDecoded: "unknown",
      framesRendered: "unknown",
      totalProcessingDelay: "unknown",
      estimatedPlayoutTimestamp: "unknown",
      encoderImplementation: "unknown",
      decoderImplementation: "unknown",
      powerEfficientEncoder: "unknown",
      powerEfficientDecoder: "unknown",
    },
  };
}

export type LiveSenderCapabilityResult = {
  senderSetParameters: WebRtcLatencyCapabilityState;
  senderMaxBitrate: WebRtcLatencyCapabilityState;
  errorName: string | null;
};

const UNVERIFIABLE_SENDER: LiveSenderCapabilityResult = {
  senderSetParameters: UNSUPPORTED,
  senderMaxBitrate: UNSUPPORTED,
  errorName: null,
};

function structuredCloneSafe<T>(value: T): T | null {
  try {
    return structuredClone(value);
  } catch {
    try {
      /* SAFETY: The JSON round trip preserves the plain parameter object returned by getParameters. */
      return JSON.parse(JSON.stringify(value)) as T | null;
    } catch {
      return null;
    }
  }
}

function encodingNumber<T extends object>(parameters: T, key: string) {
  if (!isExternalRecord(parameters)) return null;
  const encodings = parameters.encodings;
  if (!Array.isArray(encodings) || !encodings.length) return null;
  const first = encodings[0];
  if (!isExternalRecord(first)) return null;
  const value = first[key];
  return isExternalNumber(value) ? value : null;
}

export async function verifyLiveSenderCapabilities(
  sender: RTCRtpSender,
): Promise<LiveSenderCapabilityResult> {
  if (!(sender.getParameters instanceof Function)) return UNVERIFIABLE_SENDER;
  if (!(sender.setParameters instanceof Function)) return UNVERIFIABLE_SENDER;
  let before: RTCRtpSendParameters;
  try {
    before = sender.getParameters();
  } catch {
    return UNVERIFIABLE_SENDER;
  }
  if (!isExternalRecord(before) || !before.encodings?.length)
    return UNVERIFIABLE_SENDER;
  const probe = structuredCloneSafe(before);
  if (!probe?.encodings?.length) return UNVERIFIABLE_SENDER;
  const requestedBitrate = 1_500_000;
  const probeEncoding = probe.encodings[0];
  if (!isExternalRecord(probeEncoding)) return UNVERIFIABLE_SENDER;
  probeEncoding.maxBitrate = requestedBitrate;
  let errorName: string | null = null;
  try {
    await sender.setParameters(probe);
  } catch (error) {
    errorName = error instanceof Error ? error.name : "UnknownError";
  }
  let effective: RTCRtpSendParameters | null = null;
  try {
    effective = sender.getParameters();
  } catch {}
  const retained =
    errorName === null &&
    isExternalNumber(encodingNumber(effective ?? {}, "maxBitrate")) &&
    (encodingNumber(effective ?? {}, "maxBitrate") ?? 0) > 0;
  const restore = structuredCloneSafe(before);
  if (restore) {
    try {
      await sender.setParameters(restore);
    } catch {}
  }
  return {
    senderSetParameters: SUPPORTED,
    senderMaxBitrate: retained ? SUPPORTED : UNSUPPORTED,
    errorName,
  };
}

export function receiverTuningCapabilityState(
  result: BrowserReceiverTuningResult,
): WebRtcLatencyCapabilityState {
  if (!result.jitterBufferTargetSupported) return UNSUPPORTED;
  return result.reason === "applied" &&
    (result.observedTargetMs != null || result.assignedTargetMs != null)
    ? SUPPORTED
    : UNSUPPORTED;
}

const INBOUND_STATS_FIELDS = [
  ["jitterBufferDelay", "jitterBufferDelay"],
  ["jitterBufferTargetDelay", "jitterBufferTargetDelay"],
  ["jitterBufferMinimumDelay", "jitterBufferMinimumDelay"],
  ["framesDropped", "framesDropped"],
  ["framesDecoded", "framesDecoded"],
  ["framesRendered", "framesRendered"],
  ["totalProcessingDelay", "totalProcessingDelay"],
  ["estimatedPlayoutTimestamp", "estimatedPlayoutTimestamp"],
  ["encoderImplementation", "encoderImplementation"],
  ["decoderImplementation", "decoderImplementation"],
  ["powerEfficientEncoder", "powerEfficientEncoder"],
  ["powerEfficientDecoder", "powerEfficientDecoder"],
  ["jitter", "inboundJitter"],
] as const;

export type InboundStatsFieldKey = (typeof INBOUND_STATS_FIELDS)[number][1];

export type InboundStatsFieldDiscovery = Record<
  InboundStatsFieldKey,
  WebRtcLatencyCapabilityState
>;

function statFieldValue<T extends object>(stat: T, sourceKey: string) {
  if (!isExternalRecord(stat)) return false;
  const value = stat[sourceKey];
  return (
    isExternalNumber(value) ||
    isExternalString(value) ||
    isExternalBoolean(value)
  );
}

export function discoverInboundStatsFields(
  samples: readonly object[],
): InboundStatsFieldDiscovery {
  const present = new Set<InboundStatsFieldKey>();
  for (const sample of samples)
    for (const [sourceKey, capabilityKey] of INBOUND_STATS_FIELDS)
      if (!present.has(capabilityKey) && statFieldValue(sample, sourceKey))
        present.add(capabilityKey);
  const entries = INBOUND_STATS_FIELDS.map(
    ([, capabilityKey]) =>
      [
        capabilityKey,
        present.has(capabilityKey) ? SUPPORTED : UNSUPPORTED,
      ] as const,
  );
  /* SAFETY: Every entry key originates from the frozen field table above. */
  return Object.fromEntries(entries) as InboundStatsFieldDiscovery;
}
