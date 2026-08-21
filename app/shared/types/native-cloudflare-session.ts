import type { OwnedErrorValue } from "./shared-utilities.ts";
import type { ExternalObject, NativeMediaInvoke } from "./boundary.ts";

import type { MediaCommandResult } from "./boundary.ts";

import type { CloudflarePublication } from "./cloudflare-media.ts";
import type {
  NativeCloudflareEvent,
  NativeCloudflareMessage,
  NativeCloudflarePublication,
  NativeCloudflareSourceEntry,
} from "./native-cloudflare.ts";
import type { SignalingMessage } from "./media-signaling.ts";

export interface NativeCloudflareSessionOptions {
  invoke: NativeMediaInvoke;
  send?: NativeCloudflareSessionSurface["send"];
  ensureControlReady?: NativeCloudflareSessionSurface["ensureControlReady"];
  onRemoteTrack?: NativeCloudflareSessionSurface["onRemoteTrack"];
  onRemoteTrackEnded?: NativeCloudflareSessionSurface["onRemoteTrackEnded"];
  onStateChange?: NativeCloudflareSessionSurface["onStateChange"];
  onError?: NativeCloudflareSessionSurface["onError"];
  getAudioBitrate?: NativeCloudflareSessionSurface["getAudioBitrate"];
  getAudioStereo?: NativeCloudflareSessionSurface["getAudioStereo"];
  getVideoSettings?: NativeCloudflareSessionSurface["getVideoSettings"];
  requestTimeoutMs?: number;
  localPeerId?: string | null;
  sources?: NativeCloudflareSessionSurface["sources"];
  producers?: NativeCloudflareSessionSurface["producers"];
  producerVariants?: NativeCloudflareSessionSurface["producerVariants"];
  consumers?: NativeCloudflareSessionSurface["consumers"];
  sourceTransmission?: NativeCloudflareSessionSurface["sourceTransmission"];
  remoteReceiving?: NativeCloudflareSessionSurface["remoteReceiving"];
  localVideoFeeds?: NativeCloudflareSessionSurface["localVideoFeeds"];
  pendingLocalVideoFrames?: NativeCloudflareSessionSurface["pendingLocalVideoFrames"];
  remoteVideoFeeds?: NativeCloudflareSessionSurface["remoteVideoFeeds"];
  remoteAudioFeeds?: NativeCloudflareSessionSurface["remoteAudioFeeds"];
  mediaCapabilities?:
    import("./video-codec-capabilities.ts").ParticipantMediaCapabilities | null;
  getControlConnectionEpoch?: () => number;
}

