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
}
export interface CloudflareSubscriptionBatchOptions {
  isStale?: (phase: CloudflareSubscriptionGuardPhase) => boolean;
  onTrackBound?: (binding: CloudflareRemoteTrackBinding) => void;
  compensateStale?: (
    bindings: CloudflareRemoteTrackBinding[],
  ) => Promise<unknown>;
}
export interface CloudflarePeerConnectionLike {
  iceGatheringState?: string;
  localDescription?: { type?: string; sdp?: string | null } | null;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
  getStats?: (track?: MediaStreamTrack) => Promise<unknown>;
}
export interface DeferredPromise<T> extends Promise<T> {
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}
export interface CloudflareSessionOptions {
  send: (message: Record<string, unknown>) => boolean;
  iceServers: RTCIceServer[];
  onRemoteTrack: (entry: CloudflarePublication) => unknown;
  onRemoteTrackEnded: (
    entry: CloudflarePublication | CloudflareConsumerEntry,
  ) => unknown;
  onStateChange: (
    direction: string,
    state: string,
    summary: Record<string, unknown>,
  ) => unknown;
  getVideoSettings: (source: string) => Record<string, unknown>;
  getControlConnectionEpoch?: () => number;
}

export interface CloudflareSessionLike extends CloudflareSessionOptions {
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
  rtpSamples: Map<string, { bytes: number; timestamp: number }>;
  subscriptionTasks: Map<string, Promise<unknown>>;
  subscribedTrackNames: Set<string>;
  subscriptionsStarted: boolean;
  negotiationQueue: Promise<unknown>;
  sourceOperations: Map<string, Promise<unknown>>;
  sessionGeneration: number;
  connectionEpoch: number;
  controlConnectionEpoch: number;
  getControlConnectionEpoch: () => number;
  localPeerId: string | null;
  lastSentClientRtpCapabilities: unknown;
  lastReceivedConsumerParams: CloudflareRequestResult | null;
  connectionState: () => Record<string, unknown>;
  getMetrics: () => Promise<unknown>;
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
    body?: unknown,
  ) => Promise<CloudflareRequestResult>;
  initialize: () => Promise<void>;
  closeMedia: () => void;
  enqueueNegotiation: (operation: () => Promise<unknown>) => Promise<unknown>;
  enqueueSourceOperation: (
    source: string,
    operation: () => Promise<unknown>,
  ) => Promise<unknown>;
  addSourceInternal: (entry: CloudflareSourceInput) => Promise<void>;
  subscribe: (
    publication: CloudflarePublication,
    generation?: number,
  ) => Promise<unknown>;
  subscribePublicationBatch: (
    publications: CloudflarePublication[],
    generation: number,
    options?: CloudflareSubscriptionBatchOptions,
  ) => Promise<unknown>;
  subscribePublications: (
    publications: CloudflarePublication[],
    generation?: number,
  ) => Promise<unknown>;
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
  ) => Promise<unknown>;
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
  ) => Promise<unknown>;
  reconcilePublicationsOnce?: (
    publications: CloudflarePublication[],
    isStale: () => boolean,
  ) => Promise<unknown>;
}
