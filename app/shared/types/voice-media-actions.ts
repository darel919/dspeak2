import type { OwnedErrorValue } from "./shared-utilities.ts";

import type { MediaCommandResult } from "./boundary.ts";

import type { Ref } from "vue";
import type { MediaCaptureStartOptions } from "./media-capture.ts";
import type { SoundSettings } from "../system-sounds.ts";
import type { RtcStatsSnapshot } from "./rtc-stats.ts";
import type { RemotePresentationObservationMode } from "../remote-source-convergence.ts";

type VoiceMediaFeedValue = Map<string, unknown> | ReadonlyMap<string, unknown>;
type VoiceMediaFeedState =
  | VoiceMediaFeedValue
  | Ref<VoiceMediaFeedValue>
  | Readonly<Ref<ReadonlyMap<string, unknown>>>;

export interface VoiceUserRecord {
  id: string;
  speaking?: boolean;
  muted?: boolean;
  deafened?: boolean;
  cameraEnabled?: boolean;
  screenSharing?: boolean;
  soundboardActivity?: VoiceSoundboardActivity | null;
  [key: string]: unknown;
}

export interface VoiceSoundboardActivity {
  activityId: string;
  title: string;
  icon: string;
}

export interface VoiceSoundboardActivityInput {
  activityId?: string | number;
  title?: string;
  icon?: string;
  duration?: number;
}

