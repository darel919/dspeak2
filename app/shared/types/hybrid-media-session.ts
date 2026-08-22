import type { OwnedErrorValue } from "./shared-utilities.ts";
import type { ExternalValue } from "./boundary.ts";

import type { MediaCommandResult } from "./boundary.ts";

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
import type { WebRtcLatencyProfile } from "./web-rtc-latency.ts";
import type { WebMediaLatencyTier } from "./web-rtc-latency.ts";

export type HybridSessionDynamicFunction = (
  ...args: unknown[]
) => MediaCommandResult;
export interface HybridMediaSessionApiContext {
  activeProviderState: Ref<string | null>;
  areTransportsIceConnected: () => Promise<boolean>;
  connect: (
    channelId: string,
    options?: { roomId?: string },
  ) => MediaCommandResult;
  connected: Ref<boolean>;
  connectionPhase: Ref<string>;
  disconnect: () => MediaCommandResult;
  echoDetected: Ref<boolean>;
  error: Ref<string | null>;
  getInboundRtpStats: () => Promise<Array<Record<string, unknown>>>;
  getOutboundRtpStats: () => Promise<Array<Record<string, unknown>>>;
  getVoiceTransportTimeout: () => number;
  getWebRTCDiagnosticStats: () => Promise<Array<Record<string, unknown>>>;
  getWebRTCStatsSnapshot: () => Promise<RtcStatsSnapshot>;
  iceConnectedBoth: Ref<boolean>;
  isProducing: Ref<boolean>;
  joinReady: Ref<boolean>;
  lastInRoom: Ref<unknown>;
  lastReceivedConsumerParams: () => MediaCommandResult;
  lastSentClientRtpCapabilities: () => MediaCommandResult;
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
  prepareAudioPlayback: () => MediaCommandResult;
  producers: Ref<unknown>;
  protocolState: Ref<unknown>;
  protocolUpdateRequired: Ref<unknown>;
  requestedLatencyProfile: Ref<WebRtcLatencyProfile>;
  webMediaLatencyTier: Ref<WebMediaLatencyTier>;
  remoteAudioFeeds: Ref<Map<string, RemoteMediaEntry>>;
  remoteProducersCount: Ref<unknown>;
  remoteVideoFeeds: Ref<Map<string, RemoteMediaEntry>>;
  restartAudioProduction: () => MediaCommandResult;
  markRemoteFirstFrame: (
    key: string,
    receiverIncarnationId?: string | null,
    fallback?: boolean,
    observationMode?: Exclude<RemotePresentationObservationMode, "unavailable">,
  ) => MediaCommandResult;
  markRemoteFramePresented: (
    key: string,
    receiverIncarnationId?: string | null,
    observationMode?: Exclude<RemotePresentationObservationMode, "unavailable">,
  ) => MediaCommandResult;
  sharedAudioAttenuation: Ref<unknown>;
  sharedAudioDucking: Ref<unknown>;
  sharedAudioStats: Ref<unknown>;
  sfuRoundTripTime: Ref<unknown>;
  sendParticipantVoiceState: (state?: {
    muted?: boolean;
    deafened?: boolean;
  }) => MediaCommandResult;
  setMediaCapabilities: (value: ParticipantMediaCapabilities | null) => void;
  setRemoteScreenReceiving: (
    feedKey: string,
    receiving: boolean,
  ) => MediaCommandResult;
  setRemoteSystemAudioReceiving: (
    feedKey: string,
    receiving: boolean,
  ) => MediaCommandResult;
  setSharedAudioAttenuation: (
    speaking: boolean,
    attenuation?: {
      enabled?: boolean;
      reductionPercent?: number;
      attackMs?: number;
      releaseMs?: number;
    } | null,
  ) => MediaCommandResult;
  setSharedAudioVolume: (volume: number) => MediaCommandResult;
  setSystemAudioBitrate: (bitrate: number) => MediaCommandResult;
  startAudioProduction: () => Promise<MediaCommandResult>;
  startSystemAudioProduction: (
    options?: MediaCaptureStartOptions,
  ) => Promise<MediaCommandResult>;
  startVideoProduction: (
    source: "camera" | "screen",
    options?: MediaCaptureStartOptions,
  ) => Promise<MediaCommandResult>;
  stopAudioProduction: () => Promise<MediaCommandResult>;
  stopSystemAudioProduction: () => Promise<MediaCommandResult>;
  stopVideoProduction: (
    source: "camera" | "screen",
  ) => Promise<MediaCommandResult>;
  topologyGraph: Ref<unknown>;
  topologyState: Ref<unknown>;
  transportReady: Ref<boolean>;
  applyOutputDeviceToAll: () => MediaCommandResult;
  applyVolumeForTrack: (
    userId: string,
    source: string,
    volume: number,
  ) => MediaCommandResult;
  applyVolumeForUser: (userId: string, volume: number) => MediaCommandResult;
  ensureAudioElements: () => MediaCommandResult;
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
export type HybridTopologyWaiter = (reason?: OwnedErrorValue) => void;
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
    handleProviderFailure: (
      data?: Record<string, unknown>,
    ) => MediaCommandResult;
    handleP2pQualification: (
      data?: Record<string, unknown>,
    ) => MediaCommandResult;
    queueTopology: (data: TopologyData) => MediaCommandResult;
    reportSfuFailure: (reason: string) => MediaCommandResult;
  } | null;
  getSessionTermination: () => {
    failSession: (message: OwnedErrorValue) => MediaCommandResult;
    disconnect: () => MediaCommandResult;
  } | null;
  getSessionLifecycle: () => {
    connect: (
      channelId: string,
      options?: { roomId?: string },
    ) => MediaCommandResult;
    handleSignalingClose: (
      event: CloseEvent,
      protocolRejected: boolean,
    ) => MediaCommandResult;
  } | null;
}

