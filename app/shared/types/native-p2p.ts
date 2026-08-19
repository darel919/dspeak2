import type {
  ParticipantMediaCapabilities,
  VideoCodecName,
} from "./video-codec-capabilities.ts";

export interface NativeP2pFlowEntry {
  key: string;
  bytes: number;
  flowing: boolean;
}

export interface NativeP2pRemoteTrackEntry extends Record<string, unknown> {
  key: string;
  peerId: string;
  userId: string;
  source: string;
  ownerSource?: string | null;
  track: MediaStreamTrack;
  stream?: MediaStream;
}

export interface NativeP2pLocalSourceEntry {
  track: MediaStreamTrack;
  stream?: MediaStream;
  ownerSource?: string | null;
  generation?: number;
}

export interface NativeP2pConnectionState {
  peerId: string;
  userId: string;
  pc: RTCPeerConnection;
  channel: RTCDataChannel | null;
  healthReceived: number;
  lastHealthAt: number;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
  restarted: boolean;
  selectedPair: Record<string, unknown> | null;
  sourceReceiving: Map<string, boolean>;
  remoteReceiving: Map<string, boolean>;
  senders: Map<string, RTCRtpSender>;
  remoteSourceNames: Set<string>;
  expectedRemoteSources: number;
  mediaReady: boolean;
  lastOutboundBytes: number | null;
  lastInboundBytes: number | null;
  lastOutboundProgressAt: number;
  lastInboundProgressAt: number;
  lastOutboundSourceProgressAt: Map<string, number>;
  lastInboundSourceProgressAt: Map<string, number>;
  lastOutboundSourceBytes: Map<string, number>;
  lastInboundSourceBytes: Map<string, number>;
  signalingOperation: Promise<unknown> | null;
  signalingPhase: string | null;
  negotiationRequested: boolean;
  negotiationTimer: ReturnType<typeof setTimeout> | null;
  makingOffer: boolean;
  remoteTracks: Map<string, NativeP2pRemoteTrackEntry>;
  retiredRemoteTracks: Map<string, NativeP2pRemoteTrackEntry>;
  signalingStep: string | null;
  settingRemoteAnswer: boolean;
  polite: boolean;
  ignoreOffer: boolean;
  mediaCapabilities?: ParticipantMediaCapabilities | null;
  remoteMediaCapabilities?: ParticipantMediaCapabilities | null;
  selectedCodec?: VideoCodecName | null;
  capabilitiesSent?: boolean;
  capabilityWaitTimer?: ReturnType<typeof setTimeout> | null;
  candidates: RTCIceCandidateInit[];
  remoteDescription: RTCSessionDescription | null;
  closed: boolean;
  audioReceivers: Map<string, RTCRtpReceiver>;
}

export interface NativeP2pHealthMesh {
  mode: string;
  readyReported: boolean;
  healthRunToken: number;
  healthCheckRunning: boolean;
  healthInterval: ReturnType<typeof setInterval> | null;
  qualificationTimeout: ReturnType<typeof setTimeout> | null;
  connections: Map<string, NativeP2pConnectionState>;
  localSources: Map<string, NativeP2pLocalSourceEntry>;
  sourceTransmission: Map<string, boolean>;
  epoch: number;
  fail: (reason: string, error?: unknown) => unknown;
  emitSnapshot: () => unknown;
  sendControl: (data: Record<string, unknown>) => boolean;
}

export interface NativeP2pMeshOptions {
  iceServers: unknown[];
  sendSignal: (payload: Record<string, unknown>) => unknown;
  onRemoteTrack: (entry: Record<string, unknown>) => unknown;
  onRemoteTrackEnded: (entry: Record<string, unknown>) => unknown;
  onFailure: (reason: string, error?: unknown) => unknown;
  onSnapshot: (snapshot: unknown) => unknown;
  getSenderOptions: (
    source: string,
    track: MediaStreamTrack,
  ) => Record<string, unknown> | null;
  getAudioStereo: (source: string) => boolean;
  mediaCapabilities?: ParticipantMediaCapabilities | null;
  getControlConnectionEpoch: () => number;
}

export interface NativeP2pSignalingMesh {
  connections: Map<string, NativeP2pConnectionState>;
  pendingSignals: Map<number, Array<Record<string, unknown>>>;
  pendingSignalLimit: number;
  sendSignal: (payload: Record<string, unknown>) => unknown;
  mode: string;
  epoch: number;
  localPeerId: string | null;
  mediaCapabilities: ParticipantMediaCapabilities | null;
  fail: (reason: string, error?: unknown) => unknown;
  emitSnapshot: () => unknown;
  sendControl: (data: Record<string, unknown>) => boolean;
  remoteSources: Map<string, string>;
  remoteSourceOwners: Map<string, string | null>;
  remoteSourceGenerations?: Map<string, number>;
  onRemoteTrack: (entry: Record<string, unknown>) => unknown;
  onRemoteTrackEnded: (entry: Record<string, unknown>) => unknown;
  queuePendingSignal: (data: Record<string, unknown>) => boolean;
  usesStereoAudio: () => boolean;
  configureStateSenders: (state: NativeP2pConnectionState) => Promise<unknown>;
  setSenderReceiving: (
    state: NativeP2pConnectionState,
    source: string,
    receiving: boolean,
  ) => Promise<unknown>;
  getControlConnectionEpoch: () => number;
}

