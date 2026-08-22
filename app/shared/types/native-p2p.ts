import type { OwnedErrorValue } from "./shared-utilities.ts";

import type { MediaCommandResult } from "./boundary.ts";

import type { PendingSignalEntry } from "../pending-signal-queue.ts";

import type {
  ParticipantMediaCapabilities,
  VideoCodecName,
} from "./video-codec-capabilities.ts";

export type P2pIcePolicy = "direct-only" | "direct-or-relay";

export interface NativeP2pCandidateReport {
  peerId: string;
  path: "direct" | "relay";
  localCandidateType: string | null;
  remoteCandidateType: string | null;
  rttMs: number | null;
  protocol: string | null;
}

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

export type NativeP2pSnapshot = Array<Record<string, unknown>>;

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
  signalingOperation: Promise<MediaCommandResult> | null;
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
  p2pIcePolicy: "direct-only" | "direct-or-relay";
  fail: (reason: string, error?: OwnedErrorValue) => MediaCommandResult;
  emitSnapshot: () => MediaCommandResult;
  sendControl: (data: Record<string, unknown>) => boolean;
}

export interface NativeP2pMeshOptions {
  iceServers: unknown[];
  p2pIcePolicy?: P2pIcePolicy;
  sendSignal: (payload: Record<string, unknown>) => MediaCommandResult;
  onRemoteTrack: (entry: Record<string, unknown>) => MediaCommandResult;
  onRemoteTrackEnded: (entry: Record<string, unknown>) => MediaCommandResult;
  onFailure: (reason: string, error?: OwnedErrorValue) => MediaCommandResult;
  onSnapshot: (snapshot: NativeP2pSnapshot) => void;
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
  pendingSignals: Map<number, PendingSignalEntry[]>;
  pendingSignalLimit: number;
  sendSignal: (payload: Record<string, unknown>) => MediaCommandResult;
  mode: string;
  epoch: number;
  localPeerId: string | null;
  mediaCapabilities: ParticipantMediaCapabilities | null;
  fail: (reason: string, error?: OwnedErrorValue) => MediaCommandResult;
  emitSnapshot: () => MediaCommandResult;
  sendControl: (data: Record<string, unknown>) => boolean;
  remoteSources: Map<string, string>;
  remoteSourceOwners: Map<string, string | null>;
  remoteSourceGenerations: Map<string, number>;
  remoteSourceConnectionEpochs: Map<string, number>;
  onRemoteTrack: (entry: Record<string, unknown>) => MediaCommandResult;
  onRemoteTrackEnded: (entry: Record<string, unknown>) => MediaCommandResult;
  queuePendingSignal: (data: Record<string, unknown>) => boolean;
  usesStereoAudio: () => boolean;
  configureStateSenders: (
    state: NativeP2pConnectionState,
  ) => Promise<MediaCommandResult>;
  setSenderReceiving: (
    state: NativeP2pConnectionState,
    source: string,
    receiving: boolean,
  ) => Promise<MediaCommandResult>;
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
  senderOperations: WeakMap<RTCRtpSender, Promise<MediaCommandResult>>;
  trackOperations: WeakMap<RTCRtpSender, Promise<MediaCommandResult>>;
  sourceOperations: Map<string, Promise<MediaCommandResult>>;
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
  onFailure: (reason: string, error?: OwnedErrorValue) => MediaCommandResult;
  onSnapshot: (snapshot: NativeP2pSnapshot) => void;
  closeConnection: (peerId: string) => void;
  closeAll: () => void;
  startQualificationTimeout: () => void;
  startHealthChecks: () => void;
  stopHealthChecks: () => void;
  checkQualification: () => void;
  flushPendingSignals: () => Promise<MediaCommandResult>;
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
    operation: () => Promise<MediaCommandResult>,
    phase?: string,
  ) => Promise<MediaCommandResult>;
  schedulePeerNegotiation: (
    state: NativeP2pConnectionState,
  ) => Promise<MediaCommandResult>;
  retryPeerNegotiation: (state: NativeP2pConnectionState) => void;
  receiveSignal: (
    payload: Record<string, unknown>,
  ) => Promise<MediaCommandResult>;
  applyPeerSignal: (
    state: NativeP2pConnectionState,
    signal: Record<string, unknown>,
  ) => Promise<MediaCommandResult>;
  bindHealthChannel: (
    state: NativeP2pConnectionState,
    channel: RTCDataChannel,
  ) => void;
  handleConnectionState: (state: NativeP2pConnectionState) => void;
  handleIceState: (state: NativeP2pConnectionState) => void;
  handleTrack: (state: NativeP2pConnectionState, event: RTCTrackEvent) => void;
  updateSender: (
    sender: RTCRtpSender,
    operation: () => Promise<MediaCommandResult>,
  ) => Promise<MediaCommandResult>;
  updateTrack: (
    sender: RTCRtpSender,
    operation: () => Promise<MediaCommandResult>,
  ) => Promise<MediaCommandResult>;
  setSenderActive: (
    sender: RTCRtpSender | undefined,
    active: boolean,
  ) => Promise<MediaCommandResult>;
  setSenderReceiving: (
    state: NativeP2pConnectionState,
    source: string,
    receiving: boolean,
  ) => Promise<MediaCommandResult>;
  configureSender: (
    sender: RTCRtpSender,
    source: string,
    track: MediaStreamTrack,
  ) => Promise<MediaCommandResult>;
  getSnapshot: () => Promise<Array<Record<string, unknown>>>;
  emitSnapshot: () => void;
  applyTopology: (
    topology: Record<string, unknown>,
  ) => Promise<MediaCommandResult>;
  publishSource: (
    source: string,
    track: MediaStreamTrack,
    stream?: MediaStream,
    metadata?: Record<string, unknown>,
  ) => Promise<MediaCommandResult>;
  enqueueSourceOperation: (
    source: string,
    operation: () => Promise<MediaCommandResult>,
  ) => Promise<MediaCommandResult>;
  publishSourceInternal: (
    source: string,
    track: MediaStreamTrack,
    stream?: MediaStream,
    metadata?: Record<string, unknown>,
  ) => Promise<MediaCommandResult>;
  unpublishSource: (source: string) => Promise<MediaCommandResult>;
  unpublishSourceInternal: (source: string) => Promise<MediaCommandResult>;
  setSourceTransmission: (
    source: string,
    enabled: boolean,
  ) => Promise<MediaCommandResult>;
  setRemoteReceiving: (
    peerId: string | number | undefined,
    source: string,
    receiving: boolean,
  ) => MediaCommandResult;
  isMediaReady: () => boolean;
  stats: () => Promise<MediaCommandResult>;
  diagnosticStats: () => Promise<MediaCommandResult>;
  getInboundTrackStats: (
    peerId: string | number,
    track: MediaStreamTrack,
  ) => Promise<MediaCommandResult>;
  getOutboundTrackStats: (source: string) => Promise<RTCStatsReport | null>;
  getOutboundTrackParameters: (source: string) => RTCRtpSendParameters | null;
  setJitterBufferConfig: (config?: {
    minDelayMs?: number;
    targetDelayMs?: number;
  }) => MediaCommandResult;
  reconfigureSource: (source: string) => Promise<MediaCommandResult>;
}
