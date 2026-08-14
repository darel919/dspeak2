import type { MediasoupClientSession } from "../../shared/mediasoup-client-session.ts";
import type { MediasoupProviderSocket } from "../../shared/mediasoup-provider-socket.ts";
import type { NativeP2pMesh } from "../../shared/native-p2p.ts";
import type { createHybridMediaSessionTermination } from "../../shared/hybrid-media-session-termination.ts";
import type { createHybridMediaSessionRuntime } from "../../shared/hybrid-media-session-runtime.ts";
import type { createHybridMediaTopologyController } from "../../shared/hybrid-media-topology-controller.ts";
import type { createMediaSourceController } from "../../shared/media-source-controller.ts";
import type { createHybridMediaSessionApi } from "../../shared/hybrid-media-session-api.ts";
import type { createCloudflarePublicationRegistry } from "../../shared/cloudflare-publication-registry.ts";
import type { VideoPolicy } from "./video-settings.ts";
import type { Ref } from "vue";
import type { TopologyData } from "./topology-controller.ts";
import type { SignalingMessage } from "./media-signaling.ts";
import type { MediaCaptureManager } from "../../shared/media-capture.ts";
import type { RemoteMediaHandoff } from "../../shared/remote-media-handoff.ts";

export type HybridSessionDynamicFunction = (...args: unknown[]) => unknown;
export interface HybridMediaSessionApiContext {
  activeProviderState: Ref<unknown>;
  areTransportsIceConnected: HybridSessionDynamicFunction;
  connect: HybridSessionDynamicFunction;
  connected: Ref<unknown>;
  connectionPhase: Ref<unknown>;
  disconnect: HybridSessionDynamicFunction;
  echoDetected: Ref<unknown>;
  error: Ref<unknown>;
  getInboundRtpStats: HybridSessionDynamicFunction;
  getOutboundRtpStats: HybridSessionDynamicFunction;
  getVoiceTransportTimeout: HybridSessionDynamicFunction;
  getWebRTCDiagnosticStats: HybridSessionDynamicFunction;
  getWebRTCStatsSnapshot: HybridSessionDynamicFunction;
  iceConnectedBoth: Ref<unknown>;
  isProducing: Ref<unknown>;
  joinReady: Ref<unknown>;
  lastInRoom: Ref<unknown>;
  lastReceivedConsumerParams: HybridSessionDynamicFunction;
  lastSentClientRtpCapabilities: HybridSessionDynamicFunction;
  consumers: Ref<unknown>;
  lifecycle: Ref<unknown>;
  localVideoFeeds: Ref<unknown>;
  mediaConnectionState: Ref<unknown>;
  mediaCapabilities: Ref<unknown>;
  mediaPathMetrics: Ref<unknown>;
  microphoneDeviceState: Ref<unknown>;
  participantSfuRoundTripTimes: Ref<unknown>;
  peerConnectionMetrics: Ref<unknown>;
  peerRoundTripTimes: Ref<unknown>;
  playbackState: Ref<unknown>;
  prepareAudioPlayback: HybridSessionDynamicFunction;
  producers: Ref<unknown>;
  protocolState: Ref<unknown>;
  protocolUpdateRequired: Ref<unknown>;
  remoteAudioFeeds: Ref<unknown>;
  remoteProducersCount: Ref<unknown>;
  remoteVideoFeeds: Ref<unknown>;
  restartAudioProduction: HybridSessionDynamicFunction;
  sharedAudioAttenuation: Ref<unknown>;
  sharedAudioDucking: Ref<unknown>;
  sharedAudioStats: Ref<unknown>;
  sfuRoundTripTime: Ref<unknown>;
  sendParticipantVoiceState: HybridSessionDynamicFunction;
  setMediaCapabilities: HybridSessionDynamicFunction;
  setRemoteScreenReceiving: HybridSessionDynamicFunction;
  setRemoteSystemAudioReceiving: HybridSessionDynamicFunction;
  setSharedAudioAttenuation: HybridSessionDynamicFunction;
  setSharedAudioVolume: HybridSessionDynamicFunction;
  setSystemAudioBitrate: HybridSessionDynamicFunction;
  startAudioProduction: HybridSessionDynamicFunction;
  startSystemAudioProduction: HybridSessionDynamicFunction;
  startVideoProduction: HybridSessionDynamicFunction;
  stopAudioProduction: HybridSessionDynamicFunction;
  stopSystemAudioProduction: HybridSessionDynamicFunction;
  stopVideoProduction: HybridSessionDynamicFunction;
  topologyGraph: Ref<unknown>;
  topologyState: Ref<unknown>;
  transportReady: Ref<unknown>;
  applyOutputDeviceToAll: HybridSessionDynamicFunction;
  applyVolumeForTrack: HybridSessionDynamicFunction;
  applyVolumeForUser: HybridSessionDynamicFunction;
  ensureAudioElements: HybridSessionDynamicFunction;
}

