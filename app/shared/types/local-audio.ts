import type { ExternalValue, MediaCommandResult } from "./boundary.ts";

import type { Ref } from "vue";
import type { NoiseFloorEstimator } from "./microphone-gate.ts";

export interface LocalAudioProvider {
  setSourceTransmission?: (
    source: string,
    enabled: boolean,
  ) => MediaCommandResult;
  reconfigureSource?: (source: string) => MediaCommandResult;
  updateAudioBitrate?: (
    source: string,
    bitrate: number | null,
  ) => MediaCommandResult;
  updateVideoBitrate?: (
    source: string,
    bitrate: number | null | undefined,
  ) => MediaCommandResult;
  getOutboundTrackStats?: (source: string) => Promise<MediaCommandResult>;
  producers?: Map<
    string,
    { producer: { getStats: () => Promise<MediaCommandResult> } }
  >;
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
  capture: { stop: (source: string) => MediaCommandResult };
  collectOutboundAudioStats: (
    report: ExternalValue,
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
  getP2pMesh: () => MediaCommandResult;
  getRequestedVideoSettings: (source: string) => { maxBitrate?: number | null };
  getSfu: () => MediaCommandResult;
  localSources: Map<string, LocalSourceEntry>;
  microphoneLevelDb: (samples: Float32Array) => number;
  onSpeakingChange?: (userId: string, speaking: boolean) => MediaCommandResult;
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
  ) => MediaCommandResult;
  voiceStore: {
    connectedUsers: Map<string, { id?: string; speaking?: boolean }>;
    updateUserSpeaking: (
      userId: string,
      speaking: boolean,
    ) => MediaCommandResult;
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
