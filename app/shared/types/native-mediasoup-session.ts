import type { CloudflarePublication } from "../types/cloudflare-media.ts";
import type { NativeConsumerEntry } from "./native-mediasoup.ts";
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
  resolve: (value?: unknown) => void;
  reject: (error: unknown) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export interface NativeSignalingSocket {
  open: () => Promise<unknown>;
  waitForReady?: () => Promise<unknown>;
  stop?: () => unknown;
  send: (message: unknown) => boolean | void;
  acknowledgeHeartbeat?: (sequence: number, timestamp: number) => unknown;
  acceptServerHello: (data: Record<string, unknown>) => boolean;
  getProtocolState: () => Record<string, unknown> | null;
  markReady: () => unknown;
}

export interface NativeProviderSignaling {
  connect: (options: {
    signalingUrl: string;
    ticket: string;
    mediaCapabilities?: ParticipantMediaCapabilities | null;
    capabilityProtocol?: string;
  }) => Promise<unknown>;
  close: () => unknown;
  send: (message: unknown) => boolean | void;
}

export interface NativeCloudflareSessionLike {
  localPeerId?: string;
  mediaCapabilities?:
    import("./video-codec-capabilities.ts").ParticipantMediaCapabilities | null;
  sessionId?: string | null;
  handle?: string | number | null;
  closed?: boolean;
  initialize: () => Promise<unknown>;
  closeMedia: () => unknown;
  startSubscriptions: () => Promise<unknown>;
  addSource: (entry: NativeSourceEntry) => Promise<unknown>;
  removeSource: (source: string) => unknown;
  removeVariant: (variantId: string, force?: boolean) => unknown;
  retireVariants?: (
    logicalStreamId: string,
    desiredVariantIds: string[],
  ) => unknown;
  hasVariant?: (variantId: string) => boolean;
  producers?: Map<string, Record<string, unknown>>;
  producerVariants?: Map<string, Record<string, unknown>>;
  updateVariantMetadata?: (
    entry: import("./native-cloudflare.ts").NativeCloudflareSourceEntry,
  ) => Promise<unknown>;
  setSourceTransmission: (source: string, enabled: boolean) => unknown;
  updateAudioBitrate: (source: string, bitrate: number) => unknown;
  updateVideoBitrate: (source: string, bitrate: number) => unknown;
  updateVideoParameters: (
    source: string,
    parameters: Record<string, unknown>,
  ) => unknown;
  updateVariantVideoParameters?: (
    variantId: string,
    parameters: Record<string, unknown>,
  ) => unknown;
  setRemoteReceiving: (
    userIdOrKey: string,
    sourceOrReceiving: string | boolean,
    receivingValue?: boolean,
  ) => unknown;
  setConsumerVolume: (
    userId: string | number,
    source: string,
    volume: number,
  ) => unknown;
  sendParticipantVoiceState: (state: {
    muted?: boolean;
    deafened?: boolean;
  }) => unknown;
  reconcilePublications: (
    publications: CloudflarePublication[],
    removedPublications?: CloudflarePublication[],
  ) => Promise<unknown>;
  applyJitterBufferConfig: (entry: NativeConsumerEntry) => unknown;
  setJitterBufferConfig: (config: {
    minDelayMs?: number;
    targetDelayMs?: number;
  }) => unknown;
  handleReceiveEvent: (event: Record<string, unknown>) => boolean;
  handleMessage: (type: string, data: Record<string, unknown>) => unknown;
  connectionState?: () => Record<string, unknown>;
  stats?: () => unknown;
  diagnosticStats?: () => unknown;
  expectedInboundFlowCount?: () => number;
  mediaReadiness?: (expectedInbound: number) => unknown;
  getOutboundRtpStats?: () => unknown;
  getInboundRtpStats?: () => unknown;
  codecRuntimeTelemetry?: import("../video-codec-migration.ts").VideoCodecRuntimeTelemetry[];
}

export interface NativeMediasoupConstructorOptions extends Partial<NativeMediasoupSfuSessionSurface> {
  invoke: NativeMediasoupSfuSessionSurface["invoke"];
  mediaProfile?: NativeMediaProfile;
  buildUrl?: (channelId: string | null) => string;
  location?: Location;
  mediaCapabilities?: ParticipantMediaCapabilities | null;
  getControlConnectionEpoch?: () => number;
}

