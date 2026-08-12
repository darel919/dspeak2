export type MediasoupTransportDirection = "send" | "recv";
export type MediasoupTransportState =
  "new" | "connecting" | "connected" | "disconnected" | "failed" | "closed";

export interface MediasoupPendingRequest {
  resolve: (value?: unknown) => void;
  reject: (error: unknown) => void;
}

export interface MediasoupConsumerLike {
  id: string;
  track: MediaStreamTrack;
  receiver?: {
    jitterBufferMinimumDelay?: number;
    jitterBufferTarget?: number;
  };
  getStats: () => Promise<unknown>;
  on: (event: string, callback: () => void) => unknown;
  close: () => unknown;
}

export interface MediasoupProducerLike {
  id: string;
  track?: MediaStreamTrack;
  paused?: boolean;
  getStats: () => Promise<unknown>;
  replaceTrack: (options: { track: MediaStreamTrack }) => Promise<unknown>;
  setRtpEncodingParameters: (
    parameters: Record<string, unknown>,
  ) => Promise<unknown>;
  resume: () => unknown;
  pause: () => unknown;
  on: (event: string, callback: () => void) => unknown;
  close: () => unknown;
}

export interface MediasoupConsumerEntry {
  key?: string;
  producerId: string;
  userId?: string | number | null;
  source: string;
  ownerSource?: string | null;
  provider?: string;
  consumer: MediasoupConsumerLike;
  track: MediaStreamTrack;
  stream: MediaStream;
  mid?: string | null;
  receiving: boolean;
  desiredReceiving?: boolean;
  receivingRevision?: number;
  close: () => void;
}

export interface MediasoupProducerEntry {
  producer: MediasoupProducerLike;
  track: MediaStreamTrack;
  source: string;
  mid?: string | null;
}

export interface MediasoupSourceEntry {
  source: string;
  track: MediaStreamTrack;
  stream?: MediaStream;
  ownerSource?: string | null;
  captureSelection?: {
    audio?: { maxBitrateBps?: number };
    [key: string]: unknown;
  } | null;
  roomBitrateBps?: number | null;
}

export interface MediasoupTransportLike {
  id: string;
  closed?: boolean;
  on: (event: string, callback: (...args: never[]) => unknown) => unknown;
  close: () => unknown;
  consume: (options: Record<string, unknown>) => Promise<MediasoupConsumerLike>;
  produce: (options: Record<string, unknown>) => Promise<MediasoupProducerLike>;
  restartIce: (options: { iceParameters: unknown }) => Promise<unknown>;
  _handler?: { _pc?: RTCPeerConnection };
}

export interface MediasoupDeviceLike {
  loaded?: boolean;
  rtpCapabilities: unknown;
  load: (options: { routerRtpCapabilities: unknown }) => Promise<unknown>;
  createSendTransport: (
    options: Record<string, unknown>,
  ) => MediasoupTransportLike;
  createRecvTransport: (
    options: Record<string, unknown>,
  ) => MediasoupTransportLike;
}

