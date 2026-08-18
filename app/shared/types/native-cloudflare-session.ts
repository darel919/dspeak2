import type { CloudflarePublication } from "./cloudflare-media.ts";

export interface NativeCloudflareSessionOptions {
  invoke: NativeCloudflareSessionSurface["invoke"];
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
  ) => Promise<Record<string, unknown>>;
  send?: (message: unknown) => unknown;
  ensureControlReady?: () => Promise<unknown>;
  onRemoteTrack?: (entry: Record<string, unknown>) => unknown;
  onRemoteTrackEnded?: (entry: Record<string, unknown>) => unknown;
  onStateChange?: (...args: unknown[]) => unknown;
  onError?: (error: unknown) => unknown;
  getAudioBitrate?: (source: string) => number | null;
  getAudioStereo?: (source: string) => boolean | null;
  getVideoSettings?: (
    source: string,
  ) => import("./video-settings.ts").VideoSettings;
  requestTimeoutMs: number;
  localPeerId: string;
  sources: Map<string, Record<string, unknown>>;
  producers: Map<string, Record<string, unknown> & { kind?: string }>;
  producerVariants: Map<string, Record<string, unknown> & { kind?: string }>;
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
  publications: Map<string, Record<string, unknown>>;
  remoteByMid: Map<string, Record<string, unknown>>;
  pendingRemoteTrackEvents: Map<string, Array<Record<string, unknown>>>;
  pending: Map<
    string,
    {
      resolve: (value?: unknown) => void;
      reject: (error: unknown) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >;
  subscriptionTasks: Map<string, Promise<unknown>>;
  subscribedTrackNames: Set<string>;
  subscriptionsStarted: boolean;
  negotiationQueue: Promise<unknown>;
  sourceOperations: Map<string, Promise<unknown>>;
  rtpSamples: Map<string, { timestamp: number | null; bytes: number | null }>;
  handle: string | number | null;
  sessionId: string | null;
  initializing: Promise<unknown> | null;
  sessionGeneration: number;
  closed: boolean;
  iceState: number;
  jitterBufferMinimumDelay: number;
  jitterBufferTargetDelay: number;
  lastReceivedConsumerParams: unknown;
  controlConnectionEpoch: number;
  getControlConnectionEpoch: () => number;
  _assertCurrent: (generation: number, handle?: string | number | null) => void;
  _emitState: () => unknown;
  closeMedia: () => unknown;
  removeSource: (source: string) => unknown;
  removeVariant: (variantId: string, force?: boolean) => unknown;
  retireVariants: (
    logicalStreamId: string,
    desiredVariantIds: string[],
  ) => unknown;
  hasVariant: (variantId: string) => boolean;
  updateVariantMetadata: (
    entry: import("./native-cloudflare.ts").NativeCloudflareSourceEntry,
  ) => Promise<unknown>;
  setSourceTransmission: (source: string, enabled: boolean) => unknown;
  updateAudioBitrate: (source: string, bitrate: number) => unknown;
  updateVideoBitrate: (source: string, bitrate: number) => unknown;
  updateVideoParameters: (
    source: string,
    parameters: Record<string, unknown>,
  ) => unknown;
  updateVariantVideoParameters: (
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
  setJitterBufferConfig: (config: {
    minDelayMs?: number;
    targetDelayMs?: number;
  }) => unknown;
  handleReceiveEvent: (event: Record<string, unknown>) => boolean;
  startSubscriptions: () => Promise<unknown>;
  addSource: (
    entry: import("./native-cloudflare.ts").NativeCloudflareSourceEntry,
  ) => Promise<unknown>;
  handleMessage: (type: string, data: Record<string, unknown>) => unknown;
  reconcilePublications: (
    publications: CloudflarePublication[],
    removedPublications?: CloudflarePublication[],
  ) => Promise<unknown>;
  subscribe: (
    publication: import("./native-cloudflare.ts").NativeCloudflarePublication,
    generation?: number,
  ) => Promise<unknown>;
  _closeConsumer: (entry: Record<string, unknown>) => unknown;
  request: (operation: string, body?: unknown) => Promise<unknown>;
  enqueueNegotiation: (operation: () => Promise<unknown>) => Promise<unknown>;
  applyJitterBufferConfig: (entry: Record<string, unknown>) => unknown;
  takePendingLocalVideoFrame: (
    source: string,
  ) => Record<string, unknown> | null;
  initialize: () => Promise<unknown>;
  _handleTrackAdded: (
    payload: Record<string, unknown>,
    event: import("./native-cloudflare.ts").NativeCloudflareEvent,
  ) => unknown;
}
