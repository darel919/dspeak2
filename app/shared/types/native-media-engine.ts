import type {
  NativeCaptureRequest,
  NativeMediaFlags,
  NativeMediaStore,
} from "./native-media.ts";
import type { VideoSettings } from "./video-settings.ts";
import type { VoiceUserRecord } from "./voice-media-actions.ts";
import type { NoiseFloorEstimator } from "./microphone-gate.ts";
import type { ParticipantMediaCapabilities } from "./video-codec-capabilities.ts";

export interface NativeVoiceStoreLike {
  currentChannelId?: string | null;
  micMuted?: boolean;
  deafened?: boolean;
  cameraEnabled?: boolean;
  screenSharing?: boolean;
  systemAudioSharing?: boolean;
  invalidateAfterFatalMediaError?: () => unknown;
  getChannelById?: NativeMediaStore["getChannelById"];
  getAuthenticatedUser?: () => { id?: string | number } | null;
  upsertUserProfile?: (profile: Record<string, unknown>) => unknown;
  isUserConnected?: (userId: string) => boolean;
  addConnectedUser?: (userId: string, user: VoiceUserRecord) => unknown;
  getConnectedUsersArray?: () => VoiceUserRecord[];
  updateUserSpeaking?: (userId: string | number, speaking: boolean) => unknown;
  removeConnectedUser?: (userId: string | number) => unknown;
  updateUserVoiceState?: (
    userId: string | number,
    state: Record<string, unknown>,
  ) => unknown;
}

export interface NativeTauriLike {
  invoke: (command: string, payload?: NativeCaptureRequest) => Promise<unknown>;
  listen: (
    event: string,
    callback: (event: { payload: unknown }) => void,
  ) => Promise<() => void>;
}

export interface NativeMediaEngineState {
  browserEngine: import("./media-engine-adapters.ts").BrowserMediaEngineSession;
  flags: NativeMediaFlags;
  tauri: NativeTauriLike | null;
  nativeConfig: NativeCaptureRequest;
  nativeOnly: boolean;
  voiceStore: NativeVoiceStoreLike | null;
  settingsStore: NativeMediaStore | null;
  channelsStore: NativeMediaStore | null;
  getAudioBitrate: (source: string) => number | null;
  getAudioStereo: (source: string) => boolean | null;
  getVideoSettings: (source: string) => VideoSettings;
  listeners: Map<string, Set<(...args: unknown[]) => void>>;
  unlisten: Array<() => void>;
  initialized: boolean;
  activeScreenCapture: NativeCaptureRequest | null;
  activeSystemAudioCapture: NativeCaptureRequest | null;
  microphoneOperation: Promise<unknown>;
  cameraOperation: Promise<unknown>;
  screenOperation: Promise<unknown>;
  nativeEventOperation: Promise<unknown> | null;
  nativeActionHandler: ((action: NativeCaptureRequest) => unknown) | null;
  nativeReceiveEventHandler: ((event: NativeCaptureRequest) => void) | null;
  nativeSession:
    import("../native-mediasoup-session.ts").NativeMediasoupSfuSession | null;
  nativeP2pSession: import("../native-p2p-session.ts").NativeP2pSession | null;
  remoteVideoFeedsRef: import("vue").Ref<Map<string, unknown>>;
  remoteAudioFeedsRef: import("vue").Ref<Map<string, unknown>>;
  localVideoFeedsRef: import("vue").Ref<Map<string, unknown>>;
  sharedAudioAttenuationRef: import("vue").Ref<{
    active: boolean;
    effectivePercent: number;
    expectedListeners: number;
    reportingListeners: number;
  }>;
  sharedAudioDuckingRef: import("vue").Ref<{
    active: boolean;
    effectivePercent: number;
  }>;
  nativeProvider: "sfu" | "p2p";
  nativeP2pFailureEpoch: number | null;
  nativeTopologyKey: string | null;
  nativeTopologyGeneration: number;
  nativeTopologyOperation: Promise<unknown> | null;
  onQoe: import("./native-media.ts").NativeMediaEngineOptions["onQoe"];
  qoeTimer: ReturnType<typeof setInterval> | null;
  nativeVideoAdaptationTimer: ReturnType<typeof setTimeout> | null;
  nativeVideoAdaptationOperation: Promise<unknown> | null;
  nativeVideoAdaptationStates: Map<
    string,
    import("./adaptive-media.ts").AdaptiveVideoState
  >;
  nativeVideoAdaptationCounters: Map<
    string,
    { totalEncodeTime: number; framesEncoded: number }
  >;
  nativeVideoDecodeAdaptationStates: Map<
    string,
    import("../video-codec-overload.ts").DecodeAdaptationState
  >;
  nativeVideoDecodeAdaptationCounters: Map<
    string,
    import("../video-codec-overload.ts").DecodeAdaptationCounters
  >;
  nativeNoiseFloorEstimator: NoiseFloorEstimator | null;
  nativeSpeaking: boolean;
  nativeActiveSamples: number;
  nativeQuietSamples: number;
  nativeEchoDetector: {
    sample: (input: {
      active: boolean;
      echoCancellation: boolean;
      remoteSpeaking: boolean;
    }) => void;
    clear: () => void;
  } | null;
  nativeAuthToken: string;
  mediaCapabilities: ParticipantMediaCapabilities | null;
}
