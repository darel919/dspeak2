import type { AudioSettings } from "./settings.ts";
import type { ChannelRoomRecord } from "./channel-room.ts";
import type { MicrophoneGateSettings } from "./microphone-gate.ts";
import type { VideoSettings } from "./video-settings.ts";
import type { ParticipantMediaCapabilities } from "./video-codec-capabilities.ts";
import type {
  NativeTauriLike,
  NativeVoiceStoreLike,
} from "./native-media-engine.ts";

export interface NativeMediaFlags {
  nativeRtc: boolean;
  nativeBackendReady: boolean;
  nativeScreenShare: boolean;
  nativeScreenAudio: boolean;
  nativeP2P: boolean;
  nativeSfu: boolean;
  nativeMicrophone: boolean;
  nativeCamera: boolean;
  nativeAudioReceive: boolean;
  nativeVideoReceive: boolean;
  [key: string]: boolean;
}

export type NativeMediaFlagOverrides = Partial<NativeMediaFlags> &
  Record<string, boolean | undefined>;
export type NativeCaptureRequest = Record<string, unknown>;
export type NativeTopology = {
  mode?: unknown;
  target?: unknown;
  targetProvider?: unknown;
  targetProviderId?: unknown;
  provider?: unknown;
  providerId?: unknown;
  route?: { provider?: unknown; providerId?: unknown };
  localPeerId?: string | null;
  epoch?: unknown;
  sourceRevision?: unknown;
  [key: string]: unknown;
};
export type NativeErrorLike = {
  code?: unknown;
  message?: unknown;
  cause?: unknown;
  details?: unknown;
  nativeCommand?: unknown;
  nativeResponse?: unknown;
};
export type NativeCapabilities = Partial<NativeMediaFlags> & {
  capture?: Record<
    string,
    { available?: boolean; sources?: unknown[] } | undefined
  >;
  videoCodecDiagnostics?: Record<string, unknown>;
  videoCodecCapabilities?: Record<string, unknown>;
  concurrentEncode?: Record<string, unknown>;
  mediaCapabilities?: ParticipantMediaCapabilities;
};
export interface NativeFeed {
  key?: string;
  logicalStreamId?: string;
  generation?: number;
  variantId?: string | null;
  codec?: string | null;
  codecAcceleration?: string | null;
  codecImplementation?: string | null;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  bitrate?: number | null;
  userId?: unknown;
  source?: unknown;
  kind?: string;
  closed?: boolean;
  frame?: unknown;
}

export interface NativeMediaStore {
  currentChannelId?: string | null;
  loadedRoomId?: string | null;
  micDeviceId?: string | null;
  cameraDeviceId?: string | null;
  systemSoundVolume?: number;
  systemSoundTheme?: string;
  systemSoundsMuted?: boolean;
  outputDeviceId?: string | null;
  sharedAudioVolume?: number;
  systemAudioBitrate?: number | null;
  audio?: AudioSettings;
  microphoneGate?: Required<MicrophoneGateSettings>;
  screenVideo?: VideoSettings;
  cameraVideo?: VideoSettings;
  getChannelById?: (channelId: string | null) =>
    | (ChannelRoomRecord & {
        mediaPolicy?: Record<string, unknown> | null;
      })
    | null
    | undefined;
}

export interface NativeMediaEngineOptions {
  browserEngine?: import("./media-engine-adapters.ts").BrowserMediaEngineSession;
  flags?: Partial<NativeMediaFlags>;
  tauri?: NativeTauriLike;
  nativeConfig?: NativeCaptureRequest;
  nativeOnly?: boolean;
  voiceStore?: NativeVoiceStoreLike;
  settingsStore?: NativeMediaStore;
  channelsStore?: NativeMediaStore;
  getAudioBitrate?: (source: string) => number | null;
  getAudioStereo?: (source: string) => boolean | null;
  getVideoSettings?: (source: string) => VideoSettings;
  onQoe?: (
    report: ReturnType<
      typeof import("../../shared/media-qoe.ts").createMediaQoeReport
    >,
  ) => void;
}
