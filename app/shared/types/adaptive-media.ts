export interface JitterBufferMetrics {
  jitterMs?: number | null;
  rttMs: number | null;
  lossPercent?: number | null;
}
export interface JitterBufferConfig {
  minDelayMs: number;
  targetDelayMs: number;
}
export interface AdaptiveVideoState {
  scale: number;
  frameRate: number;
  pressureSamples?: number;
  healthySamples?: number;
  changed?: boolean;
}
export interface AdaptiveVideoSample {
  encodeUtilization?: number | null;
  framesPerSecond?: number | null;
  qualityLimitationReason?: string;
}
export interface AdaptiveVideoSettings {
  qualityPriority: string;
  frameRate?: number;
  resolution: string;
}
export interface AdaptiveVideoReport {
  type?: string;
  isRemote?: boolean;
  kind?: string;
  mediaType?: string;
  totalEncodeTime?: number | null;
  framesEncoded?: number | null;
  framesPerSecond?: number | null;
  qualityLimitationReason?: string;
}
export interface AdaptiveVideoEntry extends Record<string, unknown> {
  source: string;
  track: MediaStreamTrack;
  ceilingWidth?: number | null;
  ceilingHeight?: number | null;
}
export interface AdaptiveFrameCounters {
  totalEncodeTime: number;
  framesEncoded: number;
}
export interface AdaptiveTrackConstraints {
  frameRate: { ideal: number; max: number };
  width?: { ideal: number; max: number };
  height?: { ideal: number; max: number };
}