export interface MediasoupClientSessionLike {
  send: (message: Record<string, unknown>) => unknown;
  iceServers: unknown[];
  onRemoteTrack?: (entry: MediasoupConsumerEntry) => unknown;
  onRemoteTrackEnded?: (entry: MediasoupConsumerEntry) => unknown;
  onStateChange?: (
    kind: string,
    state: string,
    details: Record<string, unknown>,
  ) => unknown;
  getAudioBitrate?: (source: string) => number | null;
  getVideoSettings?: (source: string) => Record<string, unknown>;
  getAudioStereo?: (source: string) => boolean;
  sendTransport: MediasoupTransportLike | null;
  recvTransport: MediasoupTransportLike | null;
  device: MediasoupDeviceLike | null;
  sources: Map<string, MediasoupSourceEntry>;
  producers: Map<string, MediasoupProducerEntry>;
  sourcePublications: Map<string, Promise<unknown>>;
  sourceOperations: Map<string, Promise<unknown>>;
  consumers: Map<string, MediasoupConsumerEntry>;
  pending: Map<string, MediasoupPendingRequest>;
  pendingProduce: Map<string, MediasoupPendingRequest>;
  pendingConsumers: Set<string>;
  requestedConsumers: Set<string>;
  consumerRetryAttempts: Map<string, number>;
  consumerRetryTimers: Map<string, ReturnType<typeof setTimeout>>;
  recoveryTimers: Map<
    MediasoupTransportDirection,
    ReturnType<typeof setTimeout>
  >;
  recoveryAttempts: Map<MediasoupTransportDirection, number>;
  recoveryOperations: Map<MediasoupTransportDirection, Promise<unknown>>;
  transportStates: Map<MediasoupTransportDirection, MediasoupTransportState>;
  transportRequestIds: Map<MediasoupTransportDirection, string>;
  rtpSamples: Map<string, { bytes: number; timestamp: number }>;
  remoteReceiving: Map<string, boolean>;
  sourceGenerations?: Map<string, number>;
  mediaRevision: number;
  closed: boolean;
  requestTimeoutMs: number;
  consumerControlTimeoutMs: number;
  consumerRetryDelayMs: number;
  recoveryTimeoutMs: number;
  jitterBufferTargetDelay: number;
  jitterBufferMinimumDelay: number;
  readyReject?: ((error: unknown) => void) | null;
  readyPromise?: Promise<unknown> | null;
  readyResolve?: ((value?: unknown) => void) | null;
  lastReceivedConsumerParams?: unknown;
  initializationRequestId?: string | null;
  initializationTimer: ReturnType<typeof setTimeout> | null;
  requestId: (operation: string) => string;
  waitForPending: (
    requestId: string,
    label: string,
    timeoutMs?: number,
  ) => Promise<Record<string, unknown>>;
  sendOrThrow: (message: Record<string, unknown>, label: string) => void;
  resetReadiness: () => void;
  closeMedia: () => unknown;
  applyJitterBufferConfig: (entry: MediasoupConsumerEntry) => unknown;
  setJitterBufferConfig: (config: {
    minDelayMs?: number;
    targetDelayMs?: number;
  }) => unknown;
  publish: (entry: MediasoupSourceEntry) => Promise<unknown>;
  publishSource: (entry: MediasoupSourceEntry) => Promise<unknown>;
  enqueueSourceOperation: (
    source: string,
    operation: () => Promise<unknown>,
  ) => Promise<unknown>;
  addSourceInternal: (entry: MediasoupSourceEntry) => Promise<unknown>;
  setSourceTransmission: (
    source: string,
    enabled?: boolean,
  ) => Promise<unknown>;
  removeSourceInternal: (source: string) => Promise<unknown>;
  connectionState: () => Record<string, unknown>;
  handleTransportRecovery: (
    direction: MediasoupTransportDirection,
    state: MediasoupTransportState,
  ) => unknown;
  restartTransportIce: (
    direction: MediasoupTransportDirection,
  ) => Promise<unknown>;
  shouldReceive: (
    userId: string | number | null | undefined,
    source: string,
    ownerSource?: string | null,
  ) => boolean;
  requestConsumer: (producerId: string) => unknown;
  setConsumerReceiving: (
    entry: MediasoupConsumerEntry,
    receiving: boolean,
  ) => Promise<boolean>;
  closeConsumerByProducer: (producerId: string) => unknown;
  onError?: (error: unknown) => unknown;
  sourceTransmission: Map<string, boolean>;
}

export interface MediasoupSessionOptions {
  send: (message: Record<string, unknown>) => unknown;
  iceServers: unknown[];
  onRemoteTrack?: (entry: MediasoupConsumerEntry) => unknown;
  onRemoteTrackEnded?: (entry: MediasoupConsumerEntry) => unknown;
  onStateChange?: (
    kind: string,
    state: string,
    details: Record<string, unknown>,
  ) => unknown;
  getAudioBitrate?: (source: string) => number | null;
  getVideoSettings?: (source: string) => Record<string, unknown>;
  getAudioStereo?: (source: string) => boolean;
  requestTimeoutMs?: number;
  consumerControlTimeoutMs?: number;
  recoveryTimeoutMs?: number;
  consumerRetryDelayMs?: number;
}

export interface MediasoupMessage extends Record<string, unknown> {
  requestId?: string;
  direction?: MediasoupTransportDirection;
  id?: string;
  producerId?: string;
  consumerId?: string;
  requestType?: string;
  state?: string;
  consumerClosed?: boolean;
  iceParameters?: unknown;
  producers?: string[];
  message?: string;
  error?: string;
  userId?: string | number | null;
  source?: string;
  ownerSource?: string | null;
  kind?: string;
  rtpParameters?: unknown;
  appData?: Record<string, unknown>;
  dtlsParameters?: unknown;
  iceCandidates?: unknown;
}
