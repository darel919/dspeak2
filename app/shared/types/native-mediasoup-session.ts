import type { OwnedErrorValue } from "./shared-utilities.ts";

import type { MediaCommandResult } from "./boundary.ts";

import type { CloudflarePublication } from "../types/cloudflare-media.ts";
import type { NativeConsumerEntry } from "./native-mediasoup.ts";
import type { NativeTopology } from "./native-media.ts";
import type { SignalingMessage } from "./media-signaling.ts";
import type { VideoSettings } from "./video-settings.ts";
import type { ParticipantMediaCapabilities } from "./video-codec-capabilities.ts";
import type {
  CodecMigrationTelemetry,
  LogicalVideoStreamState,
  VideoCodecRuntimeTelemetry,
  VideoDecodeOverloadTelemetry,
} from "../video-codec-migration.ts";
import type { CodecRoutingPlan } from "../video-codec-routing.ts";

export type NativeDirection = "send" | "recv";
export type NativeMediaProfile = "audio" | "video" | "mixed";
export type NativeTransportState =
  "new" | "connecting" | "connected" | "failed" | "disconnected";

export interface NativeSourceEntry extends Record<string, unknown> {
  source: string;
  kind?: "audio" | "video";
  track?: Record<string, unknown> | null;
  ownerSource?: string | null;
  captureSelection?: Record<string, unknown> | null;
  audioBitrate?: number | null;
  audioStereo?: boolean | null;
  videoSettings?: VideoSettings | null;
  logicalStreamId?: string | null;
  generation?: number;
  variantId?: string | null;
  codec?: string | null;
  codecAcceleration?: string | null;
  codecImplementation?: string | null;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  bitrate?: number | null;
  receivers?: string[];
  emergency?: boolean;
  routingScore?: number;
  target?: import("../video-codec-routing.ts").CodecRoutingTarget;
  targetAdjusted?: boolean;
  producerKey?: string | null;
}

export interface NativeProducerEntry extends Record<string, unknown> {
  id: string;
  source: string;
  kind: "audio" | "video";
  entry: NativeSourceEntry;
  paused: boolean;
  producerKey?: string;
}

export interface NativeTransportEntry extends Record<string, unknown> {
  id: string;
  handle: string | number;
  direction: NativeDirection;
  closed: boolean;
}

export interface NativeDeviceEntry extends Record<string, unknown> {
  handle: string | number;
  rtpCapabilities: Record<string, unknown>;
}

