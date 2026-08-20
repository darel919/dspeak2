import type { Ref } from "vue";
import type { MediaCaptureStartOptions } from "./media-capture.ts";
import type { SoundSettings } from "../system-sounds.ts";
import type { RtcStatsSnapshot } from "./rtc-stats.ts";

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
  joinChannel: (channelId: string) => unknown;
  leaveChannel: (channelId: string) => unknown;
}

export interface VoiceProducerLike {
  track?: MediaStreamTrack | null;
  on?: (event: string, listener: () => void) => unknown;
}

export interface VoiceMediaSessionLike {
  activeProvider?: Ref<string | null> | string | null;
  error?: Ref<string | null> | string | null;
  joinReady?: Ref<boolean> | boolean;
  localVideoFeeds?: Ref<Map<string, unknown>> | Map<string, unknown>;
  remoteVideoFeeds?: Ref<Map<string, unknown>> | Map<string, unknown>;
  remoteAudioFeeds?: Ref<Map<string, unknown>> | Map<string, unknown>;
  sharedAudioStats?: Ref<unknown> | unknown;
  sharedAudioAttenuation?: Ref<unknown> | unknown;
  sharedAudioDucking?: Ref<unknown> | unknown;
  transportReady?: Ref<boolean> | boolean;
  connect: (channelId: string, options?: { roomId?: string | null }) => unknown;
  disconnect?: () => unknown;
  prepareAudioPlayback?: () => unknown;
  startAudioProduction: () => Promise<VoiceProducerLike | null | undefined>;
  stopAudioProduction?: () => Promise<unknown>;
  startVideoProduction: (
    source: string,
    options?: MediaCaptureStartOptions,
  ) => Promise<VoiceProducerLike | null | undefined>;
  stopVideoProduction: (source: string) => Promise<unknown>;
  startSystemAudioProduction: (
    options?: MediaCaptureStartOptions,
  ) => Promise<VoiceProducerLike | null | undefined>;
  stopSystemAudioProduction: () => Promise<unknown>;
  sendParticipantVoiceState?: (state: {
    muted: boolean;
    deafened: boolean;
  }) => unknown;
  ensureAudioElements?: () => unknown;
  applyOutputDeviceToAll?: () => unknown;
  setSharedAudioVolume?: (volume: number) => unknown;
  setSharedAudioAttenuation?: (
    speaking: boolean,
    attenuation?: {
      enabled?: boolean;
      reductionPercent?: number;
      attackMs?: number;
      releaseMs?: number;
    },
  ) => unknown;
  setSystemAudioBitrate?: (bitrate: number) => unknown;
  applyVolumeForUser?: (userId: string, volume: number) => unknown;
  applyVolumeForTrack?: (
    userId: string,
    source: string,
    volume: number,
  ) => unknown;
  setRemoteScreenReceiving?: (feedKey: string, receiving: boolean) => unknown;
  markRemoteFirstFrame?: (
    key: string,
    receiverIncarnationId?: string | null,
    fallback?: boolean,
  ) => unknown;
  markRemoteFramePresented?: (
    key: string,
    receiverIncarnationId?: string | null,
  ) => unknown;
  setRemoteSystemAudioReceiving?: (
    feedKey: string,
    receiving: boolean,
  ) => unknown;
  getOutboundRtpStats?: () => Promise<unknown>;
  getInboundRtpStats?: () => Promise<unknown>;
  getWebRTCStatsSnapshot?: () => Promise<RtcStatsSnapshot>;
  getWebRTCDiagnosticStats?: () => Promise<unknown>;
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
  joinChannel: (channelId: string) => unknown;
  joinGenerationState: { value: number };
  leaveChannel: (channelId: string) => unknown;
  micMuted: Ref<boolean>;
  nativeMediaInvalidated: Ref<boolean>;
  pageLifecycle: VoicePageLifecycleLike;
  p2pQualification: Ref<unknown>;
  playFatalError: (error: unknown) => void;
  protocolUpdateRequired: Ref<boolean>;
  screenSharing: Ref<boolean>;
  settingsStore: VoiceSettingsLike;
  soundboardActivityTimers: Map<string, ReturnType<typeof setTimeout>>;
  stopBroadcast: () => Promise<unknown>;
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
