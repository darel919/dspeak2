export interface MicrophoneGateSettings {
  enabled?: boolean;
  automatic?: boolean;
  thresholdDb?: number;
}

export interface NoiseFloorEstimator {
  samples: number[];
  openGateSamples: number[];
  noiseFloorDb: number;
}
