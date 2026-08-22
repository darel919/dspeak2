import type {
  EffectiveLatencyLevel,
  LatencyWarningReason,
  ParticipantLatencyStatus,
  WebMediaLatencyTier,
  WebRtcLatencyProfile,
} from "./types/web-rtc-latency.ts";

export const RTT_WARNING_ENTER_MS = 20;
export const RTT_WARNING_RECOVERY_MS = 16;
export const RTT_WARNING_ENTER_SAMPLES = 3;
export const RTT_WARNING_RECOVERY_SAMPLES = 5;

export type RttWarningTrackerState = {
  highSamples: number;
  recoveredSamples: number;
  active: boolean;
};

export function createRttWarningTrackerState(): RttWarningTrackerState {
  return { highSamples: 0, recoveredSamples: 0, active: false };
}

export function advanceRttWarningTracker(
  state: RttWarningTrackerState,
  rttMs: number | null,
): RttWarningTrackerState {
  if (rttMs == null || !Number.isFinite(rttMs))
    return {
      highSamples: 0,
      recoveredSamples: 0,
      active: state.active,
    };
  if (state.active) {
    const recoveredSamples =
      rttMs <= RTT_WARNING_RECOVERY_MS ? state.recoveredSamples + 1 : 0;
    return {
      highSamples: 0,
      recoveredSamples,
      active: recoveredSamples < RTT_WARNING_RECOVERY_SAMPLES,
    };
  }
  const highSamples = rttMs > RTT_WARNING_ENTER_MS ? state.highSamples + 1 : 0;
  return {
    highSamples,
    recoveredSamples: 0,
    active: highSamples >= RTT_WARNING_ENTER_SAMPLES,
  };
}

export function deriveWebMediaLatencyTier({
  receiverTuningApplied,
  receiverTargetObserved,
  senderPolicyVerified,
  observedTargetDelayLowered,
}: {
  receiverTuningApplied: boolean;
  receiverTargetObserved: number | null;
  senderPolicyVerified: boolean;
  observedTargetDelayLowered: boolean;
}): WebMediaLatencyTier {
  const receiverTuningActive =
    receiverTuningApplied &&
    (receiverTargetObserved != null || observedTargetDelayLowered);
  return receiverTuningActive || senderPolicyVerified
    ? "latency-tuned-webrtc"
    : "standard-webrtc";
}

export function effectiveLatencyLevelFromTier(
  tier: WebMediaLatencyTier,
  active: boolean,
): EffectiveLatencyLevel {
  if (!active) return "inactive";
  return tier === "latency-tuned-webrtc" ? "web-tuned" : "compatibility";
}

export function deriveParticipantLatencyStatus({
  requested,
  tier,
  mediaActive,
  mediaRttMs,
  networkWarning = false,
  warningReasons = [],
}: {
  requested: WebRtcLatencyProfile;
  tier: WebMediaLatencyTier;
  mediaActive: boolean;
  mediaRttMs: number | null;
  networkWarning?: boolean;
  warningReasons?: readonly LatencyWarningReason[];
}): ParticipantLatencyStatus {
  const level = effectiveLatencyLevelFromTier(tier, mediaActive);
  const reasons: LatencyWarningReason[] = [];
  if (networkWarning) reasons.push("rtt");
  for (const reason of warningReasons)
    if (!reasons.includes(reason)) reasons.push(reason);
  return {
    requested,
    audioSend: level,
    audioReceive: level,
    videoSend: level,
    videoReceive: level,
    mediaRttMs,
    networkWarning: reasons.includes("rtt"),
    warningReasons: reasons,
  };
}
