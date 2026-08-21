import type { OwnedErrorValue } from "./shared-utilities.ts";
import type { ExternalValue } from "./boundary.ts";

import type { MediaCommandResult } from "./boundary.ts";

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

export type LifecycleFunction = (...args: unknown[]) => MediaCommandResult;

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
  handleMediaSignalingClose: (
    options: MediaSignalingCloseOptions,
  ) => MediaCommandResult;
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
    setTopologyWaiter: (
      waiter: ((error?: OwnedErrorValue) => void) | null,
    ) => void;
    closeProviders: (
      options: Omit<MediaSessionCleanupOptions, "capture" | "socket">,
    ) => MediaCommandResult;
    getP2pMesh: () => NativeP2pMeshSurface | null;
    getSfu: () => TopologySfuSession | null;
    mediaPathMetrics: Ref<unknown[]>;
    peerRoundTripTimes: Ref<Record<string, unknown>>;
    peerConnectionMetrics: Ref<Record<string, unknown>>;
    sfuRoundTripTime: Ref<number | null>;
    sendSourceState: () => MediaCommandResult;
    setupMessageHandlers: (options: MediaMessageHandlersContext) => void;
    resolveOperationAck: (operationId: string) => MediaCommandResult;
    rejectOperationAck: (
      operationId: string,
      error: OwnedErrorValue,
    ) => MediaCommandResult;
    getConnectionEpoch: () => number;
    setConnectionEpoch: (epoch: number) => void;
    getLastAppliedRoomRevision: () => string;
    applyRoomRevision: (roomRevision: string) => MediaCommandResult;
    requestSnapshot: () => MediaCommandResult;
    receiveAttenuation: (data: MediaAttenuationState) => MediaCommandResult;
    handleProviderFailure: (
      data?: Record<string, unknown>,
    ) => MediaCommandResult;
    handleProviderRecovering: (
      data?: Record<string, unknown>,
    ) => MediaCommandResult;
    handleP2pQualification: (
      data?: Record<string, unknown>,
    ) => MediaCommandResult;
    handleProviderTicket: (data: TopologyData) => MediaCommandResult;
    sfuProducerIds: () => string[];
    queueCloudflarePublication: (
      data: CloudflarePublication,
    ) => MediaCommandResult;
    resolveTopologyWaiter?: (error: Error) => void;
    ensureP2p: () => NativeP2pMeshSurface | null;
    ensureSfu: () => TopologySfuSession | null;
    sendParticipantVoiceState: () => MediaCommandResult;
    queueTargetedReconciliation: (
      operationId: string,
      data: Record<string, unknown>,
    ) => MediaCommandResult;
    processPendingRetirements?: () => Promise<void>;
    onConnectionEpochUpdated?: (connectionEpoch: number) => MediaCommandResult;
    handlePublicationsDigest: (
      publications: unknown[],
      publicationRevision?: string | number | null,
    ) => Promise<MediaCommandResult>;
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
    (
      data: import("./media-message-handlers.ts").MediaMessage,
    ) => MediaCommandResult
  >;
  participantSfuRoundTripTimes: Ref<Record<string, unknown>>;
  protocolState: Ref<{
    mediaSessionId?: string;
    protocolVersion?: string;
  } | null>;
  protocolUpdateRequired: Ref<boolean>;
  providerRecovery: {
    receive: (data?: Record<string, unknown>) => MediaCommandResult;
  };
  queueTopology: (data: TopologyData) => MediaCommandResult;
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
    open: () => Promise<MediaCommandResult>;
    getHeartbeatSequence: () => number;
    getLastHeartbeatAckSequence: () => number;
    getSocket: () => { close: () => MediaCommandResult } | null;
    markReady: () => boolean;
    acceptServerHello: (data: ExternalValue) => boolean;
    getProtocolState: () => Record<string, unknown> | null;
    acknowledgeHeartbeat: (
      sequence: number,
      acknowledgedAt: number,
    ) => MediaCommandResult;
  };
  syncConnectedUsers: (data?: unknown[]) => MediaCommandResult;
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
  ) => MediaCommandResult;
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
  handleP2pQualification: (
    data?: Record<string, unknown>,
  ) => MediaCommandResult;
  handleProviderFailure: (data?: Record<string, unknown>) => MediaCommandResult;
  handleProviderRecovering: (
    data?: Record<string, unknown>,
  ) => MediaCommandResult;
  handleProviderTicket: (data: TopologyData) => MediaCommandResult;
  mediaPathMetrics: Ref<unknown[]>;
  peerConnectionMetrics: Ref<Record<string, unknown>>;
  peerRoundTripTimes: Ref<Record<string, unknown>>;
  receiveAttenuation: (data: MediaAttenuationState) => MediaCommandResult;
  resetLifecycle: () => void;
  resolveTopologyWaiter: (error: Error) => void;
  sfuProducerIds: () => string[];
  sendParticipantVoiceState: () => MediaCommandResult;
  sendSourceState: () => MediaCommandResult;
  resolveOperationAck: (operationId: string) => MediaCommandResult;
  rejectOperationAck: (
    operationId: string,
    error: OwnedErrorValue,
  ) => MediaCommandResult;
  getConnectionEpoch: () => number;
  setConnectionEpoch: (epoch: number) => void;
  getLastAppliedRoomRevision: () => string;
  getLastAppliedPublicationRevision: () => string;
  setLastAppliedPublicationRevision: (value: string) => void;
  applyRoomRevision: (roomRevision: string) => MediaCommandResult;
  requestSnapshot: () => MediaCommandResult;
  setTopologyWaiter: (
    waiter: ((error?: OwnedErrorValue) => void) | null,
  ) => void;
  setupMessageHandlers: (options: MediaMessageHandlersContext) => void;
  queueCloudflarePublication: (
    data: CloudflarePublication,
  ) => MediaCommandResult;
  queueTargetedReconciliation: (
    operationId: string,
    data: Record<string, unknown>,
  ) => MediaCommandResult;
  handlePublicationsDigest: (
    publications: unknown[],
    publicationRevision?: string | number | null,
  ) => Promise<MediaCommandResult>;
  sourceController: {
    getLocalSources?: () => Map<string, unknown>;
    processPendingRetirements?: () => Promise<void>;
  };
};
