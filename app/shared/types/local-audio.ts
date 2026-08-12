import type { Ref } from "vue";
import type { NoiseFloorEstimator } from "./microphone-gate.ts";

export interface LocalAudioProvider {
  setSourceTransmission?: (source: string, enabled: boolean) => unknown;
  reconfigureSource?: (source: string) => unknown;
  updateAudioBitrate?: (source: string, bitrate: number | null) => unknown;
  updateVideoBitrate?: (
    source: string,
    bitrate: number | null | undefined,
  ) => unknown;
  getOutboundTrackStats?: (source: string) => Promise<unknown>;
  producers?: Map<string, { producer: { getStats: () => Promise<unknown> } }>;
}

export interface LocalSourceEntry {
  source: string;
  track: MediaStreamTrack;
}

export interface AudioStatsSample {
  timestamp: number;
  bytes: number | null;
}

export interface LocalAudioContext {
  authStore: { getUserData: () => { id?: string | number } | null };
  automaticGateThreshold: (noiseFloorDb: number) => number;
  capture: { stop: (source: string) => unknown };
  collectOutboundAudioStats: (
    report: unknown,
    previous: AudioStatsSample | null,
  ) => {
    sample?: AudioStatsSample | null;
    stats?: {
      bitrateKbps?: number | null;
      audioLevel?: number | null;
    } | null;
  };
  createNoiseFloorEstimator: () => NoiseFloorEstimator;
  echoDetected: Ref<boolean>;
  getActiveProvider: () => string | null;
  getAudioStereo: (source: string) => boolean;
  getAttenuation?: () => { sensitivity?: string } | null;
  getEffectiveAudioBitrate: (source: string) => number | null;
  getP2pMesh: () => unknown;
  getRequestedVideoSettings: (source: string) => { maxBitrate?: number | null };
  getSfu: () => unknown;
  localSources: Map<string, LocalSourceEntry>;
  microphoneLevelDb: (samples: Float32Array) => number;
  onSpeakingChange?: (userId: string, speaking: boolean) => unknown;
  settingsStore: {
    microphoneGate: { automatic: boolean; thresholdDb: number };
    audio?: { echoCancellation?: boolean };
    systemAudioBitrate: number;
    sharedAudioVolume: number;
  };
  sharedAudioDucking?: Ref<{
    active: boolean;
    effectivePercent: number;
  }>;
  sharedAudioStats: Ref<{
    kbps: number;
    level: number;
    dbfs: number;
  }>;
  updateNoiseFloor: (
    estimator: NoiseFloorEstimator,
    levelDb: number,
    active: boolean,
  ) => unknown;
  voiceStore: {
    connectedUsers: Map<string, { id?: string; speaking?: boolean }>;
    updateUserSpeaking: (userId: string, speaking: boolean) => unknown;
  };
}

export interface LocalVoiceDetector {
  analyser: AnalyserNode;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  timer: ReturnType<typeof setInterval>;
  userId: string;
}

export interface SharedAudioMeter {
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  gainTarget: number;
  analyser: AnalyserNode;
  destination: MediaStreamAudioDestinationNode;
  timer: ReturnType<typeof setInterval> | null;
  track: MediaStreamTrack;
}
