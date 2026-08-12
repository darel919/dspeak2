import type { Ref } from "vue";
import type { AttenuationReportInput } from "../media-attenuation-reporter.ts";

export interface RegistryEntry extends Record<string, unknown> {
  key: string;
  provider: string;
  source: string;
  userId?: string | number | null;
  peerId?: string | number | null;
}

export interface RemoteMediaEntry extends RegistryEntry {
  userId?: string | number | null;
  peerId?: string | number | null;
  ownerSource?: string | null;
  kind?: "audio" | "video";
  native?: boolean;
  track?: MediaStreamTrack | null;
  stream?: MediaStream | null;
  receiving?: boolean;
}

export interface AudioGraphTrack {
  active: boolean;
  audio: HTMLAudioElement;
  entry: RemoteMediaEntry;
  gain: GainNode;
  gainTarget?: number;
  handleUnmute: () => void;
  source: MediaElementAudioSourceNode;
}

export interface AudioGraph {
  context: AudioContext;
  tracks: Map<string, AudioGraphTrack>;
  userId: string;
  resumeAttempt: number;
  resumePromise: Promise<boolean> | null;
  resumeTimer: ReturnType<typeof setTimeout> | null;
  closed: boolean;
  resumeGeneration: number;
}

export interface VoiceDetector {
  analyser: AnalyserNode;
  key: string;
  source: MediaStreamAudioSourceNode;
  samples: Uint8Array;
  speaking: boolean;
  activeSamples: number;
  quietSamples: number;
  userId: string | number | null | undefined;
  analysisFailed?: boolean;
}

export interface RegistryAttenuation {
  enabled?: boolean;
  reductionPercent?: number;
  attackMs?: number;
  releaseMs?: number;
  sensitivity?: string;
}

export interface HybridMediaRegistryOptions {
  audioFeeds: Ref<Map<string, RemoteMediaEntry>>;
  videoFeeds: Ref<Map<string, RemoteMediaEntry>>;
  getVolume: (userId: string, source: string) => number;
  getOutputDevice: () => string | null;
  isDeafened: () => boolean;
  isBroadcastMode: () => boolean;
  isAnyoneSpeaking: () => boolean;
  onSpeaking: (userId: string, speaking: boolean) => void;
  getAttenuation: (entry: RegistryEntry) => RegistryAttenuation | null;
  onVideoReceivingChange: (entry: RemoteMediaEntry, receiving: boolean) => void;
  onPlaybackState: (state: {
    userId: string | null;
    state: string;
    error: { name: string; message: string } | null;
  }) => void;
  onEffectiveGain: (state: AttenuationReportInput) => void;
}
