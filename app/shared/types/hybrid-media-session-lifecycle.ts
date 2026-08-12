import type { Ref } from "vue";

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
    getChannelById: (channelId: string) => {
      mediaPolicy?: { connectionMode?: string };
      room?: { id?: string };
    } | null;
  };
  connected: Ref<boolean>;
  error: Ref<string | null>;
  getIntentionalClose: () => boolean;
  getMediaControlUrl: () => string | null;
  getRoomId: () => string | null;
  getSfu: () => { handle: (type: string, data: unknown) => unknown } | null;
  getSupabaseClient: () => {
    auth: {
      getSession: () => Promise<{
        data?: { session?: { access_token?: string } | null };
      }>;
    };
  } | null;
  handleMediaSignalingClose: (options: Record<string, unknown>) => unknown;
  handoff: unknown;
  iceConnectedBoth: Ref<boolean>;
  lastInRoom: Ref<unknown>;
  mediaConnectionState: Ref<string>;
  mediaControlApiPath: string;
  mediaControlTicketState: Ref<unknown>;
  mediaControlSocketUrlState: Ref<unknown>;
  mediaSessionSetup: {
    getBootstrap: (
      options: Record<string, unknown>,
    ) => Promise<{ mediaControlUrl?: string; ticket: string }>;
    getChannelId: () => string | null;
    getDeviceId: () => string;
    resetLifecycle: () => void;
    setTopologyWaiter: (waiter: ((error?: unknown) => void) | null) => void;
    closeProviders: (options: Record<string, unknown>) => unknown;
    getP2pMesh: () => unknown;
    getSfu: () => unknown;
    mediaPathMetrics: Ref<unknown>;
    peerRoundTripTimes: Ref<unknown>;
    peerConnectionMetrics: Ref<unknown>;
    sfuRoundTripTime: Ref<unknown>;
    sendSourceState: () => unknown;
    setupMessageHandlers: (options: Record<string, unknown>) => void;
    receiveAttenuation: (data: unknown) => unknown;
    handleProviderFailure: (data: unknown) => unknown;
    handleP2pQualification: (data: unknown) => unknown;
    handleProviderTicket: (data: unknown) => unknown;
    sfuProducerIds: () => string[];
    queueCloudflarePublication: (data: unknown) => unknown;
    resolveTopologyWaiter?: (error: Error) => void;
    ensureP2p: () => unknown;
    ensureSfu: () => unknown;
    sendParticipantVoiceState: () => unknown;
  };
  messageHandlers: Map<string, (data: unknown) => unknown>;
  participantSfuRoundTripTimes: Ref<unknown>;
  protocolState: Ref<{
    mediaSessionId?: string;
    protocolVersion?: string;
  } | null>;
  protocolUpdateRequired: Ref<boolean>;
  providerRecovery: { receive: (data: unknown) => unknown };
  queueTopology: (data: unknown) => unknown;
  remoteProducersCount: Ref<number>;
  resetMediaTelemetryState: (options: Record<string, unknown>) => void;
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
  setP2pMesh: (mesh: unknown) => void;
  setSfu: (sfu: unknown) => void;
  setActiveProvider: (provider: string | null) => void;
  signaling: {
    open: () => Promise<unknown>;
    getHeartbeatSequence: () => number;
    getLastHeartbeatAckSequence: () => number;
    getSocket: () => unknown;
    markReady: () => boolean;
    acceptServerHello: (data: unknown) => boolean;
    getProtocolState: () => Record<string, unknown>;
    acknowledgeHeartbeat: (data: unknown) => unknown;
  };
  syncConnectedUsers: (data: unknown) => unknown;
  topologyState: Ref<{ epoch: number; mode: string }>;
  transportReady: Ref<boolean>;
  voiceStore: unknown;
}

export interface RuntimeDependencyContext extends LifecycleDependencyContext {
  sfuRoundTripTime: Ref<unknown>;
  closeProviders: (options: Record<string, unknown>) => unknown;
  ensureP2p: () => unknown;
  ensureSfu: () => unknown;
  getChannelId: () => string | null;
  getDeviceId: () => string;
  getP2pMesh: () => unknown;
  getBootstrap: (
    options: Record<string, unknown>,
  ) => Promise<{ mediaControlUrl?: string; ticket: string }>;
  handleP2pQualification: (data: unknown) => unknown;
  handleProviderFailure: (data: unknown) => unknown;
  handleProviderTicket: (data: unknown) => unknown;
  mediaPathMetrics: Ref<unknown>;
  peerConnectionMetrics: Ref<unknown>;
  peerRoundTripTimes: Ref<unknown>;
  receiveAttenuation: (data: unknown) => unknown;
  resetLifecycle: () => void;
  resolveTopologyWaiter: (error: Error) => void;
  sfuProducerIds: () => string[];
  sendParticipantVoiceState: () => unknown;
  sendSourceState: () => unknown;
  setTopologyWaiter: (waiter: ((error?: unknown) => void) | null) => void;
  setupMessageHandlers: (options: Record<string, unknown>) => void;
  queueCloudflarePublication: (data: unknown) => unknown;
}