export interface VoiceChannelRecord {
  id?: string;
  roomId?: string | null;
  room?: string | null;
  mediaPolicy?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface VoiceChannelsStoreLike {
  getChannelById: (
    channelId: string | null,
  ) => VoiceChannelRecord | null | undefined;
  joinChannel: (channelId: string) => MediaCommandResult;
  leaveChannel: (channelId: string) => MediaCommandResult;
}

export interface VoiceProducerLike {
  track?: MediaStreamTrack | null;
  on?: (event: string, listener: () => void) => MediaCommandResult;
}

export interface VoiceMediaSessionLike {
  activeProvider?: Ref<string | null> | string | null;
  requestedLatencyProfile?:
    Ref<"standard" | "ultra-low"> | "standard" | "ultra-low";
  webMediaLatencyTier?:
    | Ref<"standard-webrtc" | "latency-tuned-webrtc">
    | "standard-webrtc"
    | "latency-tuned-webrtc";
  error?: Ref<string | null> | string | null;
  joinReady?: Ref<boolean> | boolean;
  localVideoFeeds?: VoiceMediaFeedState;
  remoteVideoFeeds?: VoiceMediaFeedState;
  remoteAudioFeeds?: VoiceMediaFeedState;
  sharedAudioStats?: Ref<unknown> | unknown;
  sharedAudioAttenuation?: Ref<unknown> | unknown;
  sharedAudioDucking?: Ref<unknown> | unknown;
  transportReady?: Ref<boolean> | boolean;
  connect: (
    channelId: string,
    options?: { roomId?: string },
  ) => MediaCommandResult;
  disconnect?: () => MediaCommandResult;
  prepareAudioPlayback?: () => MediaCommandResult;
  startAudioProduction: () => Promise<MediaCommandResult>;
  stopAudioProduction?: () => Promise<MediaCommandResult>;
  startVideoProduction: (
    source: "camera" | "screen",
    options?: MediaCaptureStartOptions,
  ) => Promise<MediaCommandResult>;
  stopVideoProduction: (
    source: "camera" | "screen",
  ) => Promise<MediaCommandResult>;
  startSystemAudioProduction: (
    options?: MediaCaptureStartOptions,
  ) => Promise<MediaCommandResult>;
  stopSystemAudioProduction: () => Promise<MediaCommandResult>;
  sendParticipantVoiceState?: (state: {
    muted: boolean;
    deafened: boolean;
  }) => MediaCommandResult;
  ensureAudioElements?: () => MediaCommandResult;
  applyOutputDeviceToAll?: () => MediaCommandResult;
  setSharedAudioVolume?: (volume: number) => MediaCommandResult;
  setSharedAudioAttenuation?: (
    speaking: boolean,
    attenuation?: {
      enabled?: boolean;
      reductionPercent?: number;
      attackMs?: number;
      releaseMs?: number;
    },
  ) => MediaCommandResult;
  setSystemAudioBitrate?: (bitrate: number) => MediaCommandResult;
  applyVolumeForUser?: (userId: string, volume: number) => MediaCommandResult;
  applyVolumeForTrack?: (
    userId: string,
    source: string,
    volume: number,
  ) => MediaCommandResult;
  setRemoteScreenReceiving?: (
    feedKey: string,
    receiving: boolean,
  ) => MediaCommandResult;
  markRemoteFirstFrame?: (
    key: string,
    receiverIncarnationId?: string | null,
    fallback?: boolean,
    observationMode?: Exclude<RemotePresentationObservationMode, "unavailable">,
  ) => MediaCommandResult;
  markRemoteFramePresented?: (
    key: string,
    receiverIncarnationId?: string | null,
    observationMode?: Exclude<RemotePresentationObservationMode, "unavailable">,
  ) => MediaCommandResult;
  setRemoteSystemAudioReceiving?: (
    feedKey: string,
    receiving: boolean,
  ) => MediaCommandResult;
  getOutboundRtpStats?: () => Promise<MediaCommandResult>;
  getInboundRtpStats?: () => Promise<MediaCommandResult>;
  getWebRTCStatsSnapshot?: () => Promise<RtcStatsSnapshot>;
  getWebRTCDiagnosticStats?: () => Promise<MediaCommandResult>;
  getVoiceTransportTimeout?: () => number;
}

export interface VoicePageLifecycleLike {
  register: () => void;
  unregister: () => void;
}

export type VoiceSettingsLike = SoundSettings;

export interface VoiceStoreLike {}

export interface VoiceCaptureToggleOptions extends MediaCaptureStartOptions {
  includeSystemAudio?: boolean;
}

export interface VoiceMediaActionOptions {
  addConnectedUser: (userId: string | number, user: VoiceUserRecord) => void;
  broadcastAudioSharing: Ref<boolean>;
  cameraEnabled: Ref<boolean>;
  cameraToggleGenerationState: { value: number };
  channelsStore: VoiceChannelsStoreLike;
  clearUserDirectory?: () => void;
  connected: Ref<boolean>;
  connectedAt: Ref<number | null>;
  connectedUsers: Ref<Map<string, VoiceUserRecord>>;
  connecting: Ref<boolean>;
  currentChannelId: Ref<string | null>;
  currentRoomId: Ref<string | null>;
  deafened: Ref<boolean>;
  djSession: Ref<Record<string, unknown> | null>;
  effectiveSystemAudioBitrate: Ref<number>;
  error: Ref<string | null>;
  getAuthenticatedUser: () => VoiceUserRecord | null;
  getVoiceStore: () => VoiceStoreLike;
  joinChannel: (channelId: string) => MediaCommandResult;
  joinGenerationState: { value: number };
  leaveChannel: (channelId: string) => MediaCommandResult;
  micMuted: Ref<boolean>;
  nativeMediaInvalidated: Ref<boolean>;
  pageLifecycle: VoicePageLifecycleLike;
  p2pQualification: Ref<unknown>;
  playFatalError: (error: OwnedErrorValue) => void;
  protocolUpdateRequired: Ref<boolean>;
  screenSharing: Ref<boolean>;
  settingsStore: VoiceSettingsLike;
  soundboardActivityTimers: Map<string, ReturnType<typeof setTimeout>>;
  stopBroadcast: () => Promise<MediaCommandResult>;
  systemAudioSharing: Ref<boolean>;
  sfuComposable: Ref<VoiceMediaSessionLike | null>;
  updateUserVoiceState: (
    userId: string | number,
    state: {
      muted?: boolean;
      deafened?: boolean;
      cameraEnabled?: boolean;
      screenSharing?: boolean;
    },
  ) => void;
  upsertUserProfile: (profile: VoiceUserRecord) => void;
}
