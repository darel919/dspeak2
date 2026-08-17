import type { Ref } from "vue";
import type { JitterBufferConfig } from "./adaptive-media.ts";
import type { ParticipantMediaCapabilities } from "./video-codec-capabilities.ts";
import type { VideoSettings } from "./video-settings.ts";

export interface TopologyPeer {
  peerId?: string;
  userId?: string;
  sources?: string[];
  profile?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface TopologyData {
  mode?: string;
  target?: string | null;
  provider?: string | null;
  providerId?: string | null;
  targetProvider?: string | null;
  targetProviderId?: string | null;
  route?: {
    provider?: string | null;
    providerId?: string | null;
    epoch?: number | string;
    sourceRevision?: number | string;
  } | null;
  targetRoute?: {
    provider?: string | null;
    providerId?: string | null;
  } | null;
  epoch?: number | string;
  sourceRevision?: number | string;
  roomRevision?: string | number;
  preparedEpoch?: number | string | null;
  reason?: string | null;
  transitionFailure?: unknown;
  peers?: TopologyPeer[];
  activatedAt?: number | null;
  signalingUrl?: string;
  ticket?: string;
  [key: string]: unknown;
}

export interface TopologyProviderSocket {
  connect: (options: {
    signalingUrl: string;
    ticket: string;
    mediaCapabilities?: ParticipantMediaCapabilities | null;
    capabilityProtocol?: string;
  }) => Promise<unknown>;
  send: (data: unknown) => unknown;
  close: () => void;
}

export interface TopologyVideoSenderOptions {
  encodings?: Array<{
    maxBitrate?: number;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export interface TopologyNativeP2pOptions {
  iceServers: unknown[];
  sendSignal: (payload: Record<string, unknown>) => unknown;
  onRemoteTrack: (entry: TopologySourceEntry) => unknown;
  onRemoteTrackEnded: (entry: TopologySourceEntry) => unknown;
  onFailure: (failure: unknown) => unknown;
  onSnapshot: (snapshot: Record<string, unknown>) => unknown;
  getAudioStereo: (source: string) => boolean;
  getSenderOptions: (
    source: string,
    track: MediaStreamTrack,
  ) => Record<string, unknown>;
  mediaCapabilities?: ParticipantMediaCapabilities | null;
}

export interface TopologyProviderActionsContext {
  MediasoupProviderSocket: new (options: {
    onMessage: (type: string, payload: Record<string, unknown>) => unknown;
    onFailure: (error: unknown) => unknown;
  }) => TopologyProviderSocket;
  closeSfuSafely: () => Promise<unknown>;
  ensureSfu: () => TopologySfuSession;
  getActiveProvider: () => string | null;
  getHighestQueuedEpoch: () => number;
  getMessageHandler: (
    type: string,
  ) => ((data: Record<string, unknown>) => unknown) | undefined;
  getProviderSocket: () => TopologyProviderSocket | null;
  getSelectedSfuProvider: () => string;
  getMediaCapabilities?: () => ParticipantMediaCapabilities | null;
  getSfu: () => TopologySfuSession | null;
  handleProviderFailure: (data: Record<string, unknown>) => unknown;
  replayCloudflarePublications: (
    session: TopologySfuSession | null,
  ) => Promise<unknown>;
  send: (message: Record<string, unknown>) => unknown;
  setProviderSocket: (socket: TopologyProviderSocket | null) => unknown;
  setSelectedSfuProvider: (provider: string) => unknown;
  error: Ref<string | null>;
  topologyState: Ref<TopologyState>;
  waitForMediaTimeoutMs: () => number;
}

export interface TopologyResourceHelpersContext {
  NativeP2pMesh: new (options: TopologyNativeP2pOptions) => TopologyP2pMesh;
  buildP2pVideoSenderOptions: (
    options: Record<string, unknown>,
  ) => TopologyVideoSenderOptions;
  buildVoiceProducerOptions: (
    track: MediaStreamTrack,
    maxBitrate: number | null,
    stereo?: boolean,
  ) => Record<string, unknown>;
  closeSocket: () => unknown;
  getActiveProvider: () => string | null;
  getAudioStereo: (source: string) => boolean;
  getEffectiveAudioBitrate: (source: string) => number | null;
  getIceServers: () => unknown[];
  getMediaCapabilities?: () => ParticipantMediaCapabilities | null;
  getP2pMesh: () => TopologyP2pMesh | null;
  getRequestedVideoSettings: (source: string) => VideoSettings;
  getSelectedSfuProvider: () => string;
  getSfu: () => TopologySfuSession | null;
  handoff: TopologyHandoff;
  iceConnectedBoth: Ref<boolean>;
  mediaConnectionState: Ref<string>;
  onP2pQualification?: (data: Record<string, unknown>) => unknown;
  send: (message: Record<string, unknown>) => unknown;
  setActiveProvider: (provider: "p2p" | "sfu" | null) => unknown;
  setP2pMesh: (mesh: TopologyP2pMesh | null) => unknown;
  setProviderSocket: (socket: TopologyProviderSocket | null) => unknown;
  setSfu: (session: TopologySfuSession | null) => unknown;
  setConnectionPhase: (
    phase: string,
    details?: Record<string, unknown>,
  ) => unknown;
  topologyState: Ref<TopologyState>;
  transportReady: Ref<boolean>;
  updateP2pStats: (data: unknown[]) => unknown;
}
export interface TopologyState {
  mode: string;
  epoch: number;
  sourceRevision?: number;
  reason?: string | null;
  target?: string | null;
  provider?: string | null;
  providerId?: string | null;
  targetProvider?: string | null;
  targetProviderId?: string | null;
  transitionFailure?: unknown;
  preparedEpoch?: number | null;
  peers: TopologyPeer[];
  activatedAt?: number | null;
  canonicalMode?: "idle" | "probing" | "switching" | "p2p" | "sfu";
  activeTransport?: "p2p" | "sfu" | null;
  targetTransport?: "p2p" | "sfu" | null;
  [key: string]: unknown;
}
export interface TopologySourceEntry {
  source: string;
  track: MediaStreamTrack;
  key?: string;
  provider?: string;
  userId?: string | number | null;
  peerId?: string | number | null;
  stream?: MediaStream;
  generation?: number;
  [key: string]: unknown;
}
export interface TopologyConnectionState {
  ready?: boolean;
  sendRequired?: boolean;
  receiveRequired?: boolean;
  send?: string;
  recv?: string;
}
export interface TopologySfuSession {
  provider?: string;
  providerId?: string | null;
  initialize: () => Promise<unknown>;
  addSource: (entry: TopologySourceEntry) => Promise<unknown>;
  publishSource: (
    source: string,
    track: MediaStreamTrack,
    stream?: MediaStream,
    entry?: TopologySourceEntry,
  ) => Promise<unknown>;
  startSubscriptions?: () => Promise<unknown>;
  connectionState: () => TopologyConnectionState;
  mediaReadiness?: (count: number) => Promise<Record<string, unknown>>;
  expectedInboundFlowCount?: () => number;
  handle: (type: string, data: unknown) => Promise<unknown>;
  setJitterBufferConfig: (config: JitterBufferConfig) => unknown;
  [key: string]: unknown;
}
export interface TopologyP2pMesh {
  applyTopology: (data: TopologyData) => Promise<unknown>;
  publishSource: (
    source: string,
    track: MediaStreamTrack,
    stream?: MediaStream,
    entry?: TopologySourceEntry,
  ) => Promise<unknown>;
  isMediaReady: () => boolean;
  setJitterBufferConfig: (config: JitterBufferConfig) => unknown;
  [key: string]: unknown;
}
export interface TopologyHandoff {
  stage: (
    entry: TopologySourceEntry & { key: string; provider: string },
    provider: string | null,
  ) => unknown;
  remove: (
    entry: TopologySourceEntry & { key: string; provider: string },
  ) => unknown;
  pruneExpectedFeeds: (
    peers: TopologyPeer[],
    localPeerId: string | null,
  ) => unknown;
  clear: () => unknown;
  bind: (provider: string) => unknown;
  retire: (provider: string) => unknown;
  entries: (provider: "p2p" | "sfu") => Iterable<{
    userId?: string | number | null;
    source: string;
  }>;
  count: (provider: "p2p" | "sfu") => number;
  hasExpectedFeeds: (
    provider: "p2p" | "sfu",
    peers: TopologyPeer[],
    localPeerId: string | number | null,
  ) => boolean;
}
export interface TopologyGeneration {
  capture: () => number;
  assert: (generation: number) => void;
  retire: () => number;
}
export interface TopologyControllerOptions {
  CloudflareRealtimeSession: unknown;
  MediasoupClientSession: unknown;
  MediasoupProviderSocket: TopologyProviderActionsContext["MediasoupProviderSocket"];
  NativeP2pMesh: unknown;
  buildP2pVideoSenderOptions: (
    options: Record<string, unknown>,
  ) => Record<string, unknown>;
  buildVoiceProducerOptions: (
    track: MediaStreamTrack,
    maxBitrate: number | null,
    stereo?: boolean,
  ) => Record<string, unknown>;
  closeSocket: () => void;
  currentJitterBufferConfig: Ref<JitterBufferConfig>;
  error: Ref<string | null>;
  failSession: (reason: string) => unknown;
  getActiveProvider: () => string | null;
  getAudioStereo: (source: string) => boolean;
  getEffectiveAudioBitrate: (source: string) => number | null;
  getIceServers: () => unknown[];
  getMediaCapabilities?: () => ParticipantMediaCapabilities | null;
  getLocalPeerId: () => string | null;
  getMessageHandler: (
    type: string,
  ) => ((data: Record<string, unknown>) => unknown) | undefined;
  getProviderSocket: () => TopologyProviderSocket | null;
  getRequestedVideoSettings: (source: string) => VideoSettings;
  getSelectedSfuProvider: () => string;
  getSfu: () => TopologySfuSession | null;
  getP2pMesh: () => TopologyP2pMesh | null;
  handoff: TopologyHandoff;
  iceConnectedBoth: Ref<boolean>;
  localSources: Map<string, TopologySourceEntry>;
  mediaConnectionState: Ref<string>;
  mediaGeneration: TopologyGeneration;
  mediaReadinessPollMs: number;
  mediaHandoffTimeoutMs: number;
  onP2pQualification?: (data: Record<string, unknown>) => unknown;
  onRemotePublication: () => Iterable<unknown>;
  onTopologyStateUpdated?: (
    data: TopologyData,
    state: TopologyState,
  ) => unknown;
  peerConnectionMetrics: Ref<Record<string, unknown>>;
  publishLocalSources: (
    provider: TopologyP2pMesh | TopologySfuSession,
  ) => Promise<unknown>;
  refreshPublicMaps: () => unknown;
  refreshTopologyGraph: () => unknown;
  reportedSfuFailureState: Ref<Record<string, unknown> | string | null>;
  replayCloudflarePublications: (
    session: TopologySfuSession | null,
  ) => Promise<unknown>;
  send: (message: Record<string, unknown>) => unknown;
  sfuRoundTripTime: Ref<number | null>;
  setActiveProvider: (provider: "p2p" | "sfu" | null) => void;
  setP2pMesh: (mesh: TopologyP2pMesh | null) => void;
  setProviderSocket: (socket: TopologyProviderSocket | null) => void;
  setSelectedSfuProvider: (provider: string) => void;
  setSfu: (session: TopologySfuSession | null) => void;
  setConnectionPhase: (
    phase: string,
    details?: Record<string, unknown>,
  ) => unknown;
  setRouteConnectionState: (state: string) => unknown;
  shouldAcceptTopologyEvent: (
    data: TopologyData,
    epoch: number,
    sourceRevision: number,
  ) => boolean;
  topologyEventKey: (data: TopologyData) => string;
  topologyState: Ref<TopologyState>;
  transportReady: Ref<boolean>;
  updateP2pStats: (data: unknown[]) => unknown;
  waitForMediaTimeoutMs: () => number;
}

export interface TopologyController {
  applyAdaptiveJitterBuffer: () => unknown;
  ensureP2p: () => {
    receiveSignal: (data: Record<string, unknown>) => Promise<unknown>;
    fail: (reason: string, error: unknown) => unknown;
  } | null;
  ensureSfu: () => unknown;
  handleP2pQualification: (data?: Record<string, unknown>) => unknown;
  handleProviderFailure: (data?: Record<string, unknown>) => unknown;
  handleProviderRecovering: (data?: Record<string, unknown>) => unknown;
  handleProviderTicket: (data: Record<string, unknown>) => unknown;
  queueTopology: (data: TopologyData) => unknown;
  reportSfuFailure: (reason: string) => unknown;
  reset: () => unknown;
}
