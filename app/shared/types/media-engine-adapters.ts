import type { MediaCommandResult } from "./boundary.ts";
import type { useHybridMediaSession } from "../../composables/useHybridMediaSession.ts";
import type { createMediaQoeReport } from "../media-qoe.ts";
import type {
  JoinSessionInput,
  MediaDeviceInfo,
  MediaEngineConfig,
  MediaSignalMessage,
  MediaStats,
  ScreenShareOptions,
} from "../media/types.ts";
import type {
  NativeCaptureRequest,
  NativeMediaFlags,
  NativeMediaStore,
} from "./native-media.ts";
import type {
  NativeTauriLike,
  NativeVoiceStoreLike,
} from "./native-media-engine.ts";
import type { ParticipantMediaCapabilities } from "./video-codec-capabilities.ts";

export type BrowserMediaSession = ReturnType<typeof useHybridMediaSession>;
export type MediaQoeReport = ReturnType<typeof createMediaQoeReport>;

export interface BrowserMediaEngineOptions {
  onQoe?: (report: MediaQoeReport) => void;
}

export interface MediaEngineFactoryOptions extends BrowserMediaEngineOptions {
  isTauri?: boolean;
  flags?: Partial<NativeMediaFlags>;
  tauri?: NativeTauriLike;
  nativeConfig?: NativeCaptureRequest;
  voiceStore?: NativeVoiceStoreLike;
  settingsStore?: NativeMediaStore;
  channelsStore?: NativeMediaStore;
}

export type BrowserMediaEngineSession = BrowserMediaSession & {
  on?: (event: string, callback: (...args: object[]) => void) => () => void;
  initialize?: (config?: MediaEngineConfig) => Promise<void>;
  joinSession?: (input: JoinSessionInput) => Promise<void>;
  leaveSession?: () => Promise<void>;
  setMicrophoneEnabled?: (enabled: boolean) => Promise<void>;
  setCameraEnabled?: (enabled: boolean) => Promise<void>;
  startScreenShare?: (options?: ScreenShareOptions) => Promise<void>;
  stopScreenShare?: () => Promise<void>;
  handleSignal?: (message: MediaSignalMessage) => Promise<void>;
  getDevices?: () => Promise<MediaDeviceInfo[]>;
  getStats?: () => Promise<MediaStats>;
  setMediaCapabilities?: (
    capabilities: ParticipantMediaCapabilities | null,
  ) => MediaCommandResult;
  shutdown?: () => Promise<void>;
  setMicrophoneDevice?: (deviceId: string) => Promise<void>;
  setOutputDevice?: (deviceId: string) => Promise<void>;
  setLocalVideoPreview?: (
    source: string,
    enabled: boolean,
  ) => MediaCommandResult;
  setJitterBufferConfig?: (
    config?: Record<string, unknown>,
  ) => MediaCommandResult;
  isScreenSharing?: () => boolean;
  isMicrophoneEnabled?: () => boolean;
  isCameraEnabled?: () => boolean;
  connect: BrowserMediaSession["connect"];
  disconnect: BrowserMediaSession["disconnect"];
  startAudioProduction: BrowserMediaSession["startAudioProduction"];
  stopAudioProduction: BrowserMediaSession["stopAudioProduction"];
  startVideoProduction: BrowserMediaSession["startVideoProduction"];
  stopVideoProduction: BrowserMediaSession["stopVideoProduction"];
  prepareAudioPlayback: BrowserMediaSession["prepareAudioPlayback"];
  restartAudioProduction: BrowserMediaSession["restartAudioProduction"];
  startSystemAudioProduction: BrowserMediaSession["startSystemAudioProduction"];
  stopSystemAudioProduction: BrowserMediaSession["stopSystemAudioProduction"];
  setRemoteScreenReceiving: BrowserMediaSession["setRemoteScreenReceiving"];
  setRemoteSystemAudioReceiving: BrowserMediaSession["setRemoteSystemAudioReceiving"];
  setSharedAudioVolume: BrowserMediaSession["setSharedAudioVolume"];
  setSharedAudioAttenuation: BrowserMediaSession["setSharedAudioAttenuation"];
  setSystemAudioBitrate: BrowserMediaSession["setSystemAudioBitrate"];
  sendParticipantVoiceState: BrowserMediaSession["sendParticipantVoiceState"];
  applyOutputDeviceToAll: BrowserMediaSession["applyOutputDeviceToAll"];
  applyVolumeForUser: BrowserMediaSession["applyVolumeForUser"];
  applyVolumeForTrack: BrowserMediaSession["applyVolumeForTrack"];
  ensureAudioElements: BrowserMediaSession["ensureAudioElements"];
  getOutboundRtpStats: BrowserMediaSession["getOutboundRtpStats"];
  getInboundRtpStats: BrowserMediaSession["getInboundRtpStats"];
  getWebRTCDiagnosticStats: BrowserMediaSession["getWebRTCDiagnosticStats"];
  areTransportsIceConnected: BrowserMediaSession["areTransportsIceConnected"];
  getWebRTCStatsSnapshot: BrowserMediaSession["getWebRTCStatsSnapshot"];
  activeProvider: BrowserMediaSession["activeProvider"];
  topologyState: BrowserMediaSession["topologyState"];
  mediaConnectionState: BrowserMediaSession["mediaConnectionState"];
  error: BrowserMediaSession["error"];
};

export type BrowserJoinInput = JoinSessionInput;
export type BrowserSignalMessage = MediaSignalMessage;
export type BrowserScreenShareOptions = ScreenShareOptions;
export type BrowserEngineConfig = MediaEngineConfig;
