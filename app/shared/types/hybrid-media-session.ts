import type { NativeP2pMeshSurface } from "./native-p2p.ts";
import type { createHybridMediaSessionTermination } from "../../shared/hybrid-media-session-termination.ts";
import type { createHybridMediaSessionRuntime } from "../../shared/hybrid-media-session-runtime.ts";
import type { createHybridMediaTopologyController } from "../../shared/hybrid-media-topology-controller.ts";
import type { createMediaSourceController } from "../../shared/media-source-controller.ts";
import type { createHybridMediaSessionApi } from "../../shared/hybrid-media-session-api.ts";
import type { createCloudflarePublicationRegistry } from "../../shared/cloudflare-publication-registry.ts";
import type { VideoPolicy } from "./video-settings.ts";
import type { ParticipantMediaCapabilities } from "./video-codec-capabilities.ts";
import type { Ref } from "vue";
import type {
  TopologyData,
  TopologyProviderSocket,
  TopologySfuSession,
} from "./topology-controller.ts";
import type { SignalingMessage } from "./media-signaling.ts";
import type { MediaCaptureManager } from "../../shared/media-capture.ts";
import type { RemoteMediaHandoff } from "../../shared/remote-media-handoff.ts";
import type { MediaVideoFeed } from "./media-source-controller.ts";
import type { RemoteMediaEntry } from "./hybrid-media-registry.ts";
import type { RtcStatsSnapshot } from "./rtc-stats.ts";
import type { MediaCaptureStartOptions } from "./media-capture.ts";
import type { RemotePresentationObservationMode } from "../remote-source-convergence.ts";

export type HybridSessionDynamicFunction = (...args: unknown[]) => unknown;
export interface HybridMediaSessionApiContext {
  activeProviderState: Ref<string | null>;
  areTransportsIceConnected: () => Promise<boolean>;
  connect: (channelId: string, options?: { roomId?: string }) => unknown;
  connected: Ref<boolean>;
  connectionPhase: Ref<string>;
  disconnect: () => unknown;
  echoDetected: Ref<boolean>;
  error: Ref<string | null>;
  getInboundRtpStats: () => Promise<unknown>;
  getOutboundRtpStats: () => Promise<unknown>;
  getVoiceTransportTimeout: () => number;
  getWebRTCDiagnosticStats: () => Promise<unknown>;
  getWebRTCStatsSnapshot: () => Promise<RtcStatsSnapshot>;
  iceConnectedBoth: Ref<boolean>;
  isProducing: Ref<boolean>;
  joinReady: Ref<boolean>;
  lastInRoom: Ref<unknown>;
  lastReceivedConsumerParams: () => unknown;
  lastSentClientRtpCapabilities: () => unknown;
  consumers: Ref<unknown>;
  lifecycle: Ref<unknown>;
  localVideoFeeds: Ref<Map<string, MediaVideoFeed>>;
  mediaConnectionState: Ref<string>;
  mediaCapabilities: Ref<ParticipantMediaCapabilities | null>;
  mediaPathMetrics: Ref<unknown>;
  microphoneDeviceState: Ref<unknown>;
  participantSfuRoundTripTimes: Ref<unknown>;
  peerConnectionMetrics: Ref<unknown>;
  peerRoundTripTimes: Ref<unknown>;
  playbackState: Ref<unknown>;
  prepareAudioPlayback: () => unknown;
  producers: Ref<unknown>;
  protocolState: Ref<unknown>;
  protocolUpdateRequired: Ref<unknown>;
  remoteAudioFeeds: Ref<Map<string, RemoteMediaEntry>>;
  remoteProducersCount: Ref<unknown>;
  remoteVideoFeeds: Ref<Map<string, RemoteMediaEntry>>;
  restartAudioProduction: () => unknown;
  markRemoteFirstFrame: (
    key: string,
    receiverIncarnationId?: string | null,
    fallback?: boolean,
    observationMode?: Exclude<RemotePresentationObservationMode, "unavailable">,
  ) => unknown;
  markRemoteFramePresented: (
    key: string,
    receiverIncarnationId?: string | null,
    observationMode?: Exclude<RemotePresentationObservationMode, "unavailable">,
  ) => unknown;
  sharedAudioAttenuation: Ref<unknown>;
  sharedAudioDucking: Ref<unknown>;
  sharedAudioStats: Ref<unknown>;
  sfuRoundTripTime: Ref<unknown>;
  sendParticipantVoiceState: (state?: {
    muted?: boolean;
    deafened?: boolean;
  }) => unknown;
  setMediaCapabilities: (value: ParticipantMediaCapabilities | null) => void;
  setRemoteScreenReceiving: (feedKey: string, receiving: boolean) => unknown;
  setRemoteSystemAudioReceiving: (
    feedKey: string,
    receiving: boolean,
  ) => unknown;
  setSharedAudioAttenuation: (
    speaking: boolean,
    attenuation?: {
      enabled?: boolean;
      reductionPercent?: number;
      attackMs?: number;
      releaseMs?: number;
    } | null,
  ) => unknown;
  setSharedAudioVolume: (volume: number) => unknown;
  setSystemAudioBitrate: (bitrate: number) => unknown;
  startAudioProduction: () => Promise<unknown>;
  startSystemAudioProduction: (
    options?: MediaCaptureStartOptions,
  ) => Promise<unknown>;
  startVideoProduction: (
    source: "camera" | "screen",
    options?: MediaCaptureStartOptions,
  ) => Promise<unknown>;
  stopAudioProduction: () => Promise<unknown>;
  stopSystemAudioProduction: () => Promise<unknown>;
  stopVideoProduction: (source: "camera" | "screen") => Promise<unknown>;
  topologyGraph: Ref<unknown>;
  topologyState: Ref<unknown>;
  transportReady: Ref<boolean>;
  applyOutputDeviceToAll: () => unknown;
  applyVolumeForTrack: (
    userId: string,
    source: string,
    volume: number,
  ) => unknown;
  applyVolumeForUser: (userId: string, volume: number) => unknown;
  ensureAudioElements: () => unknown;
}

export type HybridP2pMesh = NativeP2pMeshSurface;
export type HybridSfuSession = TopologySfuSession;
export type HybridProviderSocket = TopologyProviderSocket;
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
    ensureP2p: () => HybridP2pMesh | null;
    ensureSfu: () => HybridSfuSession | null;
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
  sendLeave: () => unknown;
  signaling: {
    getSocket: () => WebSocket | null;
    stop: () => unknown;
  };
  stopLocalVoiceDetection: () => unknown;
  stopSharedAudioMeter: () => unknown;
  resolveTopologyWaiter: (reason: unknown) => unknown;
  transportReady: Ref<boolean>;
}
