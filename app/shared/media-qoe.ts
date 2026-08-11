const DEFAULT_MIGRATION_STABILITY_MS = 10_000;
const DEFAULT_LATENCY_IMPROVEMENT_MS = 20;

function isMediaQoeRecord(value: unknown): value is MediaQoeRecord {
  return Boolean(value) && typeof value === "object";
}

function recordsFrom(value: unknown): MediaQoeRecord[] {
  return Array.isArray(value) ? value.filter(isMediaQoeRecord) : [];
}

function finiteOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeTimeMs(value: unknown) {
  const number = finiteOrNull(value);
  if (number == null) return null;
  return Math.abs(number) < 1 ? number * 1000 : number;
}

function normalizePercent(value: unknown) {
  return finiteOrNull(value);
}

export function normalizeMediaPathMetrics(
  metrics: MediaQoeRecord = {},
): MediaQoeRecord {
  const packetLossFraction = metrics.packetLossFraction ?? metrics.fractionLost;
  const normalizedPacketLossFraction = finiteOrNull(packetLossFraction);
  const packetLossPercent =
    packetLossFraction == null
      ? normalizePercent(metrics.packetLossPercent ?? metrics.packetLoss)
      : normalizedPacketLossFraction == null
        ? null
        : normalizedPacketLossFraction * 100;
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

export function createMediaQoeReport({
  provider,
  epoch = 0,
  paths = [],
  sampledAt = Date.now(),
}: MediaQoeRecord = {}) {
  return {
    provider: provider == null ? null : String(provider),
    epoch: Number.isSafeInteger(Number(epoch)) ? Number(epoch) : 0,
    sampledAt: Number.isFinite(Number(sampledAt))
      ? Number(sampledAt)
      : Date.now(),
    paths: recordsFrom(paths).map(normalizeMediaPathMetrics),
  };
}

export function mediaQoePathsFromStats(stats: unknown): MediaQoeRecord[] {
  if (Array.isArray(stats)) return recordsFrom(stats);
  if (!isMediaQoeRecord(stats)) return [];
  if (Array.isArray(stats.paths)) return recordsFrom(stats.paths);
  const transports = recordsFrom(stats.transports);
  if (!transports.length) return [];
  return transports.map((transport) => {
    const candidatePair = isMediaQoeRecord(transport.candidatePair)
      ? transport.candidatePair
      : null;
    const inboundAudio = isMediaQoeRecord(transport.inboundAudio)
      ? transport.inboundAudio
      : null;
    const local = isMediaQoeRecord(candidatePair?.local)
      ? candidatePair.local
      : null;
    return {
      routeId: transport.routeId || transport.id,
      peerOrProvider: transport.peerOrProvider || transport.id || "media",
      rttMs: transport.rttMs ?? candidatePair?.currentRoundTripTime,
      jitterMs: transport.jitterMs ?? inboundAudio?.jitter,
      packetLossPercent:
        transport.packetLossPercent ?? candidatePair?.packetLoss,
      jitterBufferDelayMs:
        transport.jitterBufferDelayMs ??
        inboundAudio?.averageJitterBufferDelayMs,
      availableOutgoingBitrate:
        transport.availableOutgoingBitrate ??
        candidatePair?.availableOutgoingBitrate,
      candidateType: transport.candidateType || local?.candidateType,
      protocol: transport.protocol || local?.protocol,
    };
  });
}

function pathLatencyMs(path: MediaQoeRecord) {
  const rtt = finiteOrNull(path.rttMs);
  if (rtt == null) return Number.POSITIVE_INFINITY;
  const jitter = finiteOrNull(path.jitterMs) || 0;
  const jitterBuffer = finiteOrNull(path.jitterBufferDelayMs) || 0;
  return rtt / 2 + jitter * 2 + jitterBuffer + 20;
}

function maxMetric(paths: MediaQoeRecord[], field: string) {
  const values = paths
    .map((path) => finiteOrNull(path[field]))
    .filter((value) => value != null);
  return values.length ? Math.max(...values) : Number.POSITIVE_INFINITY;
}

export function rankRouteCandidates(candidates: MediaQoeRecord[] = []) {
  return candidates
    .map((candidate) => {
      const paths = recordsFrom(candidate.paths).map(normalizeMediaPathMetrics);
      const viable =
        candidate.viable !== false &&
        paths.every((path) => path.viable !== false) &&
        Number(candidate.requiredParticipants || 0) <=
          Number(candidate.readyParticipants ?? Infinity);
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
        const leftValue = leftTuple[index] ?? 0;
        const rightValue = rightTuple[index] ?? 0;
        if (leftValue !== rightValue) return leftValue - rightValue;
      }
      return String(left.id || "").localeCompare(String(right.id || ""));
    });
}

export function shouldMigrateForQoe(
  active: MediaQoeRecord | null | undefined,
  candidate: MediaQoeRecord | null | undefined,
  {
    now = Date.now(),
    minimumImprovementMs = DEFAULT_LATENCY_IMPROVEMENT_MS,
    stabilityMs = DEFAULT_MIGRATION_STABILITY_MS,
    failure = false,
  }: QoeDecisionOptions = {},
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
import type { MediaQoeRecord, QoeDecisionOptions } from "./types/media-qoe.ts";
