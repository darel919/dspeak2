export const DEFAULT_MICROPHONE_GATE = Object.freeze({
  enabled: false,
  automatic: true,
  thresholdDb: -48,
});

export function normalizeMicrophoneGate(value = DEFAULT_MICROPHONE_GATE) {
  const threshold = Number(value?.thresholdDb);
  return {
    enabled: value?.enabled ?? DEFAULT_MICROPHONE_GATE.enabled,
    automatic: Boolean(value?.automatic ?? true),
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

export function byteTimeDomainLevelDb(samples) {
  let sum = 0;
  for (const sample of samples) {
    const normalized = (sample - 128) / 128;
    sum += normalized * normalized;
  }
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  return rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100;
}

export function automaticGateThreshold(noiseFloorDb) {
  return Math.min(-28, Math.max(-52, noiseFloorDb + 20));
}

export function createNoiseFloorEstimator() {
  return {
    samples: [],
    openGateSamples: [],
    noiseFloorDb: -60,
  };
}

export function updateNoiseFloor(estimator, levelDb, gateOpen) {
  if (gateOpen) {
    estimator.openGateSamples.push(levelDb);
    if (estimator.openGateSamples.length > 75) {
      estimator.openGateSamples.shift();
    }

    const openGateRange =
      Math.max(...estimator.openGateSamples) -
      Math.min(...estimator.openGateSamples);
    if (estimator.openGateSamples.length < 75 || openGateRange > 2) {
      return estimator.noiseFloorDb;
    }
  } else {
    estimator.openGateSamples.length = 0;
  }

  estimator.samples.push(levelDb);
  if (estimator.samples.length > 125) estimator.samples.shift();

  const sortedSamples = [...estimator.samples].sort(
    (left, right) => left - right,
  );
  const percentileIndex = Math.floor((sortedSamples.length - 1) * 0.2);
  const candidateDb = sortedSamples[percentileIndex];
  const adjustment = candidateDb > estimator.noiseFloorDb ? 0.08 : 0.2;
  estimator.noiseFloorDb += (candidateDb - estimator.noiseFloorDb) * adjustment;

  return estimator.noiseFloorDb;
}
