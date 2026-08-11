import type { Ref } from "vue";
import type { AttenuationReportInput } from "../media-attenuation-reporter.ts";

export interface RegistryEntry extends Record<string, unknown> {
  key: string;
  provider: string;
  source: string;
  userId?: string;
  peerId?: string;
}

export interface HybridMediaRegistryOptions {
  audioFeeds: Ref<Map<string, unknown>>;
  videoFeeds: Ref<Map<string, unknown>>;
  getVolume: (userId: string, source: string) => number;
  getOutputDevice: () => string | null;
  isDeafened: () => boolean;
  isBroadcastMode: () => boolean;
  isAnyoneSpeaking: () => boolean;
  onSpeaking: (userId: string, speaking: boolean) => void;
  getAttenuation: (entry: RegistryEntry) => unknown;
  onVideoReceivingChange: (entry: RegistryEntry, receiving: boolean) => void;
  onPlaybackState: (state: { state: string }) => void;
  onEffectiveGain: (state: AttenuationReportInput) => void;
}
