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

function finiteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

export function normalizeSharedAudioStats(stats) {
  return {
    kbps: finiteNumber(stats?.kbps, DEFAULT_SHARED_AUDIO_STATS.kbps),
    level: finiteNumber(stats?.level, DEFAULT_SHARED_AUDIO_STATS.level),
    dbfs: finiteNumber(stats?.dbfs, DEFAULT_SHARED_AUDIO_STATS.dbfs),
  };
}

export function normalizeSharedAudioAttenuation(attenuation) {
  return {
    active: attenuation?.active === true,
    effectivePercent: finiteNumber(
      attenuation?.effectivePercent,
      DEFAULT_SHARED_AUDIO_ATTENUATION.effectivePercent,
    ),
    expectedListeners: finiteNumber(
      attenuation?.expectedListeners,
      DEFAULT_SHARED_AUDIO_ATTENUATION.expectedListeners,
    ),
    reportingListeners: finiteNumber(
      attenuation?.reportingListeners,
      DEFAULT_SHARED_AUDIO_ATTENUATION.reportingListeners,
    ),
  };
}

export function normalizeSharedAudioDucking(ducking) {
  return {
    active: ducking?.active === true,
    effectivePercent: finiteNumber(
      ducking?.effectivePercent,
      DEFAULT_SHARED_AUDIO_DUCKING.effectivePercent,
    ),
  };
}