export type HybridP2pMesh = InstanceType<typeof NativeP2pMesh>;
export type HybridSfuSession = InstanceType<typeof MediasoupClientSession>;
export type HybridProviderSocket = InstanceType<typeof MediasoupProviderSocket>;
export type HybridTopologyController = ReturnType<
  typeof createHybridMediaTopologyController
>;
export type HybridSessionLifecycle = ReturnType<
  typeof createHybridMediaSessionRuntime
>;
export type HybridSessionTermination = ReturnType<
  typeof createHybridMediaSessionTermination
>;
export type HybridSourceController = ReturnType<
  typeof createMediaSourceController
>;
export type HybridSessionApi = ReturnType<typeof createHybridMediaSessionApi>;
export type HybridPublicationRegistry = ReturnType<
  typeof createCloudflarePublicationRegistry
>;
export type HybridTopologyWaiter = (reason?: unknown) => void;
export type HybridTopologyState = ReturnType<
  typeof import("../../shared/media-session-state.ts").initialMediaTopologyState
> & { sourceRevision?: number };
export type HybridRoomRecord = {
  attenuation?: Record<string, unknown> | null;
};
export type HybridChannelRecord = {
  mediaPolicy?: VideoPolicy & { revision?: unknown } & Record<string, unknown>;
};
export type HybridTopologyPeer = { profile?: Record<string, unknown> };

export interface HybridSessionOperationsContext {
  getSignaling: () => { send: (message: SignalingMessage) => boolean };
  getTopologyController: () => {
    ensureP2p: () => unknown;
    ensureSfu: () => unknown;
    handleProviderFailure: (data?: Record<string, unknown>) => unknown;
    handleP2pQualification: (data?: Record<string, unknown>) => unknown;
    queueTopology: (data: TopologyData) => unknown;
    reportSfuFailure: (reason: string) => unknown;
  } | null;
  getSessionTermination: () => {
    failSession: (message: unknown) => unknown;
    disconnect: () => unknown;
  } | null;
  getSessionLifecycle: () => {
    connect: (channelId: string, options?: { roomId?: string }) => unknown;
    handleSignalingClose: (
      event: CloseEvent,
      protocolRejected: boolean,
    ) => unknown;
  } | null;
}

export interface HybridSessionTerminationContext {
  capture: MediaCaptureManager;
  clearAttenuation: () => unknown;
  closeMediaSessionTransports: (options: {
    capture: MediaCaptureManager;
    getP2pMesh: () => HybridP2pMesh | null;
    getSfu: () => HybridSfuSession | null;
    handoff: RemoteMediaHandoff;
    socket: WebSocket | null;
  }) => unknown;
  connected: Ref<boolean>;
  cancelConnect?: () => unknown;
  disposeVisibility: () => unknown;
  error: Ref<string | null>;
  handoff: RemoteMediaHandoff;
  iceConnectedBoth: Ref<boolean>;
  getP2pMesh: () => HybridP2pMesh | null;
  getProviderSocket: () => HybridProviderSocket | null;
  getSfu: () => HybridSfuSession | null;
  lifecycleState: {
    record: (phase: string, details?: Record<string, unknown>) => unknown;
  };
  mediaConnectionState: Ref<string>;
  mediaPathMetrics: Ref<unknown[]>;
  participantSfuRoundTripTimes: Ref<Record<string, unknown>>;
  peerConnectionMetrics: Ref<Record<string, unknown>>;
  peerRoundTripTimes: Ref<Record<string, unknown>>;
  playbackState: Ref<string>;
  protocolState: Ref<Record<string, unknown> | null>;
  protocolUpdateRequired: Ref<boolean>;
  refreshPublicMaps: () => unknown;
  refreshTopologyGraph: () => unknown;
  resetTopologySequencing: (reason?: string) => unknown;
  rtpStatsSamples: Map<string, unknown>;
  sfuRoundTripTime: Ref<number | null>;
  setActiveProvider: (provider: "p2p" | "sfu" | null) => unknown;
  setChannelId: (value: string | null) => unknown;
  setIntentionalClose: (value: boolean) => unknown;
  setLastP2pEdges: (value: unknown[]) => unknown;
  setP2pMesh: (value: HybridP2pMesh | null) => unknown;
  setProviderSocket: (value: HybridProviderSocket | null) => unknown;
  setSfu: (value: HybridSfuSession | null) => unknown;
  signaling: {
    getSocket: () => WebSocket | null;
    stop: () => unknown;
  };
  stopLocalVoiceDetection: () => unknown;
  stopSharedAudioMeter: () => unknown;
  resolveTopologyWaiter: (reason: unknown) => unknown;
  transportReady: Ref<boolean>;
}