export interface NativeCloudflareSessionSurface {
  invoke: (
    operation: string,
    payload?: Record<string, unknown>,
  ) => Promise<MediaCommandResult>;
  send?: (message: SignalingMessage) => MediaCommandResult;
  ensureControlReady?: () => Promise<MediaCommandResult>;
  onRemoteTrack?: (entry: Record<string, unknown>) => MediaCommandResult;
  onRemoteTrackEnded?: (entry: Record<string, unknown>) => MediaCommandResult;
  onStateChange?: (...args: unknown[]) => MediaCommandResult;
  onError?: (error: OwnedErrorValue) => MediaCommandResult;
  getAudioBitrate?: (source: string) => number | null;
  getAudioStereo?: (source: string) => boolean | null;
  getVideoSettings?: (
    source: string,
  ) => import("./video-settings.ts").VideoSettings;
  requestTimeoutMs: number;
  localPeerId: string;
  sources: Map<string, NativeCloudflareSourceEntry>;
  producers: Map<string, NativeCloudflareSourceEntry>;
  producerVariants: Map<string, NativeCloudflareSourceEntry>;
  consumers: Map<string, Record<string, unknown>>;
  sourceTransmission: Map<string, boolean>;
  remoteReceiving: Map<string, boolean>;
  localVideoFeeds: Map<string, Record<string, unknown>>;
  pendingLocalVideoFrames: Map<string, Record<string, unknown>>;
  remoteVideoFeeds: Map<string, Record<string, unknown>>;
  remoteAudioFeeds: Map<string, Record<string, unknown>>;
  mediaCapabilities:
    import("./video-codec-capabilities.ts").ParticipantMediaCapabilities | null;
  logicalVideoStreams: Map<
    string,
    import("../video-codec-migration.ts").LogicalVideoStreamState
  >;
  codecMigrationTelemetry: import("../video-codec-migration.ts").CodecMigrationTelemetry[];
  videoDecodeOverloadTelemetry: import("../video-codec-migration.ts").VideoDecodeOverloadTelemetry[];
  codecRuntimeTelemetry: import("../video-codec-migration.ts").VideoCodecRuntimeTelemetry[];
  publications: Map<string, NativeCloudflarePublication>;
  remoteByMid: Map<string, Record<string, unknown>>;
  pendingRemoteTrackEvents: Map<string, Array<Record<string, unknown>>>;
  pending: Map<
    string,
    {
      resolve: (value: NativeCloudflareMessage) => void;
      reject: (error: OwnedErrorValue) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >;
  subscriptionTasks: Map<string, Promise<MediaCommandResult>>;
  subscribedTrackNames: Set<string>;
  subscriptionsStarted: boolean;
  negotiationQueue: Promise<MediaCommandResult>;
  sourceOperations: Map<string, Promise<MediaCommandResult>>;
  rtpSamples: Map<string, { timestamp: number | null; bytes: number | null }>;
  handle: string | number | null;
  sessionId: string | null;
  initializing: Promise<MediaCommandResult> | null;
  sessionGeneration: number;
  closed: boolean;
  iceState: number;
  jitterBufferMinimumDelay: number;
  jitterBufferTargetDelay: number;
  lastReceivedConsumerParams: unknown;
  controlConnectionEpoch: number;
  getControlConnectionEpoch: () => number;
  connectionState: () => {
    ready: boolean;
    send: string;
    recv: string;
    sendRequired: boolean;
    receiveRequired: boolean;
  };
  stats: () => Promise<Array<Record<string, unknown>>>;
  diagnosticStats: () => Promise<Array<Record<string, unknown>>>;
  mediaReadiness: (expectedInbound: number) => Promise<Record<string, unknown>>;
  getOutboundRtpStats: () => Promise<Array<Record<string, unknown>>>;
  getInboundRtpStats: () => Promise<Array<Record<string, unknown>>>;
  expectedInboundFlowCount: () => number;
  waitForRemoteTracks: (
    topology?: import("./native-cloudflare.ts").NativeCloudflareTopology,
    timeoutMs?: number,
  ) => Promise<boolean>;
  _rawStats: () => Promise<MediaCommandResult>;
  _assertCurrent: (generation: number, handle?: string | number | null) => void;
  _emitState: () => MediaCommandResult;
  closeMedia: () => MediaCommandResult;
  shutdown: () => MediaCommandResult;
  removeSource: (source: string) => MediaCommandResult;
  removeVariant: (variantId: string, force?: boolean) => MediaCommandResult;
  retireVariants: (
    logicalStreamId: string,
    desiredVariantIds: string[],
  ) => MediaCommandResult;
  hasVariant: (variantId: string) => boolean;
  updateVariantMetadata: (
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
  updateVariantVideoParameters: (
    variantId: string,
    parameters: Record<string, unknown>,
  ) => MediaCommandResult;
  setRemoteReceiving: (
    userIdOrKey: string,
    sourceOrReceiving: string | boolean,
    receivingValue?: boolean,
  ) => Promise<boolean>;
  setConsumerVolume: (
    userId: string | number,
    source: string,
    volume: number,
  ) => MediaCommandResult;
  sendParticipantVoiceState: (state: {
    muted?: boolean;
    deafened?: boolean;
  }) => MediaCommandResult;
  setJitterBufferConfig: (config: {
    minDelayMs?: number;
    targetDelayMs?: number;
  }) => MediaCommandResult;
  handleReceiveEvent: (event: NativeCloudflareEvent) => boolean;
  startSubscriptions: () => Promise<MediaCommandResult>;
  addSource: (
    entry: import("./native-cloudflare.ts").NativeCloudflareSourceEntry,
  ) => Promise<MediaCommandResult>;
  handleMessage: (
    type: string,
    data: Record<string, unknown>,
  ) => MediaCommandResult;
  reconcilePublications: (
    publications: CloudflarePublication[],
    removedPublications?: CloudflarePublication[],
    isStale?: () => boolean,
    getLatestCanonical?: () => CloudflarePublication[],
    getLatestRevision?: () => string | null,
  ) => Promise<MediaCommandResult>;
  reconcilePublicationsOnce?: (
    publications: CloudflarePublication[],
    isStale: () => boolean,
  ) => Promise<MediaCommandResult>;
  subscribe: (
    publication: import("./native-cloudflare.ts").NativeCloudflarePublication,
    generation?: number,
  ) => Promise<MediaCommandResult>;
  _closeConsumer: (entry: Record<string, unknown>) => MediaCommandResult;
  request: (
    operation: string,
    body?: ExternalObject,
  ) => Promise<NativeCloudflareMessage>;
  enqueueNegotiation: (
    operation: () => Promise<MediaCommandResult>,
  ) => Promise<MediaCommandResult>;
  enqueueSourceOperation: (
    source: string,
    operation: () => Promise<MediaCommandResult>,
  ) => Promise<MediaCommandResult>;
  updateVariantMetadataInternal: (
    entry: import("./native-cloudflare.ts").NativeCloudflareSourceEntry,
  ) => Promise<MediaCommandResult>;
  addSourceInternal: (
    entry: import("./native-cloudflare.ts").NativeCloudflareSourceEntry,
  ) => Promise<MediaCommandResult>;
  removeSourceInternal: (source: string) => Promise<MediaCommandResult>;
  subscribePublications: (
    publications: import("./native-cloudflare.ts").NativeCloudflarePublication[],
    generation?: number,
  ) => Promise<MediaCommandResult>;
  _subscribePublicationBatch: (
    publications: import("./native-cloudflare.ts").NativeCloudflarePublication[],
    generation: number,
  ) => Promise<MediaCommandResult>;
  _subscribePublication: (
    publication: import("./native-cloudflare.ts").NativeCloudflarePublication,
    generation: number,
  ) => Promise<MediaCommandResult>;
  _updateBitrate: (
    source: string,
    maxBitrate: number,
    kind: "audio" | "video",
  ) => Promise<boolean>;
  _setSourceParameters: (
    entry: import("./native-cloudflare.ts").NativeCloudflareSourceEntry,
    generation?: number,
    overrides?: Record<string, unknown>,
  ) => Promise<boolean>;
  applyJitterBufferConfig: (
    entry: Record<string, unknown>,
  ) => MediaCommandResult;
  takePendingLocalVideoFrame: (
    source: string,
  ) => Record<string, unknown> | null;
  initialize: () => Promise<MediaCommandResult>;
  _handleTrackAdded: (
    payload: Record<string, unknown>,
    event: import("./native-cloudflare.ts").NativeCloudflareEvent,
  ) => boolean;
  reannounceLocalPublications: (options: {
    connectionEpoch: number;
  }) => MediaCommandResult;
}
