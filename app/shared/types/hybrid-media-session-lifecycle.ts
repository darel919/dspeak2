import type { Ref } from "vue";
import type { MediaAttenuationState } from "../media-attenuation-reporter.ts";
import type {
  MediaSignalingCloseOptions,
  MediaSessionCleanupOptions,
  MediaTelemetryResetOptions,
} from "./media-session-cleanup.ts";
import type { MediaMessageHandlersContext } from "./media-message-handlers.ts";
import type { RemoteMediaHandoff } from "../remote-media-handoff.ts";
import type { NativeP2pMeshSurface } from "./native-p2p.ts";
import type {
  TopologyData,
  TopologySfuSession,
} from "./topology-controller.ts";
import type { CloudflarePublication } from "./cloudflare-media.ts";
import type { ChannelRecord } from "./channels.ts";

export type LifecycleFunction = (...args: unknown[]) => unknown;

export interface LifecycleBootstrap {
  baseApiPath: string;
  channelId: string;
  connectionMode: string;
  deviceId: string;
  roomId: string | null;
}

export interface LifecycleDependencyContext {
  authStore: { getUserData: () => { id?: string | number } | null };
  buildMediaControlSocketUrl: (options: {
    mediaControlUrl: string;
    channelId: string;
    ticket?: string;
  }) => string;
  channelsStore: {
    getChannelById: (channelId: string) => ChannelRecord | null | undefined;
  };
  connected: Ref<boolean>;
  error: Ref<string | null>;
  getIntentionalClose: () => boolean;
  getMediaControlUrl: () => string | null;
  getRoomId: () => string | null;
  getSfu: () => TopologySfuSession | null;
  getSupabaseClient: () => {
    auth: {
      getSession: () => Promise<{
        data?: { session?: { access_token?: string } | null };
      }>;
    };
  } | null;
  handleMediaSignalingClose: (options: MediaSignalingCloseOptions) => unknown;
  handoff: RemoteMediaHandoff;
  iceConnectedBoth: Ref<boolean>;
  lastInRoom: Ref<string[]>;
  mediaConnectionState: Ref<string>;
  mediaControlApiPath: string;
  mediaControlTicketState: Ref<string | null>;
  mediaControlSocketUrlState: Ref<string | null>;
  mediaSessionSetup: {
    getBootstrap: (options: {
      accessToken?: string | null;
      baseApiPath?: string;
      channelId: string;
      connectionMode: string;
      deviceId: string;
      roomId: string | null;
    }) => Promise<{ mediaControlUrl?: string; ticket: string }>;
    getChannelId: () => string | null;
    getDeviceId: () => string;
    resetLifecycle: () => void;
    setTopologyWaiter: (waiter: ((error?: unknown) => void) | null) => void;
    closeProviders: (
      options: Omit<MediaSessionCleanupOptions, "capture" | "socket">,
    ) => unknown;
    getP2pMesh: () => NativeP2pMeshSurface | null;
    getSfu: () => TopologySfuSession | null;
    mediaPathMetrics: Ref<unknown[]>;
    peerRoundTripTimes: Ref<Record<string, unknown>>;
    peerConnectionMetrics: Ref<Record<string, unknown>>;
    sfuRoundTripTime: Ref<number | null>;
    sendSourceState: () => unknown;
    setupMessageHandlers: (options: MediaMessageHandlersContext) => void;
    resolveOperationAck: (operationId: string) => unknown;
    rejectOperationAck: (operationId: string, error: unknown) => unknown;
    getConnectionEpoch: () => number;
    setConnectionEpoch: (epoch: number) => void;
    getLastAppliedRoomRevision: () => string;
    applyRoomRevision: (roomRevision: string) => unknown;
    requestSnapshot: () => unknown;
    receiveAttenuation: (data: MediaAttenuationState) => unknown;
    handleProviderFailure: (data?: Record<string, unknown>) => unknown;
    handleProviderRecovering: (data?: Record<string, unknown>) => unknown;
    handleP2pQualification: (data?: Record<string, unknown>) => unknown;
    handleProviderTicket: (data: TopologyData) => unknown;
    sfuProducerIds: () => string[];
    queueCloudflarePublication: (data: CloudflarePublication) => unknown;
    resolveTopologyWaiter?: (error: Error) => void;
    ensureP2p: () => NativeP2pMeshSurface | null;
    ensureSfu: () => TopologySfuSession | null;
    sendParticipantVoiceState: () => unknown;
    queueTargetedReconciliation: (
      operationId: string,
      data: Record<string, unknown>,
    ) => unknown;
    processPendingRetirements?: () => Promise<void>;
    onConnectionEpochUpdated?: (connectionEpoch: number) => unknown;
    handlePublicationsDigest: (
      publications: unknown[],
      publicationRevision?: string | number | null,
    ) => Promise<unknown>;
    getLocalSources: () => Map<string, unknown>;
    getLastAppliedPublicationRevision: () => string;
    setLastAppliedPublicationRevision: (value: string) => void;
    sourceController: {
      getLocalSources?: () => Map<string, unknown>;
      processPendingRetirements?: () => Promise<void>;
    };
  };
  messageHandlers: Map<
    string,
    (data: import("./media-message-handlers.ts").MediaMessage) => unknown
  >;
  participantSfuRoundTripTimes: Ref<Record<string, unknown>>;
  protocolState: Ref<{
    mediaSessionId?: string;
    protocolVersion?: string;
  } | null>;
  protocolUpdateRequired: Ref<boolean>;
  providerRecovery: { receive: (data?: Record<string, unknown>) => unknown };
  queueTopology: (data: TopologyData) => unknown;
  remoteProducersCount: Ref<number>;
  resetMediaTelemetryState: (options: MediaTelemetryResetOptions) => void;
  resetTopologySequencing: (reason?: string) => void;
  runtimeConnectionTimeoutMs: number;
  setChannelId: (channelId: string | null) => void;
  setConnectionPhase: (
    phase: string,
    details?: Record<string, unknown>,
  ) => void;
  setIceServers: (servers: unknown[]) => void;
  setIntentionalClose: (value: boolean) => void;
  setLocalPeerId: (peerId: string | null) => void;
  setMediaControlSocketUrl: (url: string) => void;
  setMediaControlTicket: (ticket: string) => void;
  setP2pMesh: (mesh: NativeP2pMeshSurface | null) => void;
  setSfu: (sfu: TopologySfuSession | null) => void;
  setActiveProvider: (provider: "p2p" | "sfu" | null) => void;
  signaling: {
    open: () => Promise<unknown>;
    getHeartbeatSequence: () => number;
    getLastHeartbeatAckSequence: () => number;
    getSocket: () => { close: () => unknown } | null;
    markReady: () => boolean;
    acceptServerHello: (data: unknown) => boolean;
    getProtocolState: () => Record<string, unknown> | null;
    acknowledgeHeartbeat: (sequence: number, acknowledgedAt: number) => unknown;
  };
  syncConnectedUsers: (data?: unknown[]) => unknown;
  topologyState: Ref<{ epoch: number; mode: string }>;
  transportReady: Ref<boolean>;
  voiceStore: MediaMessageHandlersContext["voiceStore"];
  getConnectionEpoch: () => number;
  setConnectionEpoch: (epoch: number) => void;
}