export interface NativePendingRequest {
  resolve: (value?: MediaCommandResult) => void;
  reject: (error: OwnedErrorValue) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export interface NativeSignalingSocket {
  open: () => Promise<MediaCommandResult>;
  waitForReady?: () => Promise<MediaCommandResult>;
  stop?: () => MediaCommandResult;
  send: (message: SignalingMessage) => boolean | void;
  acknowledgeHeartbeat?: (
    sequence: number,
    timestamp: number,
  ) => MediaCommandResult;
  acceptServerHello: (data: Record<string, unknown>) => boolean;
  getProtocolState: () => Record<string, unknown> | null;
  markReady: () => MediaCommandResult;
}

export interface NativeProviderSignaling {
  connect: (options: {
    signalingUrl: string;
    ticket: string;
    mediaCapabilities?: ParticipantMediaCapabilities | null;
    capabilityProtocol?: string;
  }) => Promise<MediaCommandResult>;
  close: () => MediaCommandResult;
  send: (message: SignalingMessage) => boolean | void;
}

export interface NativeCloudflareSessionLike {
  localPeerId?: string;
  mediaCapabilities?:
    import("./video-codec-capabilities.ts").ParticipantMediaCapabilities | null;
  sessionId?: string | null;
  handle?: string | number | null;
  closed?: boolean;
  initialize: () => Promise<MediaCommandResult>;
  closeMedia: () => MediaCommandResult;
  startSubscriptions: () => Promise<MediaCommandResult>;
  addSource: (entry: NativeSourceEntry) => Promise<MediaCommandResult>;
  removeSource: (source: string) => MediaCommandResult;
  removeVariant: (variantId: string, force?: boolean) => MediaCommandResult;
  retireVariants?: (
    logicalStreamId: string,
    desiredVariantIds: string[],
  ) => MediaCommandResult;
  hasVariant?: (variantId: string) => boolean;
  producers?: Map<string, Record<string, unknown>>;
  producerVariants?: Map<string, Record<string, unknown>>;
  updateVariantMetadata?: (
    entry: import("./native-cloudflare.ts").NativeCloudflareSourceEntry,
  ) => Promise<MediaCommandResult>;
  setSourceTransmission: (
    source: string,
    enabled: boolean,
  ) => MediaCommandResult;
  updateAudioBitrate: (source: string, bitrate: number) => MediaCommandResult;
  updateVideoBitrate: (source: string, bitrate: number) => MediaCommandResult;
  updateVideoParameters: (
    source: string,
    parameters: Record<string, unknown>,
  ) => MediaCommandResult;
  updateVariantVideoParameters?: (
    variantId: string,
    parameters: Record<string, unknown>,
  ) => MediaCommandResult;
  setRemoteReceiving: (
    userIdOrKey: string,
    sourceOrReceiving: string | boolean,
    receivingValue?: boolean,
  ) => MediaCommandResult;
  setConsumerVolume: (
    userId: string | number,
    source: string,
    volume: number,
  ) => MediaCommandResult;
  sendParticipantVoiceState: (state: {
    muted?: boolean;
    deafened?: boolean;
  }) => MediaCommandResult;
  reconcilePublications: (
    publications: CloudflarePublication[],
    removedPublications?: CloudflarePublication[],
    isStale?: () => boolean,
    getLatestCanonical?: () => CloudflarePublication[],
    getLatestRevision?: () => string | null,
  ) => Promise<MediaCommandResult>;
  applyJitterBufferConfig: (entry: NativeConsumerEntry) => MediaCommandResult;
  setJitterBufferConfig: (config: {
    minDelayMs?: number;
    targetDelayMs?: number;
  }) => MediaCommandResult;
  handleReceiveEvent: (
    event: import("./native-cloudflare.ts").NativeCloudflareEvent,
  ) => boolean;
  handleMessage: (
    type: string,
    data: Record<string, unknown>,
    sessionGeneration?: number,
  ) => MediaCommandResult;
  sessionGeneration?: number;
  connectionState?: () => Record<string, unknown>;
  stats?: () => MediaCommandResult;
  diagnosticStats?: () => MediaCommandResult;
  expectedInboundFlowCount?: () => number;
  mediaReadiness?: (expectedInbound: number) => MediaCommandResult;
  getOutboundRtpStats?: () => MediaCommandResult;
  getInboundRtpStats?: () => MediaCommandResult;
  codecRuntimeTelemetry?: import("../video-codec-migration.ts").VideoCodecRuntimeTelemetry[];
}

export interface NativeMediasoupConstructorOptions extends Partial<NativeMediasoupSfuSessionSurface> {
  invoke: NativeMediasoupSfuSessionSurface["invoke"];
  invokeRaw?: import("./boundary.ts").NativeMediaInvoke;
  mediaProfile?: NativeMediaProfile;
  buildUrl?: (channelId: string | null) => string;
  location?: Location;
  mediaCapabilities?: ParticipantMediaCapabilities | null;
  getControlConnectionEpoch?: () => number;
}

export interface NativeMediasoupSfuSessionSurface {
  connected: boolean;
  joinReady: boolean;
  lastAppliedRoomRevision?: string;
  transportReady: boolean;
  iceConnectedBoth: boolean;
  isProducing: boolean;
  remoteProducersCount: number;
  errorMessage: string | Error | null;
  getState: () => string;
  connectionState: () => Record<string, unknown>;
  stats: () => Promise<MediaCommandResult>;
  diagnosticStats: () => Promise<MediaCommandResult>;
  getOutboundRtpStats: () => Promise<MediaCommandResult>;
  getInboundRtpStats: () => Promise<MediaCommandResult>;
  mediaReadiness: (
    expectedInbound?: number,
  ) => Promise<Record<string, unknown>>;
  expectedInboundFlowCount: () => number;
  connect: (channelId: string) => Promise<MediaCommandResult>;
  handle: (
    type: string,
    data: Record<string, unknown>,
  ) => Promise<MediaCommandResult>;
  reconcilePublications: (
    publications: CloudflarePublication[],
    removedPublications?: CloudflarePublication[],
    isStale?: () => boolean,
    getLatestCanonical?: () => CloudflarePublication[],
    getLatestRevision?: () => string | null,
  ) => Promise<MediaCommandResult>;
  configureControl: (config: Record<string, unknown>) => MediaCommandResult;
  addSource: (entry: NativeSourceEntry) => Promise<MediaCommandResult>;
  removeSource: (source: string) => Promise<MediaCommandResult>;
  setSourceTransmission: (
    source: string,
    enabled: boolean,
  ) => Promise<MediaCommandResult>;
  updateAudioBitrate: (
    source: string,
    bitrate: number,
  ) => Promise<MediaCommandResult>;
  updateVideoBitrate: (
    source: string,
    bitrate: number,
  ) => Promise<MediaCommandResult>;
  updateVideoParameters: (
    source: string,
    parameters: Record<string, unknown>,
  ) => Promise<MediaCommandResult>;
  adaptVideoReceiver: (
    logicalStreamId: string,
    preferredLayers: {
      spatialLayer?: number;
      temporalLayer?: number;
    },
  ) => Promise<MediaCommandResult>;
  setJitterBufferConfig: (config?: {
    minDelayMs?: number;
    targetDelayMs?: number;
  }) => MediaCommandResult;
  invoke: (
    operation: string,
    payload?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  buildUrl: (channelId: string | null) => string;
  signalingPath?: string;
  signalingToken?: string;
  controlTicket: string;
  refreshControl: (() => Promise<MediaCommandResult>) | null;
  mediaSessionId: string;
  requestTimeoutMs: number;
  consumerControlTimeoutMs: number;
  recoveryTimeoutMs: number;
  consumerRetryDelayMs: number;
  initializationTimeoutMs: number;
  signaling: NativeSignalingSocket | null;
  providerSignaling: NativeProviderSignaling | null;
  messageHandlers: Map<
    string,
    (data: Record<string, unknown>) => MediaCommandResult
  >;
  pending: Map<string, NativePendingRequest>;
  pendingProduce: Map<string, NativePendingRequest>;
  pendingConsumers: Set<string>;
  requestedConsumers: Set<string>;
  consumerRetryAttempts: Map<string, number>;
  consumerRetryTimers: Map<string, ReturnType<typeof setTimeout>>;
  transportPointers: Map<number, NativeDirection>;
  sources: Map<string, NativeSourceEntry>;
  producers: Map<string, NativeProducerEntry>;
  producerVariants: Map<string, NativeProducerEntry>;
  pendingLocalVideoFrames: Map<string, Record<string, unknown>>;
  remoteProducerMetadata: Map<string, Record<string, unknown>>;
  sourcePublications: Map<string, Promise<NativeProducerEntry | null>>;
  sourceOperations: Map<string, Promise<MediaCommandResult>>;
  pendingCloudflarePublications: Map<string, Record<string, unknown>>;
  sourceTransmission: Map<string, boolean>;
  sourceStates: Map<string, { generation: number; desiredState: string }>;
  producerRemovals: Map<string, Promise<MediaCommandResult>>;
  consumers: Map<string, NativeConsumerEntry>;
  transportStates: Map<NativeDirection, NativeTransportState>;
  lastSentClientRtpCapabilities: Record<string, unknown> | null;
  lastReceivedConsumerParams: Record<string, unknown> | null;
  protocolState: Record<string, unknown> | null;
  protocolUpdateRequired: boolean;
  lifecycle: unknown;
  activeProvider: string | null;
  activeSfuProvider: string | null;
  activeSfuProviderId: string | null;
  selectedProvider: string;
  selectedProviderId: string | null;
  playbackState: string;
  localVideoFeeds: Map<string, Record<string, unknown>>;
  remoteVideoFeeds: Map<string, Record<string, unknown>>;
  remoteAudioFeeds: Map<string, Record<string, unknown>>;
  topologyState: NativeTopology | null;
  localPeerId: string;
  lastInRoom: Array<Record<string, unknown>>;
  device: NativeDeviceEntry | null;
  sendTransport: NativeTransportEntry | null;
  recvTransport: NativeTransportEntry | null;
  channelId: string | null;
  closed: boolean;
  intentionalClose: boolean;
  initialized: boolean;
  connectPromise: Promise<MediaCommandResult> | null;
  connectResolve: ((value?: MediaCommandResult) => void) | null;
  connectReject: ((error: OwnedErrorValue) => void) | null;
  nativeTeardownPromise: Promise<MediaCommandResult> | null;
  readyPromise: Promise<MediaCommandResult> | null;
  readyResolve: ((value?: MediaCommandResult) => void) | null;
  readyReject: ((error: OwnedErrorValue) => void) | null;
  initializationRequestId: string | null;
  nextRequestSequence: number;
  pendingNativeDirection: NativeDirection | null;
  mediaConnectionState: string;
  connectionPhase: string;
  error: Error | null;
  microphoneDeviceState: string;
  sharedAudioStats: Record<string, number>;
  echoDetected: boolean;
  peerRoundTripTimes: Record<string, number>;
  peerConnectionMetrics: Record<string, unknown>;
  sfuRoundTripTime: number | null;
  participantSfuRoundTripTimes: Record<string, number>;
  remoteReceiving: Map<string, boolean>;
  jitterBufferMinimumDelay: number;
  jitterBufferTargetDelay: number;
  rtpSamples: Map<string, { timestamp: number | null; bytes: number | null }>;
  recoveryAttempts: Map<string, number>;
  recoveryOperations: Map<string, Promise<MediaCommandResult>>;
  recoveryTimers: Map<string, ReturnType<typeof setTimeout>>;
  mediaRevision: number;
  initializationTimer: ReturnType<typeof setTimeout> | null;
  transportRequestIds: Map<NativeDirection, string>;
  cloudflareSession: NativeCloudflareSessionLike | null;
  providerActivationPromise: Promise<MediaCommandResult> | null;
  lastProviderFailureKey: string | null;
  onRemoteTrack?: (entry: Record<string, unknown>) => MediaCommandResult;
  onRemoteTrackEnded?: (entry: Record<string, unknown>) => MediaCommandResult;
  onP2pSignal?: (data: Record<string, unknown>) => MediaCommandResult;
  onCurrentlyInChannel?: (data: Record<string, unknown>) => MediaCommandResult;
  onBeforeNativeTeardown?: () => MediaCommandResult;
  onNativeMediaClose?: () => MediaCommandResult;
  onStateChange?: (
    session: NativeMediasoupSfuSessionSurface,
  ) => MediaCommandResult;
  onError?: (error: Error) => MediaCommandResult;
  getAudioBitrate?: (source: string) => number | null;
  getAudioStereo?: (source: string) => boolean | null;
  getVideoSettings?: (source: string) => VideoSettings;
  getControlConnectionEpoch?: () => number;
  controlConnectionEpoch?: number;
  mediaCapabilities: ParticipantMediaCapabilities | null;
  remoteParticipantCapabilities: Map<string, ParticipantMediaCapabilities>;
  logicalVideoStreams: Map<string, LogicalVideoStreamState>;
  codecMigrationTelemetry: CodecMigrationTelemetry[];
  videoDecodeOverloadTelemetry: VideoDecodeOverloadTelemetry[];
  codecRuntimeTelemetry: VideoCodecRuntimeTelemetry[];
  codecRoutingPlans: Map<string, CodecRoutingPlan>;
  codecRoutingCandidatePlans: Map<
    string,
    { signature: string; firstSeenAt: number }
  >;
}
