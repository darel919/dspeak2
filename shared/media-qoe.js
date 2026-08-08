const DEFAULT_MIGRATION_STABILITY_MS = 10_000;
const DEFAULT_LATENCY_IMPROVEMENT_MS = 20;

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeTimeMs(value) {
  const number = finiteOrNull(value);
  if (number == null) return null;
  return Math.abs(number) < 1 ? number * 1000 : number;
}

function normalizePercent(value) {
  return finiteOrNull(value);
}

export function normalizeMediaPathMetrics(metrics = {}) {
  const packetLossFraction = metrics.packetLossFraction ?? metrics.fractionLost;
  const packetLossPercent =
    packetLossFraction == null
      ? normalizePercent(metrics.packetLossPercent ?? metrics.packetLoss)
      : finiteOrNull(packetLossFraction) == null
        ? null
        : finiteOrNull(packetLossFraction) * 100;
  return {
    routeId: metrics.routeId == null ? null : String(metrics.routeId),
    peerOrProvider:
      metrics.peerOrProvider == null ? null : String(metrics.peerOrProvider),
    rttMs: normalizeTimeMs(metrics.rttMs ?? metrics.rtt),
    jitterMs: normalizeTimeMs(metrics.jitterMs ?? metrics.jitter),
    packetLossPercent,
    jitterBufferDelayMs: normalizeTimeMs(
      metrics.jitterBufferDelayMs ?? metrics.jitterBufferDelay,
    ),
    availableOutgoingBitrate: finiteOrNull(
      metrics.availableOutgoingBitrate ?? metrics.availableOutgoingBitrateBps,
    ),
    concealedAudioRatio: finiteOrNull(
      metrics.concealedAudioRatio ?? metrics.concealedAudio,
    ),
    candidateType: metrics.candidateType ?? null,
    protocol: metrics.protocol ?? null,
    sampledAt: finiteOrNull(metrics.sampledAt),
  };
}

function pathLatencyMs(path) {
  const rtt = finiteOrNull(path.rttMs);
  if (rtt == null) return Number.POSITIVE_INFINITY;
  const jitter = finiteOrNull(path.jitterMs) || 0;
  const jitterBuffer = finiteOrNull(path.jitterBufferDelayMs) || 0;
  return rtt / 2 + jitter * 2 + jitterBuffer + 20;
}

function maxMetric(paths, field) {
  const values = paths
    .map((path) => finiteOrNull(path[field]))
    .filter((value) => value != null);
  return values.length ? Math.max(...values) : Number.POSITIVE_INFINITY;
}

export function rankRouteCandidates(candidates = []) {
  return candidates
    .map((candidate) => {
      const paths = (candidate.paths || []).map(normalizeMediaPathMetrics);
      const viable =
        candidate.viable !== false &&
        paths.every((path) => path.viable !== false) &&
        (candidate.requiredParticipants || 0) <=
          (candidate.readyParticipants ?? Infinity);
      const worstLatencyMs = paths.length
        ? Math.max(...paths.map(pathLatencyMs))
        : Number.POSITIVE_INFINITY;
      return {
        ...candidate,
        paths,
        viable,
        worstLatencyMs,
        packetLossPercent: maxMetric(paths, "packetLossPercent"),
        jitterMs: maxMetric(paths, "jitterMs"),
        concealedAudioRatio: maxMetric(paths, "concealedAudioRatio"),
        stabilityScore: finiteOrNull(candidate.stabilityScore) || 0,
      };
    })
    .sort((left, right) => {
      const leftTuple = [
        left.viable ? 0 : 1,
        left.worstLatencyMs,
        left.packetLossPercent,
        left.jitterMs,
        left.concealedAudioRatio,
        -left.stabilityScore,
        finiteOrNull(left.infrastructureCost) ?? Number.POSITIVE_INFINITY,
      ];
      const rightTuple = [
        right.viable ? 0 : 1,
        right.worstLatencyMs,
        right.packetLossPercent,
        right.jitterMs,
        right.concealedAudioRatio,
        -right.stabilityScore,
        finiteOrNull(right.infrastructureCost) ?? Number.POSITIVE_INFINITY,
      ];
      for (let index = 0; index < leftTuple.length; index += 1) {
        if (leftTuple[index] !== rightTuple[index])
          return leftTuple[index] - rightTuple[index];
      }
      return String(left.id || "").localeCompare(String(right.id || ""));
    });
}

export function shouldMigrateForQoe(
  active,
  candidate,
  {
    now = Date.now(),
    minimumImprovementMs = DEFAULT_LATENCY_IMPROVEMENT_MS,
    stabilityMs = DEFAULT_MIGRATION_STABILITY_MS,
    failure = false,
  } = {},
) {
  if (!candidate?.viable) return false;
  if (failure || active?.failed) return true;
  if (
    active?.viable === false &&
    !Number.isFinite(Number(active.requiredParticipants))
  )
    return true;
  if (
    active?.viable === false &&
    Number(active.readyParticipants) < Number(active.requiredParticipants)
  )
    return false;
  const stableSince = Number(candidate.stableSince);
  if (!Number.isFinite(stableSince) || now - stableSince < stabilityMs)
    return false;
  const activeLatency = finiteOrNull(active?.worstLatencyMs);
  const candidateLatency = finiteOrNull(candidate.worstLatencyMs);
  if (activeLatency == null || candidateLatency == null)
    return activeLatency == null && candidateLatency != null;
  return activeLatency - candidateLatency >= minimumImprovementMs;
}

export { DEFAULT_LATENCY_IMPROVEMENT_MS, DEFAULT_MIGRATION_STABILITY_MS };
