import type { OwnedErrorValue } from "./shared-utilities.ts";
import type { ExternalObject } from "./boundary.ts";

import type { MediaCommandResult } from "./boundary.ts";

export interface CloudflarePublication extends Record<string, unknown> {
  trackName?: string;
  peerId?: string;
  userId?: string;
  sessionId?: string;
  source?: string;
  ownerSource?: string | null;
  closed?: boolean;
  generation?: number;
  connectionEpoch?: number;
}
export interface CloudflareSourceEntry extends Record<string, unknown> {
  source: string;
  track: MediaStreamTrack;
  sender: RTCRtpSender;
  producer?: RTCRtpSender;
  trackName: string;
  mid: string;
  ownerSource?: string | null;
  generation: number;
  canonicalConnectionEpoch?: number;
}
export interface CloudflareSourceInput extends Record<string, unknown> {
  source: string;
  track: MediaStreamTrack;
  stream?: MediaStream;
  ownerSource?: string | null;
  audioBitrate?: number;
  audioStereo?: boolean;
  generation: number;
}
export interface CloudflareSourceRequest extends Record<string, unknown> {
  source: string;
  track: MediaStreamTrack;
  stream?: MediaStream;
  ownerSource?: string | null;
  audioBitrate?: number;
  audioStereo?: boolean;
  generation?: number;
}
export interface CloudflareConsumerEntry extends Record<string, unknown> {
  track: MediaStreamTrack;
  receiver?: RTCRtpReceiver;
  trackName: string;
  mid?: string | null;
  receiverIncarnationId?: string;
  source?: string;
  userId?: string;
  receiving?: boolean;
}
export interface CloudflareRequestResult extends Record<string, unknown> {
  sessionId?: string;
  sessionDescription?: RTCSessionDescriptionInit;
  tracks?: Array<{ trackName?: string; mid?: string | number }>;
}
export interface CloudflareTrackEvent {
  track: MediaStreamTrack;
  streams?: readonly MediaStream[];
  transceiver?: RTCRtpTransceiver;
  receiver?: RTCRtpReceiver;
}
export type CloudflareSubscriptionGuardPhase = "before-bind" | "after-bind";
export interface CloudflareRemoteTrackBinding {
  trackName: string;
  mid: string;
  publication: CloudflarePublication;
  consumer?: CloudflareConsumerEntry;
}
export interface CloudflareCompensationOwner {
  token: symbol;
  transceiver: RTCRtpTransceiver;
  previousDirection: RTCRtpTransceiverDirection | null;
}
export interface CloudflareSubscriptionBatchOptions {
  isStale?: (phase: CloudflareSubscriptionGuardPhase) => boolean;
  onTrackBound?: (binding: CloudflareRemoteTrackBinding) => void;
  compensateStale?: (
    bindings: CloudflareRemoteTrackBinding[],
  ) => Promise<MediaCommandResult>;
}
export interface CloudflarePeerConnectionLike {
  iceGatheringState?: string;
  localDescription?: { type?: string; sdp?: string | null } | null;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
  getStats?: (track?: MediaStreamTrack) => Promise<MediaCommandResult>;
}
export interface DeferredPromise<T> extends Promise<T> {
  resolve: (value: T) => void;
  reject: (error: OwnedErrorValue) => void;
  requestGeneration?: number;
}
export interface CloudflareSessionOptions {
  send: (message: Record<string, unknown>) => boolean;
  iceServers: RTCIceServer[];
  onRemoteTrack: (entry: CloudflareConsumerEntry) => MediaCommandResult;
  onRemoteTrackEnded: (
    entry: CloudflarePublication | CloudflareConsumerEntry,
  ) => MediaCommandResult;
  onStateChange: (
    direction: string,
    state: string,
    summary: Record<string, unknown>,
  ) => MediaCommandResult;
  getVideoSettings: (source: string) => Record<string, unknown>;
  getControlConnectionEpoch?: () => number;
  getDeafened?: () => boolean;
}

