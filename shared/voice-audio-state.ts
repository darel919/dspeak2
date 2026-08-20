const DEFAULT_SHARED_AUDIO_STATS = Object.freeze({
  kbps: 0,
  level: 0,
  dbfs: -60,
});

const DEFAULT_SHARED_AUDIO_ATTENUATION = Object.freeze({
  active: false,
  effectivePercent: 100,
  expectedListeners: 0,
  reportingListeners: 0,
});

const DEFAULT_SHARED_AUDIO_DUCKING = Object.freeze({
  active: false,
  effectivePercent: 100,
});

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

export function normalizeSharedAudioStats(stats: unknown) {
  const values = record(stats);
  return {
    kbps: finiteNumber(values.kbps, DEFAULT_SHARED_AUDIO_STATS.kbps),
    level: finiteNumber(values.level, DEFAULT_SHARED_AUDIO_STATS.level),
    dbfs: finiteNumber(values.dbfs, DEFAULT_SHARED_AUDIO_STATS.dbfs),
  };
}

export function normalizeSharedAudioAttenuation(attenuation: unknown) {
  const values = record(attenuation);
  return {
    active: values.active === true,
    effectivePercent: finiteNumber(
      values.effectivePercent,
      DEFAULT_SHARED_AUDIO_ATTENUATION.effectivePercent,
    ),
    expectedListeners: finiteNumber(
      values.expectedListeners,
      DEFAULT_SHARED_AUDIO_ATTENUATION.expectedListeners,
    ),
    reportingListeners: finiteNumber(
      values.reportingListeners,
      DEFAULT_SHARED_AUDIO_ATTENUATION.reportingListeners,
    ),
  };
}

export function normalizeSharedAudioDucking(ducking: unknown) {
  const values = record(ducking);
  return {
    active: values.active === true,
    effectivePercent: finiteNumber(
      values.effectivePercent,
      DEFAULT_SHARED_AUDIO_DUCKING.effectivePercent,
    ),
  };
}
