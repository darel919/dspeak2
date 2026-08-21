import type { OwnedErrorValue } from "./shared-utilities.ts";

import type { MediaCommandResult } from "./boundary.ts";

import type { types as MediasoupTypes } from "mediasoup-client";

export type MediasoupTransportDirection = "send" | "recv";
export type MediasoupMediaProfile = "audio" | "video" | "mixed";
export type MediasoupTransportState =
  "new" | "connecting" | "connected" | "disconnected" | "failed" | "closed";

export interface MediasoupPendingRequest {
  resolve: (value?: MediaCommandResult) => void;
  reject: (error: OwnedErrorValue) => void;
}

export interface MediasoupConsumerLike {
  id: string;
  track: MediaStreamTrack;
  receiver?: {
    jitterBufferMinimumDelay?: number;
    jitterBufferTarget?: number;
  };
  getStats: () => Promise<MediaCommandResult>;
  on<K extends keyof MediasoupTypes.ConsumerEvents & string>(
    event: K,
    callback: (...args: MediasoupTypes.ConsumerEvents[K]) => MediaCommandResult,
  ): MediaCommandResult;
  close: () => MediaCommandResult;
}

export interface MediasoupProducerLike {
  id: string;
  track?: MediaStreamTrack | null;
  paused?: boolean;
  getStats: () => Promise<MediaCommandResult>;
  replaceTrack: (options: {
    track: MediaStreamTrack;
  }) => Promise<MediaCommandResult>;
  setRtpEncodingParameters: (
    parameters: Record<string, unknown>,
  ) => Promise<MediaCommandResult>;
  resume: () => MediaCommandResult;
  pause: () => MediaCommandResult;
  on<K extends keyof MediasoupTypes.ProducerEvents & string>(
    event: K,
    callback: (...args: MediasoupTypes.ProducerEvents[K]) => MediaCommandResult,
  ): MediaCommandResult;
  close: () => MediaCommandResult;
}

export interface MediasoupConsumerEntry {
  key?: string;
  producerId: string;
  userId?: string | number | null;
  source: string;
  ownerSource?: string | null;
  provider?: string;
  connectionEpoch?: number;
  sourceGeneration?: number;
  consumerId?: string;
  receiverIncarnationId?: string;
  logicalStreamId?: string | null;
  variantId?: string | null;
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
  on<K extends keyof MediasoupTypes.TransportEvents & string>(
    event: K,
    callback: (
      ...args: MediasoupTypes.TransportEvents[K]
    ) => MediaCommandResult,
  ): MediaCommandResult;
  getStats?: () => Promise<MediaCommandResult>;
  close: () => MediaCommandResult;
  consume(options: Record<string, unknown>): Promise<MediasoupConsumerLike>;
  produce(options: Record<string, unknown>): Promise<MediasoupProducerLike>;
  restartIce(options: { iceParameters: unknown }): Promise<MediaCommandResult>;
}

export interface MediasoupDeviceLike {
  loaded?: boolean;
  rtpCapabilities: MediasoupTypes.RtpCapabilities;
  load(options: {
    routerRtpCapabilities: MediasoupTypes.RtpCapabilities;
  }): Promise<void>;
  createSendTransport(options: Record<string, unknown>): MediasoupTransportLike;
  createRecvTransport(options: Record<string, unknown>): MediasoupTransportLike;
}

