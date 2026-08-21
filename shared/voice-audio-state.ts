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

function finiteNumber(value: ExternalField, fallback: number) {
  const number = parseExternalNumber(value);
  return number !== null ? number : fallback;
}

export function normalizeSharedAudioStats(stats: ExternalField) {
  const values = parseExternalRecord(stats) ?? {};
  return {
    kbps: finiteNumber(values.kbps, DEFAULT_SHARED_AUDIO_STATS.kbps),
    level: finiteNumber(values.level, DEFAULT_SHARED_AUDIO_STATS.level),
    dbfs: finiteNumber(values.dbfs, DEFAULT_SHARED_AUDIO_STATS.dbfs),
  };
}

export function normalizeSharedAudioAttenuation(attenuation: ExternalField) {
  const values = parseExternalRecord(attenuation) ?? {};
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

export function normalizeSharedAudioDucking(ducking: ExternalField) {
  const values = parseExternalRecord(ducking) ?? {};
  return {
    active: values.active === true,
    effectivePercent: finiteNumber(
      values.effectivePercent,
      DEFAULT_SHARED_AUDIO_DUCKING.effectivePercent,
    ),
  };
}
import {
  parseExternalNumber,
  parseExternalRecord,
  type ExternalField,
} from "./types/external.ts";
