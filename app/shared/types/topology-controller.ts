import type { OwnedErrorValue } from "./shared-utilities.ts";
import type { ExternalValue } from "./boundary.ts";

import type { MediaCommandResult } from "./boundary.ts";

import type { Ref } from "vue";
import type { JitterBufferConfig } from "./adaptive-media.ts";
import type { ParticipantMediaCapabilities } from "./video-codec-capabilities.ts";
import type { VideoSettings } from "./video-settings.ts";
import type { CloudflarePublication } from "./cloudflare-media.ts";
import type { CloudflareRealtimeSession } from "../cloudflare-realtime-session.ts";
import type { MediasoupClientSession } from "../mediasoup-client-session.ts";
import type { RemoteMediaHandoff } from "../remote-media-handoff.ts";
import type {
  NativeP2pMeshOptions,
  NativeP2pMeshSurface,
  P2pIcePolicy,
} from "./native-p2p.ts";

export interface TopologyPeer {
  peerId?: string;
  userId?: string;
  sources?: string[];
  profile?: Record<string, unknown>;
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
  }) => Promise<void | MediaCommandResult>;
  send: (data: ExternalValue) => MediaCommandResult;
  close: () => void;
}

export interface TopologyVideoSenderOptions {
  encodings?: Array<{
    maxBitrate?: number;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export type TopologyNativeP2pOptions = NativeP2pMeshOptions;

export interface TopologyProviderActionsContext {
  MediasoupProviderSocket: new (options: {
    onMessage: (
      type: string,
      payload: Record<string, unknown>,
    ) => MediaCommandResult;
    onFailure: (error: OwnedErrorValue) => MediaCommandResult;
  }) => TopologyProviderSocket;
  closeSfuSafely: () => Promise<MediaCommandResult>;
  ensureSfu: () => TopologySfuSession;
  getActiveProvider: () => string | null;
  getHighestQueuedEpoch: () => number;
  getMessageHandler: (
    type: string,
  ) => ((data: Record<string, unknown>) => MediaCommandResult) | undefined;
  getProviderSocket: () => TopologyProviderSocket | null;
  getSelectedSfuProvider: () => string;
  getMediaCapabilities?: () => ParticipantMediaCapabilities | null;
  getSfu: () => TopologySfuSession | null;
  handleProviderFailure: (data: Record<string, unknown>) => MediaCommandResult;
  replayCloudflarePublications: (
    session: TopologySfuSession | null,
  ) => Promise<MediaCommandResult>;
  send: (message: Record<string, unknown>) => MediaCommandResult;
  setProviderSocket: (
    socket: TopologyProviderSocket | null,
  ) => MediaCommandResult;
  setSelectedSfuProvider: (provider: string) => MediaCommandResult;
  error: Ref<string | null>;
  topologyState: Ref<TopologyState>;
  waitForMediaTimeoutMs: () => number;
}

export interface TopologyResourceHelpersContext {
  NativeP2pMesh: new (
    options: TopologyNativeP2pOptions,
  ) => NativeP2pMeshSurface;
  buildP2pVideoSenderOptions: (
    options: Record<string, unknown>,
  ) => TopologyVideoSenderOptions;
  buildVoiceProducerOptions: (
    track: MediaStreamTrack,
    maxBitrate: number | null,
    stereo?: boolean,
  ) => Record<string, unknown>;
  closeSocket: () => MediaCommandResult;
  getActiveProvider: () => string | null;
  getAudioStereo: (source: string) => boolean;
  getEffectiveAudioBitrate: (source: string) => number | null;
  getIceServers: () => MediaCommandResult[];
  getMediaCapabilities?: () => ParticipantMediaCapabilities | null;
  getP2pMesh: () => TopologyP2pMesh | null;
  getRequestedVideoSettings: (source: string) => VideoSettings;
  getSelectedSfuProvider: () => string;
  getSfu: () => TopologySfuSession | null;
  handoff: TopologyHandoff;
  iceConnectedBoth: Ref<boolean>;
  mediaConnectionState: Ref<string>;
  onP2pQualification?: (data: Record<string, unknown>) => MediaCommandResult;
  requestedP2pPolicy: () => P2pIcePolicy;
  send: (message: Record<string, unknown>) => MediaCommandResult;
  setActiveProvider: (provider: "p2p" | "sfu" | null) => MediaCommandResult;
  setP2pMesh: (mesh: TopologyP2pMesh | null) => MediaCommandResult;
  setProviderSocket: (
    socket: TopologyProviderSocket | null,
  ) => MediaCommandResult;
  setSfu: (session: TopologySfuSession | null) => MediaCommandResult;
  setConnectionPhase: (
    phase: string,
    details?: Record<string, unknown>,
  ) => MediaCommandResult;
  topologyState: Ref<TopologyState>;
  transportReady: Ref<boolean>;
  updateP2pStats: (data: ExternalValue[]) => MediaCommandResult;
  getConnectionEpoch: () => number;
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
  p2pPath?: "direct" | "relay" | null;
  peers: TopologyPeer[];
  activatedAt?: number | null;
  canonicalMode?: "idle" | "probing" | "switching" | "p2p" | "sfu";
  activeTransport?: "p2p" | "sfu" | null;
  targetTransport?: "p2p" | "sfu" | null;
  requestedAudioLatencyProfile?: "standard" | "ultra-low";
  [key: string]: unknown;
}
export interface TopologySourceEntry extends Record<string, unknown> {
  source: string;
  track: MediaStreamTrack;
  key?: string;
  provider?: string;
  userId?: string | number | null;
  peerId?: string | number | null;
  stream?: MediaStream;
  generation?: number;
  captureTrack?: MediaStreamTrack;
  ownerSource?: string | null;
  incarnationId?: string;
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
  controlConnectionEpoch?: number;
  lastReceivedConsumerParams?: unknown;
  lastSentClientRtpCapabilities?: unknown;
  producers?: ReadonlyMap<
    string,
    { producer?: { getStats: () => Promise<MediaCommandResult> } }
  >;
  stats?: () => Promise<MediaCommandResult>;
  diagnosticStats?: () => Promise<MediaCommandResult>;
  closeConsumerByProducer?: (producerId: string) => MediaCommandResult;
  requestConsumer?: (producerId: string) => MediaCommandResult;
  subscribe?: (
    publication: CloudflarePublication,
  ) => Promise<MediaCommandResult>;
  recoverRemotePublication?: (
    trackName: string,
    expectedReceiverIncarnation?: string,
  ) => Promise<boolean>;
  initialize: () => Promise<void | MediaCommandResult>;
  addSource: (entry: TopologySourceEntry) => Promise<MediaCommandResult>;
  startSubscriptions?: () => Promise<MediaCommandResult>;
  connectionState: () => TopologyConnectionState;
  mediaReadiness?: (count: number) => Promise<Record<string, unknown>>;
  expectedInboundFlowCount?: () => number;
  handle: (
    type: string,
    data: Record<string, unknown>,
  ) => Promise<MediaCommandResult>;
  reconcilePublications?: (
    publications: CloudflarePublication[],
    removedPublications?: CloudflarePublication[],
    isStale?: () => boolean,
    getLatestCanonical?: () => CloudflarePublication[],
    getLatestRevision?: () => string | null,
  ) => Promise<MediaCommandResult>;
  setJitterBufferConfig: (config: JitterBufferConfig) => MediaCommandResult;
}
export type TopologyP2pMesh = NativeP2pMeshSurface;
export type TopologyHandoff = RemoteMediaHandoff;
export interface TopologyGeneration {
  capture: () => number;
  assert: (generation: number) => void;
  retire: () => number;
}
export interface TopologyControllerOptions {
  isDeafened?: () => boolean;
  CloudflareRealtimeSession: typeof CloudflareRealtimeSession;
  MediasoupClientSession: typeof MediasoupClientSession;
  MediasoupProviderSocket: TopologyProviderActionsContext["MediasoupProviderSocket"];
  NativeP2pMesh: new (
    options: TopologyNativeP2pOptions,
  ) => NativeP2pMeshSurface;
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
  failSession: (reason: string) => MediaCommandResult;
  getActiveProvider: () => string | null;
  getAudioStereo: (source: string) => boolean;
  getEffectiveAudioBitrate: (source: string) => number | null;
  getIceServers: () => MediaCommandResult[];
  getMediaCapabilities?: () => ParticipantMediaCapabilities | null;
  getConnectionEpoch?: () => number;
  getLocalPeerId: () => string | null;
  getMessageHandler: (
    type: string,
  ) => ((data: Record<string, unknown>) => MediaCommandResult) | undefined;
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
  onP2pQualification?: (data: Record<string, unknown>) => MediaCommandResult;
  onRemotePublication: () => Iterable<unknown>;
  onTopologyStateUpdated?: (
    data: TopologyData,
    state: TopologyState,
  ) => MediaCommandResult;
  peerConnectionMetrics: Ref<Record<string, unknown>>;
  publishLocalSources: (
    provider: TopologyP2pMesh | TopologySfuSession,
  ) => Promise<MediaCommandResult>;
  refreshPublicMaps: () => MediaCommandResult;
  refreshTopologyGraph: () => MediaCommandResult;
  reportedSfuFailureState: Ref<Record<string, unknown> | string | null>;
  replayCloudflarePublications: (
    session: TopologySfuSession | null,
  ) => Promise<MediaCommandResult>;
  send: (message: Record<string, unknown>) => MediaCommandResult;
  sfuRoundTripTime: Ref<number | null>;
  setActiveProvider: (provider: "p2p" | "sfu" | null) => void;
  setP2pMesh: (mesh: TopologyP2pMesh | null) => void;
  setProviderSocket: (socket: TopologyProviderSocket | null) => void;
  setSelectedSfuProvider: (provider: string) => void;
  setSfu: (session: TopologySfuSession | null) => void;
  setConnectionPhase: (
    phase: string,
    details?: Record<string, unknown>,
  ) => MediaCommandResult;
  setRouteConnectionState: (state: string) => MediaCommandResult;
  shouldAcceptTopologyEvent: (
    data: TopologyData,
    epoch: number,
    sourceRevision: number,
  ) => boolean;
  topologyEventKey: (data: TopologyData) => string;
  topologyState: Ref<TopologyState>;
  transportReady: Ref<boolean>;
  updateP2pStats: (data: ExternalValue[]) => MediaCommandResult;
  waitForMediaTimeoutMs: () => number;
}

export interface TopologyController {
  applyAdaptiveJitterBuffer: () => MediaCommandResult;
  ensureP2p: (policy?: P2pIcePolicy) => {
    receiveSignal: (
      data: Record<string, unknown>,
    ) => Promise<MediaCommandResult>;
    fail: (reason: string, error: OwnedErrorValue) => MediaCommandResult;
  } | null;
  ensureSfu: () => MediaCommandResult;
  handleP2pQualification: (
    data?: Record<string, unknown>,
  ) => MediaCommandResult;
  handleProviderFailure: (data?: Record<string, unknown>) => MediaCommandResult;
  handleProviderRecovering: (
    data?: Record<string, unknown>,
  ) => MediaCommandResult;
  handleProviderTicket: (data: Record<string, unknown>) => MediaCommandResult;
  queueTopology: (data: TopologyData) => MediaCommandResult;
  reportSfuFailure: (reason: string) => MediaCommandResult;
  reset: () => MediaCommandResult;
}