export type RuntimeDependencyContext = Omit<
  LifecycleDependencyContext,
  "mediaSessionSetup"
> & {
  sfuRoundTripTime: Ref<number | null>;
  closeProviders: (
    options: Omit<MediaSessionCleanupOptions, "capture" | "socket">,
  ) => unknown;
  ensureP2p: () => NativeP2pMeshSurface | null;
  ensureSfu: () => TopologySfuSession | null;
  getChannelId: () => string | null;
  getDeviceId: () => string;
  getP2pMesh: () => NativeP2pMeshSurface | null;
  getBootstrap: (options: {
    accessToken?: string | null;
    baseApiPath?: string;
    channelId: string;
    connectionMode: string;
    deviceId: string;
    roomId: string | null;
  }) => Promise<{ mediaControlUrl?: string; ticket: string }>;
  handleP2pQualification: (data?: Record<string, unknown>) => unknown;
  handleProviderFailure: (data?: Record<string, unknown>) => unknown;
  handleProviderRecovering: (data?: Record<string, unknown>) => unknown;
  handleProviderTicket: (data: TopologyData) => unknown;
  mediaPathMetrics: Ref<unknown[]>;
  peerConnectionMetrics: Ref<Record<string, unknown>>;
  peerRoundTripTimes: Ref<Record<string, unknown>>;
  receiveAttenuation: (data: MediaAttenuationState) => unknown;
  resetLifecycle: () => void;
  resolveTopologyWaiter: (error: Error) => void;
  sfuProducerIds: () => string[];
  sendParticipantVoiceState: () => unknown;
  sendSourceState: () => unknown;
  resolveOperationAck: (operationId: string) => unknown;
  rejectOperationAck: (operationId: string, error: unknown) => unknown;
  getConnectionEpoch: () => number;
  setConnectionEpoch: (epoch: number) => void;
  getLastAppliedRoomRevision: () => string;
  getLastAppliedPublicationRevision: () => string;
  setLastAppliedPublicationRevision: (value: string) => void;
  applyRoomRevision: (roomRevision: string) => unknown;
  requestSnapshot: () => unknown;
  setTopologyWaiter: (waiter: ((error?: unknown) => void) | null) => void;
  setupMessageHandlers: (options: MediaMessageHandlersContext) => void;
  queueCloudflarePublication: (data: CloudflarePublication) => unknown;
  queueTargetedReconciliation: (
    operationId: string,
    data: Record<string, unknown>,
  ) => unknown;
  handlePublicationsDigest: (
    publications: unknown[],
    publicationRevision?: string | number | null,
  ) => Promise<unknown>;
  sourceController: {
    getLocalSources?: () => Map<string, unknown>;
    processPendingRetirements?: () => Promise<void>;
  };
};
