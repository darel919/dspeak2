import type { DesktopCaptureSelection } from "../desktop-capture.ts";
import type { ExternalObject } from "./boundary.ts";
import type { VideoSettingsInput } from "../types/video-settings.ts";
import type { TopologySourceEntry } from "./topology-controller.ts";
import type { MicrophoneProcessingSettings } from "../../../shared/audio-codec-policy.ts";

export interface MediaCaptureSettings {
  audio?: MediaTrackConstraints;
  micDeviceId?: string | null;
  cameraDeviceId?: string | null;
  cameraVideo?: VideoSettingsInput;
  screenVideo?: VideoSettingsInput;
  processing?: MicrophoneProcessingSettings | null;
}

export interface MediaCapturePublication {
  track?: MediaStreamTrack;
  [key: string]: unknown;
}

export interface MediaCaptureEntry {
  source: string;
  stream: MediaStream;
  track: MediaStreamTrack;
  publication: Promise<TopologySourceEntry | null>;
  ownerSource?: string;
  captureSelection?: DesktopCaptureSelection | null;
  roomBitrateBps?: number | null;
  [key: string]: unknown;
}

export interface MediaCaptureStartOptions {
  captureSelection?: DesktopCaptureSelection | null;
  explicitBrowserFallback?: boolean;
  includeSystemAudio?: boolean;
  roomBitrateBps?: number | null;
}

export interface MediaCaptureManagerOptions {
  getSettings: () => MediaCaptureSettings;
  getAudioStereo: (source: string) => boolean;
  mediaDevices?: MediaDevices;
  onMicrophoneFallback?: (details: ExternalObject) => void;
  onMicrophoneRestored?: (details: ExternalObject) => void;
  onSource?: (entry: MediaCaptureEntry) => void;
  onSourceEnded?: (
    entry: MediaCaptureEntry,
    details?: Record<string, unknown>,
  ) => void;
}