export interface MediasoupClientSessionLike {
  provider?: string;
  providerId?: string | null;
  send: (message: Record<string, unknown>) => MediaCommandResult;
  iceServers: unknown[];
  onRemoteTrack?: (entry: MediasoupConsumerEntry) => MediaCommandResult;
  onRemoteTrackEnded?: (entry: MediasoupConsumerEntry) => MediaCommandResult;
  onStateChange?: (
    kind: string,
    state: string,
    details: Record<string, unknown>,
  ) => MediaCommandResult;
  getAudioBitrate?: (source: string) => number | null;
  getVideoSettings?: (source: string) => Record<string, unknown>;
  getAudioStereo?: (source: string) => boolean;
  sendTransport: MediasoupTransportLike | null;
  recvTransport: MediasoupTransportLike | null;
  device: MediasoupDeviceLike | null;
  sources: Map<string, MediasoupSourceEntry>;
  producers: Map<string, MediasoupProducerEntry>;
  sourcePublications: Map<string, Promise<MediaCommandResult>>;
  sourceOperations: Map<string, Promise<MediaCommandResult>>;
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
  recoveryOperations: Map<
    MediasoupTransportDirection,
    Promise<MediaCommandResult>
  >;
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
  readyReject?: ((error: OwnedErrorValue) => void) | null;
  readyPromise?: Promise<MediaCommandResult> | null;
  readyResolve?: ((value?: MediaCommandResult) => void) | null;
  lastReceivedConsumerParams?: unknown;
  initializationRequestId?: string | null;
  initializationTimer: ReturnType<typeof setTimeout> | null;
  requestId: (operation: string) => string;
  waitForPending: (
    requestId: string,
    label: string,
    timeoutMs?: number,
  ) => Promise<MediaCommandResult>;
  sendOrThrow: (message: Record<string, unknown>, label: string) => void;
  resetReadiness: () => void;
  closeMedia: () => MediaCommandResult;
  stats: () => Promise<MediaCommandResult>;
  diagnosticStats: () => Promise<MediaCommandResult>;
  applyJitterBufferConfig: (
    entry: MediasoupConsumerEntry,
  ) => MediaCommandResult;
  setJitterBufferConfig: (config: {
    minDelayMs?: number;
    targetDelayMs?: number;
  }) => MediaCommandResult;
  publish: (entry: MediasoupSourceEntry) => Promise<MediaCommandResult>;
  publishSource: (entry: MediasoupSourceEntry) => Promise<MediaCommandResult>;
  enqueueSourceOperation: (
    source: string,
    operation: () => Promise<MediaCommandResult>,
  ) => Promise<MediaCommandResult>;
  addSourceInternal: (
    entry: MediasoupSourceEntry,
  ) => Promise<MediaCommandResult>;
  setSourceTransmission: (
    source: string,
    enabled?: boolean,
  ) => Promise<MediaCommandResult>;
  removeSourceInternal: (source: string) => Promise<MediaCommandResult>;
  connectionState: () => Record<string, unknown>;
  handleTransportRecovery: (
    direction: MediasoupTransportDirection,
    state: MediasoupTransportState,
  ) => MediaCommandResult;
  restartTransportIce: (
    direction: MediasoupTransportDirection,
  ) => Promise<MediaCommandResult>;
  shouldReceive: (
    userId: string | number | null | undefined,
    source: string,
    ownerSource?: string | null,
  ) => boolean;
  requestConsumer: (producerId: string) => MediaCommandResult;
  setConsumerReceiving: (
    entry: MediasoupConsumerEntry,
    receiving: boolean,
  ) => Promise<boolean>;
  closeConsumerByProducer: (producerId: string) => MediaCommandResult;
  onError?: (error: OwnedErrorValue) => MediaCommandResult;
  sourceTransmission: Map<string, boolean>;
}

export interface MediasoupSessionOptions {
  send: (message: Record<string, unknown>) => MediaCommandResult;
  iceServers: unknown[];
  mediaProfile?: MediasoupMediaProfile;
  onRemoteTrack?: (entry: MediasoupConsumerEntry) => MediaCommandResult;
  onRemoteTrackEnded?: (entry: MediasoupConsumerEntry) => MediaCommandResult;
  onStateChange?: (
    kind: string,
    state: string,
    details: Record<string, unknown>,
  ) => MediaCommandResult;
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
  connectionEpoch?: number;
  generation?: number;
  sourceGeneration?: number;
  logicalStreamId?: string | null;
  variantId?: string | null;
  kind?: string;
  rtpParameters?: unknown;
  appData?: Record<string, unknown>;
  dtlsParameters?: unknown;
  iceCandidates?: unknown;
}
