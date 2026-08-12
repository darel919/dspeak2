import type { VideoSettings } from "./video-settings.ts";
import type { MicrophoneGateSettings } from "./microphone-gate.ts";

export interface AudioSettings {
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  [key: string]: boolean;
}

export interface AppearanceSettings {
  surfaceMode: "system" | "light" | "dark";
  accent: string;
}

export interface StreamAttenuationSettings {
  mode: "room" | "enabled" | "disabled";
  reductionPercent: number;
}

export type SystemSoundTheme = "default";
export type SoundboardRoomVolumes = Record<string, unknown>;

export interface SettingsStorePersisted {
  audio: AudioSettings;
  microphoneGate: Required<MicrophoneGateSettings>;
  micDeviceId: string | null;
  outputDeviceId: string | null;
  cameraDeviceId: string | null;
  cameraVideo: VideoSettings;
  screenVideo: VideoSettings;
  broadcastMode: boolean;
  sharedAudioVolume: number;
  systemAudioBitrate: number;
  appearance: AppearanceSettings;
  streamAttenuation: StreamAttenuationSettings;
  soundboardVolume: number;
  soundboardRoomVolumes: SoundboardRoomVolumes;
  systemSoundTheme: SystemSoundTheme;
  systemSoundVolume: number;
  systemSoundsMuted: boolean;
}
