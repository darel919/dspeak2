import type {
  JitterBufferConfig,
  JitterBufferMetrics,
} from "./types/adaptive-media.ts";

export type AudioLatencyObjective = "standard" | "ultra-low";

const STANDARD_HEALTHY: JitterBufferConfig = {
  minDelayMs: 0,
  targetDelayMs: 20,
};
const ULTRA_LOW_HEALTHY: JitterBufferConfig = {
  minDelayMs: 0,
  targetDelayMs: 10,
};
const ULTRA_LOW_ELEVATED: JitterBufferConfig = {
  minDelayMs: 0,
  targetDelayMs: 30,
};
const ULTRA_LOW_DEGRADED: JitterBufferConfig = {
  minDelayMs: 20,
  targetDelayMs: 60,
};
export const ULTRA_LOW_JITTER_ENVELOPE_TARGET_MS = 60;

export function computeJitterBufferConfig(
  { jitterMs, rttMs, lossPercent }: JitterBufferMetrics,
  objective: AudioLatencyObjective = "standard",
): JitterBufferConfig | null {
  if (jitterMs == null || !Number.isFinite(jitterMs)) return null;
  if (objective === "ultra-low") {
    if (jitterMs > 25 || (lossPercent != null && lossPercent > 3))
      return ULTRA_LOW_DEGRADED;
    if (jitterMs > 12 || (lossPercent != null && lossPercent > 1))
      return ULTRA_LOW_ELEVATED;
    return ULTRA_LOW_HEALTHY;
  }
  if (jitterMs > 30 || (lossPercent != null && lossPercent > 3))
    return { minDelayMs: 80, targetDelayMs: 120 };
  if (jitterMs > 15 || (lossPercent != null && lossPercent > 1))
    return { minDelayMs: 50, targetDelayMs: 80 };
  if (jitterMs > 5 || (rttMs != null && rttMs > 50))
    return { minDelayMs: 30, targetDelayMs: 40 };
  return STANDARD_HEALTHY;
}

export function computeSfuJitterBufferConfig(
  { rttMs }: JitterBufferMetrics,
  objective: AudioLatencyObjective = "standard",
) {
  if (rttMs == null || !Number.isFinite(rttMs)) return null;
  if (objective === "ultra-low") {
    if (rttMs > 80) return ULTRA_LOW_DEGRADED;
    if (rttMs > 30) return ULTRA_LOW_ELEVATED;
    if (rttMs > 10) return ULTRA_LOW_HEALTHY;
    return ULTRA_LOW_HEALTHY;
  }
  if (rttMs > 80) return { minDelayMs: 80, targetDelayMs: 120 };
  if (rttMs > 30) return { minDelayMs: 50, targetDelayMs: 80 };
  if (rttMs > 10) return { minDelayMs: 30, targetDelayMs: 40 };
  return STANDARD_HEALTHY;
}

export function smoothJitterBufferConfig(
  current: JitterBufferConfig | null,
  next: JitterBufferConfig,
  objective: AudioLatencyObjective = "standard",
): JitterBufferConfig {
  if (!current) return next;
  if (objective === "ultra-low") {
    const minDelayMs =
      next.minDelayMs < current.minDelayMs
        ? next.minDelayMs
        : Math.min(next.minDelayMs, current.minDelayMs + 10);
    const targetDelayMs =
      next.targetDelayMs < current.targetDelayMs
        ? next.targetDelayMs
        : Math.min(next.targetDelayMs, current.targetDelayMs + 15);
    return { minDelayMs, targetDelayMs };
  }
  const minDelayMs =
    next.minDelayMs === 0
      ? 0
      : next.minDelayMs > current.minDelayMs
        ? Math.min(next.minDelayMs, current.minDelayMs + 20)
        : next.minDelayMs;
  const targetDelayMs =
    next.targetDelayMs === 20
      ? 20
      : next.targetDelayMs > current.targetDelayMs
        ? Math.min(next.targetDelayMs, current.targetDelayMs + 30)
        : next.targetDelayMs;
  return { minDelayMs, targetDelayMs };
}
