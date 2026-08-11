export function computeJitterBufferConfig({ jitterMs, rttMs, lossPercent }) {
  if (jitterMs == null || !Number.isFinite(jitterMs)) return null;
  if (jitterMs > 30 || (lossPercent != null && lossPercent > 3))
    return { minDelayMs: 80, targetDelayMs: 120 };
  if (jitterMs > 15 || (lossPercent != null && lossPercent > 1))
    return { minDelayMs: 50, targetDelayMs: 80 };
  if (jitterMs > 5 || (rttMs != null && rttMs > 50))
    return { minDelayMs: 30, targetDelayMs: 40 };
  return { minDelayMs: 0, targetDelayMs: 20 };
}

export function computeSfuJitterBufferConfig({ rttMs }) {
  if (rttMs == null || !Number.isFinite(rttMs)) return null;
  if (rttMs > 80) return { minDelayMs: 80, targetDelayMs: 120 };
  if (rttMs > 30) return { minDelayMs: 50, targetDelayMs: 80 };
  if (rttMs > 10) return { minDelayMs: 30, targetDelayMs: 40 };
  return { minDelayMs: 0, targetDelayMs: 20 };
}

export function smoothJitterBufferConfig(current, next) {
  if (!current) return next;
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