export interface NativeP2pMeshSurface
  extends NativeP2pHealthMesh, NativeP2pSignalingMesh {
  configuration: RTCConfiguration;
  localSources: Map<string, NativeP2pLocalSourceEntry>;
  remoteSourceOwners: Map<string, string | null>;
  localPeerId: string | null;
  readyReported: boolean;
  failureReportedKey: string | null;
  senderOperations: WeakMap<RTCRtpSender, Promise<unknown>>;
  trackOperations: WeakMap<RTCRtpSender, Promise<unknown>>;
  sourceOperations: Map<string, Promise<unknown>>;
  qualificationTimeout: ReturnType<typeof setTimeout> | null;
  healthInterval: ReturnType<typeof setInterval> | null;
  jitterBufferMinimumDelay: number;
  jitterBufferTargetDelay: number;
  getSenderOptions: (
    source: string,
    track: MediaStreamTrack,
  ) => Record<string, unknown> | null;
  getAudioStereo: (source: string) => boolean;
  mediaCapabilities: ParticipantMediaCapabilities | null;
  onFailure: (reason: string, error?: unknown) => unknown;
  onSnapshot: (snapshot: unknown) => unknown;
  closeConnection: (peerId: string) => void;
  closeAll: () => void;
  startQualificationTimeout: () => void;
  startHealthChecks: () => void;
  stopHealthChecks: () => void;
  checkQualification: () => void;
  flushPendingSignals: () => Promise<unknown>;
  ensureConnection: (
    peerId: string,
    userId: string | number | null,
  ) => NativeP2pConnectionState;
  resynchronizeEpoch: (peerIds?: Set<string> | null) => void;
  attachSource: (
    state: NativeP2pConnectionState,
    source: string,
    entry: NativeP2pLocalSourceEntry,
  ) => Promise<RTCRtpSender>;
  signal: (
    targetPeerId: string,
    signalPayload: Record<string, unknown>,
  ) => boolean;
  enqueuePeerSignaling: (
    state: NativeP2pConnectionState,
    operation: () => Promise<unknown>,
    phase?: string,
  ) => Promise<unknown>;
  schedulePeerNegotiation: (
    state: NativeP2pConnectionState,
  ) => Promise<unknown>;
  retryPeerNegotiation: (state: NativeP2pConnectionState) => void;
  receiveSignal: (payload: Record<string, unknown>) => Promise<unknown>;
  applyPeerSignal: (
    state: NativeP2pConnectionState,
    signal: Record<string, unknown>,
  ) => Promise<unknown>;
  bindHealthChannel: (
    state: NativeP2pConnectionState,
    channel: RTCDataChannel,
  ) => void;
  handleConnectionState: (state: NativeP2pConnectionState) => void;
  handleIceState: (state: NativeP2pConnectionState) => void;
  handleTrack: (state: NativeP2pConnectionState, event: RTCTrackEvent) => void;
  updateSender: (
    sender: RTCRtpSender,
    operation: () => Promise<unknown>,
  ) => Promise<unknown>;
  updateTrack: (
    sender: RTCRtpSender,
    operation: () => Promise<unknown>,
  ) => Promise<unknown>;
  setSenderActive: (
    sender: RTCRtpSender | undefined,
    active: boolean,
  ) => Promise<unknown>;
  setSenderReceiving: (
    state: NativeP2pConnectionState,
    source: string,
    receiving: boolean,
  ) => Promise<unknown>;
  configureSender: (
    sender: RTCRtpSender,
    source: string,
    track: MediaStreamTrack,
  ) => Promise<unknown>;
  getSnapshot: () => Promise<Array<Record<string, unknown>>>;
  emitSnapshot: () => void;
  applyTopology: (topology: Record<string, unknown>) => Promise<unknown>;
  publishSource: (
    source: string,
    track: MediaStreamTrack,
    stream?: MediaStream,
    metadata?: Record<string, unknown>,
  ) => Promise<unknown>;
  enqueueSourceOperation: (
    source: string,
    operation: () => Promise<unknown>,
  ) => Promise<unknown>;
  publishSourceInternal: (
    source: string,
    track: MediaStreamTrack,
    stream?: MediaStream,
    metadata?: Record<string, unknown>,
  ) => Promise<unknown>;
  unpublishSource: (source: string) => Promise<unknown>;
  unpublishSourceInternal: (source: string) => Promise<unknown>;
  setSourceTransmission: (source: string, enabled: boolean) => Promise<unknown>;
  setRemoteReceiving: (
    peerId: string | number | undefined,
    source: string,
    receiving: boolean,
  ) => unknown;
  isMediaReady: () => boolean;
  stats: () => Promise<unknown[]>;
  diagnosticStats: () => Promise<unknown[]>;
  getInboundTrackStats: (
    peerId: string | number,
    track: MediaStreamTrack,
  ) => Promise<unknown>;
  getOutboundTrackStats: (source: string) => Promise<RTCStatsReport | null>;
  getOutboundTrackParameters: (source: string) => RTCRtpSendParameters | null;
  setJitterBufferConfig: (config?: {
    minDelayMs?: number;
    targetDelayMs?: number;
  }) => unknown;
  reconfigureSource: (source: string) => Promise<unknown>;
}