export interface HybridSessionTerminationContext {
  capture: MediaCaptureManager;
  clearAttenuation: () => MediaCommandResult;
  closeMediaSessionTransports: (options: {
    capture: MediaCaptureManager;
    getP2pMesh: () => HybridP2pMesh | null;
    getSfu: () => HybridSfuSession | null;
    handoff: RemoteMediaHandoff;
    socket: WebSocket | null;
  }) => MediaCommandResult;
  connected: Ref<boolean>;
  cancelConnect?: () => MediaCommandResult;
  disposeVisibility: () => MediaCommandResult;
  error: Ref<string | null>;
  handoff: RemoteMediaHandoff;
  iceConnectedBoth: Ref<boolean>;
  getP2pMesh: () => HybridP2pMesh | null;
  getProviderSocket: () => HybridProviderSocket | null;
  getSfu: () => HybridSfuSession | null;
  lifecycleState: {
    record: (
      phase: string,
      details?: Record<string, unknown>,
    ) => MediaCommandResult;
  };
  mediaConnectionState: Ref<string>;
  mediaPathMetrics: Ref<unknown[]>;
  participantSfuRoundTripTimes: Ref<Record<string, unknown>>;
  peerConnectionMetrics: Ref<Record<string, unknown>>;
  peerRoundTripTimes: Ref<Record<string, unknown>>;
  playbackState: Ref<string>;
  protocolState: Ref<Record<string, unknown> | null>;
  protocolUpdateRequired: Ref<boolean>;
  refreshPublicMaps: () => MediaCommandResult;
  refreshTopologyGraph: () => MediaCommandResult;
  resetTopologySequencing: (reason?: string) => MediaCommandResult;
  rtpStatsSamples: Map<string, unknown>;
  sfuRoundTripTime: Ref<number | null>;
  setActiveProvider: (provider: "p2p" | "sfu" | null) => MediaCommandResult;
  setChannelId: (value: string | null) => MediaCommandResult;
  setIntentionalClose: (value: boolean) => MediaCommandResult;
  setLastP2pEdges: (value: ExternalValue[]) => MediaCommandResult;
  setP2pMesh: (value: HybridP2pMesh | null) => MediaCommandResult;
  setProviderSocket: (value: HybridProviderSocket | null) => MediaCommandResult;
  setSfu: (value: HybridSfuSession | null) => MediaCommandResult;
  sendLeave: () => MediaCommandResult;
  signaling: {
    getSocket: () => WebSocket | null;
    stop: () => MediaCommandResult;
  };
  stopLocalVoiceDetection: () => MediaCommandResult;
  stopSharedAudioMeter: () => MediaCommandResult;
  resolveTopologyWaiter: (reason: OwnedErrorValue) => MediaCommandResult;
  transportReady: Ref<boolean>;
}