export interface NativeMediasoupSfuSessionSurface {
  connected: boolean;
  joinReady: boolean;
  transportReady: boolean;
  iceConnectedBoth: boolean;
  isProducing: boolean;
  remoteProducersCount: number;
  errorMessage: string | Error | null;
  getState: () => string;
  connectionState: () => Record<string, unknown>;
  stats: () => Promise<unknown>;
  diagnosticStats: () => Promise<unknown[]>;
  getOutboundRtpStats: () => Promise<unknown[]>;
  getInboundRtpStats: () => Promise<unknown[]>;
  mediaReadiness: (
    expectedInbound?: number,
  ) => Promise<Record<string, unknown>>;
  expectedInboundFlowCount: () => number;
  connect: (channelId: string) => Promise<unknown>;
  handle: (type: string, data: Record<string, unknown>) => Promise<unknown>;
  reconcilePublications: (
    publications: CloudflarePublication[],
    removedPublications?: CloudflarePublication[],
  ) => Promise<unknown>;
  configureControl: (config: Record<string, unknown>) => unknown;
  addSource: (entry: NativeSourceEntry) => Promise<unknown>;
  removeSource: (source: string) => Promise<unknown>;
  setSourceTransmission: (source: string, enabled: boolean) => Promise<unknown>;
  updateAudioBitrate: (source: string, bitrate: number) => Promise<unknown>;
  updateVideoBitrate: (source: string, bitrate: number) => Promise<unknown>;
  updateVideoParameters: (
    source: string,
    parameters: Record<string, unknown>,
  ) => Promise<unknown>;
  adaptVideoReceiver: (
    logicalStreamId: string,
    preferredLayers: {
      spatialLayer?: number;
      temporalLayer?: number;
    },
  ) => Promise<unknown>;
  setJitterBufferConfig: (config?: {
    minDelayMs?: number;
    targetDelayMs?: number;
  }) => unknown;
  invoke: (
    operation: string,
    payload?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  buildUrl: (channelId: string | null) => string;
  signalingPath?: string;
  signalingToken?: string;
  controlTicket: string;
  refreshControl: (() => Promise<unknown>) | null;
  mediaSessionId: string;
  requestTimeoutMs: number;
  consumerControlTimeoutMs: number;
  recoveryTimeoutMs: number;
  consumerRetryDelayMs: number;
  initializationTimeoutMs: number;
  signaling: NativeSignalingSocket | null;
  providerSignaling: NativeProviderSignaling | null;
  messageHandlers: Map<string, (data: Record<string, unknown>) => unknown>;
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
  sourceOperations: Map<string, Promise<unknown>>;
  pendingCloudflarePublications: Map<string, Record<string, unknown>>;
  sourceTransmission: Map<string, boolean>;
  producerRemovals: Map<string, Promise<unknown>>;
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
  topologyState: Record<string, unknown> | null;
  localPeerId: string;
  lastInRoom: Array<Record<string, unknown>>;
  device: NativeDeviceEntry | null;
  sendTransport: NativeTransportEntry | null;
  recvTransport: NativeTransportEntry | null;
  channelId: string | null;
  closed: boolean;
  intentionalClose: boolean;
  initialized: boolean;
  connectPromise: Promise<unknown> | null;
  connectResolve: ((value?: unknown) => void) | null;
  connectReject: ((error: unknown) => void) | null;
  nativeTeardownPromise: Promise<unknown> | null;
  readyPromise: Promise<unknown> | null;
  readyResolve: ((value?: unknown) => void) | null;
  readyReject: ((error: unknown) => void) | null;
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
  recoveryOperations: Map<string, Promise<unknown>>;
  recoveryTimers: Map<string, ReturnType<typeof setTimeout>>;
  mediaRevision: number;
  initializationTimer: ReturnType<typeof setTimeout> | null;
  transportRequestIds: Map<NativeDirection, string>;
  cloudflareSession: NativeCloudflareSessionLike | null;
  providerActivationPromise: Promise<unknown> | null;
  lastProviderFailureKey: string | null;
  onRemoteTrack?: (entry: Record<string, unknown>) => unknown;
  onRemoteTrackEnded?: (entry: Record<string, unknown>) => unknown;
  onP2pSignal?: (data: Record<string, unknown>) => unknown;
  onCurrentlyInChannel?: (data: Record<string, unknown>) => unknown;
  onBeforeNativeTeardown?: () => unknown;
  onNativeMediaClose?: () => unknown;
  onStateChange?: (session: Record<string, unknown>) => unknown;
  onError?: (error: Error) => unknown;
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