export interface CloudflareSessionLike extends CloudflareSessionOptions {
  [key: string]: unknown;
  provider?: string;
  providerId?: string | null;
  peerConnection: RTCPeerConnection | null;
  sessionId: string | null;
  initializing: Promise<void> | null;
  pending: Map<string, DeferredPromise<CloudflareRequestResult>>;
  producers: Map<string, CloudflareSourceEntry>;
  consumers: Map<string, CloudflareConsumerEntry>;
  sourceTransmission: Map<string, boolean>;
  remoteReceiving: Map<string, boolean>;
  publications: Map<string, CloudflarePublication>;
  remoteByMid: Map<string, CloudflarePublication>;
  pendingRemoteTracks: Map<string, CloudflareTrackEvent[]>;
  remoteCompensationOwners: Map<string, CloudflareCompensationOwner>;
  rtpSamples: Map<string, { bytes: number; timestamp: number }>;
  subscriptionTasks: Map<string, Promise<MediaCommandResult>>;
  subscribedTrackNames: Set<string>;
  desiredRemoteSources?: Map<string, boolean>;
  subscriptionsStarted: boolean;
  negotiationQueue: Promise<MediaCommandResult>;
  sourceOperations: Map<string, Promise<MediaCommandResult>>;
  sessionGeneration: number;
  connectionEpoch: number;
  controlConnectionEpoch: number;
  jitterBufferMinimumDelay: number;
  jitterBufferTargetDelay: number;
  getControlConnectionEpoch: () => number;
  localPeerId: string | null;
  lastSentClientRtpCapabilities: unknown;
  lastReceivedConsumerParams: CloudflareRequestResult | null;
  connectionState: () => {
    ready: boolean;
    sendRequired: boolean;
    receiveRequired: boolean;
    send: string;
    recv: string;
    [key: string]: unknown;
  };
  getMetrics: () => Promise<MediaCommandResult>;
  currentSession: () => {
    generation: number;
    peerConnection: RTCPeerConnection;
  };
  assertCurrentSession: (
    peerConnection: RTCPeerConnection,
    generation: number,
  ) => void;
  request: (
    operation: string,
    body?: ExternalObject,
  ) => Promise<CloudflareRequestResult>;
  initialize: () => Promise<void>;
  closeMedia: () => void;
  addSource: (entry: CloudflareSourceRequest) => Promise<MediaCommandResult>;
  handle: (
    type: string,
    data: Record<string, unknown>,
  ) => Promise<MediaCommandResult>;
  setJitterBufferConfig: (config?: {
    minDelayMs?: number;
    targetDelayMs?: number;
  }) => MediaCommandResult;
  enqueueNegotiation: (
    operation: () => Promise<MediaCommandResult>,
  ) => Promise<MediaCommandResult>;
  enqueueSourceOperation: (
    source: string,
    operation: () => Promise<MediaCommandResult>,
  ) => Promise<MediaCommandResult>;
  addSourceInternal: (entry: CloudflareSourceInput) => Promise<void>;
  subscribe: (
    publication: CloudflarePublication,
    generation?: number,
  ) => Promise<MediaCommandResult>;
  subscribePublicationBatch: (
    publications: CloudflarePublication[],
    generation: number,
    options?: CloudflareSubscriptionBatchOptions,
  ) => Promise<MediaCommandResult>;
  subscribePublications: (
    publications: CloudflarePublication[],
    generation?: number,
  ) => Promise<MediaCommandResult>;
  recoverRemotePublication: (
    trackName: string,
    expectedReceiverIncarnation?: string,
    generation?: number,
  ) => Promise<boolean>;
  closePulledRemoteTracksSafely: (
    bindings: CloudflareRemoteTrackBinding[],
    peerConnection: RTCPeerConnection,
    generation: number,
    expectedConsumer?: CloudflareConsumerEntry,
  ) => Promise<boolean>;
  removeSourceInternal: (source: string) => Promise<void>;
  setRemoteReceiving: (
    userIdOrKey: string,
    sourceOrReceiving: string | boolean,
    receivingValue?: boolean,
  ) => Promise<boolean>;
  handleRemoteTrack: (
    event: CloudflareTrackEvent,
    publication: CloudflarePublication,
  ) => void;
  queueRemoteTrack: (mid: string, event: CloudflareTrackEvent) => void;
  shouldReceive: (
    userId: string | undefined,
    source: string,
    ownerSource?: string | null,
  ) => boolean;
  setSourceTransmission: (source: string, enabled: boolean) => Promise<boolean>;
  configureVideoSender: (
    sender: RTCRtpSender,
    entry: CloudflareSourceInput,
  ) => Promise<MediaCommandResult>;
  updateSenderParameters: (
    entry: CloudflareSourceEntry,
    updates: Record<string, unknown>,
  ) => Promise<boolean>;
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
}
