import { isExternalNumber, isExternalRecord } from "./types/boundary.ts";
import type {
  BrowserMediaTuningContext,
  BrowserReceiverTuningResult,
} from "./types/web-rtc-latency.ts";
import { recordWebRtcLatencyEvent } from "./web-rtc-latency-diagnostics.ts";
import { supportsJitterBufferTarget } from "./web-rtc-latency-capabilities.ts";

export type WebJitterPolicy = {
  standardPreferredMs: number | null;
  ultraLowPreferredMs: number | null;
};

export const WEB_JITTER_POLICY: WebJitterPolicy = Object.freeze({
  standardPreferredMs: null,
  ultraLowPreferredMs: 10,
});

export const JITTER_BUFFER_TARGET_MAX_MS = 4000;

const POLICY_KEYS = {
  standard: "standardPreferredMs",
  "ultra-low": "ultraLowPreferredMs",
} as const satisfies Record<BrowserMediaTuningContext["profile"], string>;

export function resolveRequestedJitterTargetMs(
  profile: BrowserMediaTuningContext["profile"],
): number | null {
  const preferred = WEB_JITTER_POLICY[POLICY_KEYS[profile]];
  if (preferred == null) return null;
  return Math.min(JITTER_BUFFER_TARGET_MAX_MS, Math.max(0, preferred));
}

export function applyBrowserReceiverLatencyPolicy(
  receiver: RTCRtpReceiver,
  context: BrowserMediaTuningContext,
): BrowserReceiverTuningResult {
  const jitterBufferTargetSupported = supportsJitterBufferTarget(receiver);
  const targetLatencySupported =
    "targetLatency" in receiver && isExternalNumber(receiver.targetLatency);
  const base = {
    assignedTargetMs: null,
    observedTargetMs: null,
    jitterBufferTargetSupported,
    targetLatencySupported,
  };
  if (context.profile !== "ultra-low")
    return {
      ...base,
      requestedTargetMs: null,
      applied: false,
      reason: "standard-unchanged",
    };
  const requestedTargetMs = resolveRequestedJitterTargetMs(context.profile);
  if (requestedTargetMs == null)
    return {
      ...base,
      requestedTargetMs: null,
      applied: false,
      reason: "missing-target",
    };
  if (!jitterBufferTargetSupported) {
    recordWebRtcLatencyEvent({ kind: "receiver-jitter-target-unsupported" });
    return {
      ...base,
      requestedTargetMs,
      applied: false,
      reason: "unsupported",
    };
  }
  try {
    /* SAFETY: supportsJitterBufferTarget narrowed this receiver to expose jitterBufferTarget. */
    const assignable = receiver as RTCRtpReceiver & {
      jitterBufferTarget: number;
    };
    assignable.jitterBufferTarget = requestedTargetMs;
    const readBack = assignable.jitterBufferTarget;
    const assignedTargetMs = isExternalNumber(readBack) ? readBack : null;
    recordWebRtcLatencyEvent({
      kind: "receiver-jitter-target-applied",
      requestedTargetMs,
      assignedTargetMs,
    });
    return {
      requestedTargetMs,
      assignedTargetMs,
      observedTargetMs: null,
      jitterBufferTargetSupported,
      targetLatencySupported,
      applied: true,
      reason: "applied",
    };
  } catch (error) {
    recordWebRtcLatencyEvent({
      kind: "receiver-jitter-target-rejected",
      errorName: error instanceof Error ? error.name : String(error ?? ""),
    });
    return {
      ...base,
      requestedTargetMs,
      applied: false,
      reason: "rejected",
    };
  }
}

type InboundJitterBufferStats = {
  jitterBufferDelay?: unknown;
  jitterBufferEmittedCount?: unknown;
  jitterBufferTargetDelay?: unknown;
  jitterBufferMinimumDelay?: unknown;
};

export type ObservedJitterBufferMetrics = {
  averageDelayMs: number | null;
  averageTargetDelayMs: number | null;
  averageMinimumDelayMs: number | null;
};

function cumulativeAverageMs<T>(value: T, emittedCount: T) {
  /* SAFETY: Both values originate from getStats records and Number() never throws on them. */
  const total = Number(value);
  const count = Number(emittedCount);
  if (!Number.isFinite(total) || !Number.isFinite(count) || count <= 0)
    return null;
  return (total * 1000) / count;
}

export function observeJitterBufferMetrics<T extends object>(
  inboundStat: T,
): ObservedJitterBufferMetrics {
  if (!isExternalRecord(inboundStat))
    return {
      averageDelayMs: null,
      averageTargetDelayMs: null,
      averageMinimumDelayMs: null,
    };
  const stats =
    /* SAFETY: The cast only relabels the record already validated by isExternalRecord above. */
    inboundStat as InboundJitterBufferStats;
  return {
    averageDelayMs: cumulativeAverageMs(
      stats.jitterBufferDelay,
      stats.jitterBufferEmittedCount,
    ),
    averageTargetDelayMs: cumulativeAverageMs(
      stats.jitterBufferTargetDelay,
      stats.jitterBufferEmittedCount,
    ),
    averageMinimumDelayMs: cumulativeAverageMs(
      stats.jitterBufferMinimumDelay,
      stats.jitterBufferEmittedCount,
    ),
  };
}
