export const DEFAULT_MICROPHONE_GATE = Object.freeze({
  enabled: true,
  automatic: true,
  thresholdDb: -48,
});

export function normalizeMicrophoneGate(value = {}) {
  const threshold = Number(value?.thresholdDb);
  return {
    enabled: value?.enabled !== false,
    automatic: value?.automatic !== false,
    thresholdDb: Number.isFinite(threshold)
      ? Math.min(-20, Math.max(-60, Math.round(threshold)))
      : DEFAULT_MICROPHONE_GATE.thresholdDb,
  };
}

export function microphoneLevelDb(samples) {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  return rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100;
}

export function automaticGateThreshold(noiseFloorDb) {
  return Math.min(-32, Math.max(-58, noiseFloorDb + 12));
}

export function updateNoiseFloor(currentDb, levelDb, gateOpen) {
  if (gateOpen || levelDb > currentDb + 8) return currentDb;
  return currentDb * 0.94 + levelDb * 0.06;
}
