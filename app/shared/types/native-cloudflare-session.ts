export interface NativeCloudflareSessionOptions {
  invoke: NativeCloudflareSessionSurface["invoke"];
  send?: NativeCloudflareSessionSurface["send"];
  onRemoteTrack?: NativeCloudflareSessionSurface["onRemoteTrack"];
  onRemoteTrackEnded?: NativeCloudflareSessionSurface["onRemoteTrackEnded"];
  onStateChange?: NativeCloudflareSessionSurface["onStateChange"];
  onError?: NativeCloudflareSessionSurface["onError"];
  getAudioBitrate?: NativeCloudflareSessionSurface["getAudioBitrate"];
  getAudioStereo?: NativeCloudflareSessionSurface["getAudioStereo"];
  getVideoSettings?: NativeCloudflareSessionSurface["getVideoSettings"];
  requestTimeoutMs?: number;
  sources?: NativeCloudflareSessionSurface["sources"];
  producers?: NativeCloudflareSessionSurface["producers"];
  consumers?: NativeCloudflareSessionSurface["consumers"];
  sourceTransmission?: NativeCloudflareSessionSurface["sourceTransmission"];
  remoteReceiving?: NativeCloudflareSessionSurface["remoteReceiving"];
  localVideoFeeds?: NativeCloudflareSessionSurface["localVideoFeeds"];
  remoteVideoFeeds?: NativeCloudflareSessionSurface["remoteVideoFeeds"];
  remoteAudioFeeds?: NativeCloudflareSessionSurface["remoteAudioFeeds"];
}

export interface NativeCloudflareSessionSurface {
  invoke: (
    operation: string,
    payload?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  send?: (message: unknown) => unknown;
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
  sources: Map<string, Record<string, unknown>>;
  producers: Map<string, Record<string, unknown>>;
  consumers: Map<string, Record<string, unknown>>;
  sourceTransmission: Map<string, boolean>;
  remoteReceiving: Map<string, boolean>;
  localVideoFeeds: Map<string, Record<string, unknown>>;
  remoteVideoFeeds: Map<string, Record<string, unknown>>;
  remoteAudioFeeds: Map<string, Record<string, unknown>>;
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
  _assertCurrent: (generation: number, handle?: string | number | null) => void;
  _emitState: () => unknown;
  closeMedia: () => unknown;
  removeSource: (source: string) => unknown;
  setSourceTransmission: (source: string, enabled: boolean) => unknown;
  updateAudioBitrate: (source: string, bitrate: number) => unknown;
  updateVideoBitrate: (source: string, bitrate: number) => unknown;
  updateVideoParameters: (
    source: string,
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
  subscribe: (
    publication: import("./native-cloudflare.ts").NativeCloudflarePublication,
    generation?: number,
  ) => Promise<unknown>;
  _closeConsumer: (entry: Record<string, unknown>) => unknown;
  request: (operation: string, body?: unknown) => Promise<unknown>;
  enqueueNegotiation: (operation: () => Promise<unknown>) => Promise<unknown>;
  applyJitterBufferConfig: (entry: Record<string, unknown>) => unknown;
  initialize: () => Promise<unknown>;
  _handleTrackAdded: (
    payload: Record<string, unknown>,
    event: import("./native-cloudflare.ts").NativeCloudflareEvent,
  ) => unknown;
}
