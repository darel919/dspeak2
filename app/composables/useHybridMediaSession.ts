import { computed, getCurrentScope, onScopeDispose, ref, watch } from "vue";
import { useRuntimeConfig } from "#app";
import { MediaCaptureManager } from "~/shared/media-capture.ts";
import { MediasoupClientSession } from "~/shared/mediasoup-client-session.ts";
import { MediasoupProviderSocket } from "~/shared/mediasoup-provider-socket.ts";
import { CloudflareRealtimeSession } from "~/shared/cloudflare-realtime-session.ts";
import { createCloudflarePublicationRegistry } from "~/shared/cloudflare-publication-registry.ts";
import { NativeP2pMesh } from "~/shared/native-p2p.ts";
import { createHybridMediaRegistry } from "~/shared/hybrid-media-registry.ts";
import { createHybridMediaAudioState } from "~/shared/hybrid-media-audio-state.ts";
import { RemoteMediaHandoff } from "~/shared/remote-media-handoff.ts";
import { createHybridMediaTopologyController } from "~/shared/hybrid-media-topology-controller.ts";
import { createHybridMediaSessionTermination } from "~/shared/hybrid-media-session-termination.ts";
import {
  createHybridMediaDiagnostics,
  mediaReadinessSnapshot,
} from "~/shared/hybrid-media-diagnostics.ts";
import { createLocalAudioEngine } from "~/shared/local-audio-engine.ts";
import { registerEchoWarning } from "~/shared/echo-warning.ts";
import {
  buildMediaControlSocketUrl,
  getMediaControlBootstrap,
  getOrCreateDeviceId,
} from "~/shared/media-control-client.ts";
import {
  closeMediaProviders,
  closeMediaSessionTransports,
  handleMediaSignalingClose,
  resetMediaTelemetryState,
} from "~/shared/media-session-cleanup.ts";
import {
  createMediaGeneration,
  initialMediaTopologyState,
} from "~/shared/media-session-state.ts";
import { createMediaTopologyView } from "~/shared/media-topology-view.ts";
import { createMediaLifecycleState } from "~/shared/media-lifecycle-trace.ts";
import { createMediaAudioPolicy } from "~/shared/media-audio-policy.ts";
import { setupMediaMessageHandlers } from "~/shared/media-message-handlers.ts";
import { createHybridMediaSignaling } from "~/shared/hybrid-media-signaling.ts";
import { createMediaSourceController } from "~/shared/media-source-controller.ts";
import { createHybridMediaSessionApi } from "~/shared/hybrid-media-session-api.ts";
import { createHybridMediaSessionRuntime } from "~/shared/hybrid-media-session-runtime.ts";
import { createHybridMediaSessionOperations } from "~/shared/hybrid-media-session-operations.ts";
import { bindMediaVisibility } from "~/shared/media-visibility.ts";
import {
  buildMediaAttenuationWatchKey,
  createMediaAttenuationReporter,
  resolveMediaAttenuation,
} from "~/shared/media-attenuation-reporter.ts";
import { addressFamily, buildTopologyGraph } from "~/shared/rtc-topology.ts";
import {
  collectOutboundAudioStats,
  collectRtpStats,
} from "~/shared/rtc-media-stats.ts";
import type { RtpStatsSample } from "~/shared/rtc-media-stats.ts";
import { hasUsableVoiceRoute } from "~/shared/voice-join-readiness.ts";
import { createProviderRecoveryState } from "~/shared/media-provider-recovery.ts";
import {
  buildP2pVideoSenderOptions,
  resolveRequestedVideoSettings,
} from "~/shared/video-settings.ts";
import { MEDIA_TIMING } from "~/const/media.ts";
import {
  buildVoiceProducerOptions,
  mapPeerConnectionMetrics,
  mapPeerRoundTripTimes,
} from "~/shared/voice-transport.ts";
import {
  shouldAcceptTopologyEvent,
  topologyEventKey,
} from "~~/server/utils/media-transition.ts";
import { MEDIA_SIGNALING_CLIENT_PROTOCOL } from "~~/shared/media-signaling-protocol.ts";
import { useAuthStore } from "~/stores/auth";
import { getSupabaseClient } from "~/utils/supabase-client";
import { useChannelsStore } from "~/stores/channels";
import { useSettingsStore } from "~/stores/settings";
import { useRoomsStore } from "~/stores/rooms";
import { useVoiceStore } from "~/stores/voice";
import {
  automaticGateThreshold,
  createNoiseFloorEstimator,
  microphoneLevelDb,
  updateNoiseFloor,
} from "~/shared/microphone-gate.ts";
import type { MediaVideoFeed } from "~/shared/types/media-source-controller.ts";
import type { RemoteMediaEntry } from "~/shared/types/hybrid-media-registry.ts";
import type {
  HybridP2pMesh,
  HybridChannelRecord,
  HybridRoomRecord,
  HybridProviderSocket,
  HybridSessionLifecycle,
  HybridSessionTermination,
  HybridSourceController,
  HybridSfuSession,
  HybridTopologyController,
  HybridTopologyState,
  HybridTopologyPeer,
  HybridTopologyWaiter,
} from "~/shared/types/hybrid-media-session.ts";
import type { RuntimeDependencyContext } from "~/shared/types/hybrid-media-session-lifecycle.ts";
import type { HybridMediaSessionApiContext } from "~/shared/types/hybrid-media-session.ts";
import type {
  TopologyData,
  TopologyP2pMesh,
  TopologySfuSession,
  TopologySourceEntry,
  TopologyState,
} from "~/shared/types/topology-controller.ts";
import type { VideoSettings } from "~/shared/types/video-settings.ts";
import type { ParticipantMediaCapabilities } from "~/shared/types/video-codec-capabilities.ts";
export function useHybridMediaSession() {
  const runtimeConfig = useRuntimeConfig();
  const authStore = useAuthStore();
  const channelsStore = useChannelsStore();
  const settingsStore = useSettingsStore();
  const roomsStore = useRoomsStore();
  const voiceStore = useVoiceStore();
  const connected = ref(false);
  const error = ref<string | null>(null);
  const transportReady = ref(false);
  const iceConnectedBoth = ref(false);
  const mediaConnectionState = ref<string>("disconnected");
  const mediaCapabilities = ref<ParticipantMediaCapabilities | null>(null);
  const protocolUpdateRequired = ref(false);
  const protocolState = ref<Record<string, unknown> | null>(null);
  const playbackState = ref("idle");
  const microphoneDeviceState = ref("preferred");
  const localVideoFeeds = ref<Map<string, MediaVideoFeed>>(new Map());
  const remoteVideoFeeds = ref<Map<string, RemoteMediaEntry>>(new Map());
  const remoteAudioFeeds = ref<Map<string, RemoteMediaEntry>>(new Map());
  const lastInRoom = ref<string[]>([]);
  const remoteProducersCount = ref(0);
  const sharedAudioStats = ref({ kbps: 0, level: 0, dbfs: -60 });
  const echoDetected = ref(false);
  const attenuationReports = ref<Map<string, unknown>>(new Map());
  const peerRoundTripTimes = ref<Record<string, unknown>>({});
  const peerConnectionMetrics = ref<Record<string, unknown>>({});
  const mediaPathMetrics = ref<unknown[]>([]);
  const sfuRoundTripTime = ref<number | null>(null);
  const currentJitterBufferConfig = ref({ minDelayMs: 0, targetDelayMs: 20 });
  const participantSfuRoundTripTimes = ref<Record<string, unknown>>({});
  const activeProviderState = ref<string | null>(null);
  const topologyState = ref<HybridTopologyState>(initialMediaTopologyState());
  const lastAppliedRoomRevision = ref("0");
  let sessionConnectionEpoch = 1;
  const topologyGraph = ref(
    buildTopologyGraph({ mode: "idle", participantIds: [] }),
  );
  const producers = ref<Map<string, unknown>>(new Map());
  const consumers = ref<Map<string, unknown>>(new Map());
  const messageHandlers = new Map<string, (...args: unknown[]) => void>();
  const localSources = new Map<string, TopologySourceEntry>();
  let channelId: string | null = null;
  const mediaControlSocketUrlState = ref<string | null>(null);
  const mediaControlTicketState = ref<string | null>(null);
  let localPeerId: string | null = null;
  let iceServers: unknown[] = [];
  let p2pMesh: HybridP2pMesh | null = null;
  let sfu: HybridSfuSession | null = null;
  let providerSocket: HybridProviderSocket | null = null;
  let selectedSfuProvider = "mediasoup";
  const cloudflarePublications = createCloudflarePublicationRegistry();
  let activeProvider: "sfu" | "p2p" | null = null;
  let intentionalClose = false;
  let topologyWaiter: HybridTopologyWaiter | null = null;
  let lastP2pEdges: unknown[] = [];
  const rtpStatsSamples = new Map<string, RtpStatsSample>();
  const reportedSfuFailureState = ref<string | null>(null);
  let topologyController: HybridTopologyController | null = null;
  let sessionLifecycle: HybridSessionLifecycle | null = null;
  let sessionTermination: HybridSessionTermination | null = null;
  const lifecycleState = createMediaLifecycleState();
  const mediaGeneration = createMediaGeneration();
  const setConnectionPhase = lifecycleState.record;
  const providerRecovery = createProviderRecoveryState({
    error,
    transportReady,
    mediaConnectionState,
    setConnectionPhase,
  });
  const { getAudioStereo, getEffectiveAudioBitrate } = createMediaAudioPolicy({
    channelsStore,
    settingsStore,
    voiceStore,
  });
  const sessionOperations = createHybridMediaSessionOperations({
    getSignaling: () => signaling,
    getTopologyController: () => topologyController,
    getSessionTermination: () => sessionTermination,
    getSessionLifecycle: () => sessionLifecycle,
  });
  const {
    connect,
    disconnect,
    ensureP2p,
    ensureSfu,
    failSession,
    handleP2pQualification,
    handleProviderFailure,
    handleSignalingClose,
    queueTopology,
    reportSfuFailure,
    send,
  } = sessionOperations;
  const signaling = createHybridMediaSignaling({
    buildClientHelloData: ({ mediaSessionId }: { mediaSessionId: string }) => ({
      mediaSessionId,
      connectionEpoch: sessionConnectionEpoch,
      lastAppliedRoomRevision: lastAppliedRoomRevision.value,
      providerCapabilities: ["cloudflare-realtime", "mediasoup"],
      ...(mediaCapabilities.value
        ? {
            mediaCapabilities: mediaCapabilities.value,
            capabilityProtocol: "video-codec-matrix-v1",
          }
        : {}),
      ...(mediaControlTicketState.value
        ? { ticket: mediaControlTicketState.value }
        : {}),
    }),
    buildHeartbeatData: (sequence: number) => ({
      sequence,
      connectionEpoch: sessionConnectionEpoch,
      topologyEpoch: topologyState.value.epoch,
      sourceRevision: topologyState.value.sourceRevision || 0,
      lastAppliedRoomRevision: lastAppliedRoomRevision.value,
      localSourceDigest: sourceController.getSourceFsmDigest(),
    }),
    buildUrl: () => {
      if (!mediaControlSocketUrlState.value)
        throw new Error("Media control bootstrap is required");
      return mediaControlSocketUrlState.value;
    },
    connectionTimeoutMs: MEDIA_TIMING.connectionTimeoutMs,
    defaultHeartbeatIntervalMs: MEDIA_TIMING.heartbeatIntervalMs,
    defaultHeartbeatTimeoutMs: MEDIA_TIMING.heartbeatTimeoutMs,
    getHandler: (type: string) => messageHandlers.get(type),
    isIntentionalClose: () => intentionalClose,
    onClose: handleSignalingClose,
    onError: (signalingError: unknown) => {
      error.value =
        signalingError instanceof Error
          ? signalingError.message
          : String(signalingError);
    },
    onOpen: () => setConnectionPhase("protocol-negotiating"),
    onProtocolRejected: (event: CloseEvent) => {
      protocolUpdateRequired.value = true;
      error.value = event.reason || "Media client update required";
      setConnectionPhase("failed", {
        code: String(event.code),
        reason: error.value,
      });
    },
    onReconnect: async () => {
      setConnectionPhase("reconnecting");
      if (mediaConnectionState.value === "recovering") {
        const live = activeProvider === "sfu" ? sfu : p2pMesh;
        mediaConnectionState.value = live
          ? "media-flowing"
          : "ready-no-active-media";
      }
      await sessionLifecycle?.refreshControlTicket?.();
    },
    onFailure: (message: unknown) => sessionOperations.failSession(message),
    protocol: MEDIA_SIGNALING_CLIENT_PROTOCOL,
  });
  const joinReady = computed(() =>
    hasUsableVoiceRoute({
      activeProvider,
      p2pReady: p2pMesh?.isMediaReady() === true,
      sfuReady:
        typeof sfu?.connectionState === "function" &&
        sfu.connectionState().ready === true,
      signalingConnected: connected.value,
      topologyMode: topologyState.value.mode,
      transportReady: transportReady.value,
    }),
  );
  const {
    getAttenuation,
    setRouteConnectionState,
    sharedAudioAttenuation,
    sharedAudioDucking,
  } = createHybridMediaAudioState({
    attenuationReports,
    getRoomAttenuation: () =>
      voiceStore.currentRoomId
        ? (
            roomsStore.getRoomById(voiceStore.currentRoomId) as
              HybridRoomRecord | null | undefined
          )?.attenuation
        : undefined,
    getStreamAttenuation: () => settingsStore.streamAttenuation,
    getPeers: () => topologyState.value.peers,
    getLocalPeerId: () => localPeerId,
    mediaConnectionState,
    playbackState,
  });
  const registry = createHybridMediaRegistry({
    audioFeeds: remoteAudioFeeds,
    videoFeeds: remoteVideoFeeds,
    getAttenuation,
    voiceStore,
    settingsStore,
    getActiveProvider: () => activeProvider,
    getSfu: () => sfu,
    getP2pMesh: () => p2pMesh,
    error,
    playbackState,
    mediaConnectionState,
    iceConnectedBoth,
    setConnectionPhase,
    getAttenuationReporter: () => attenuationReporter,
  });
  let disposeVisibility: (() => void) | null = null;
  if (import.meta.client) {
    disposeVisibility = bindMediaVisibility(registry);
    if (getCurrentScope()) onScopeDispose(disposeVisibility);
  }
  const attenuationReporter = createMediaAttenuationReporter({
    getLocalPeerId: () => localPeerId,
    getPeers: () => topologyState.value.peers,
    onReportsChange: (reports: Map<string, unknown>) =>
      (attenuationReports.value = reports),
    send,
  });
  let sourceController: HybridSourceController;
  const capture = new MediaCaptureManager({
    getSettings: () => settingsStore,
    getAudioStereo,
    onMicrophoneFallback: () => {
      microphoneDeviceState.value = "fallback";
    },
    onMicrophoneRestored: () => {
      microphoneDeviceState.value = "preferred";
      if (error.value === "Unable to restore microphone capture")
        error.value = null;
    },
    onSource: (entry: TopologySourceEntry) =>
      sourceController.publishSource(entry),
    onSourceEnded: (
      entry: TopologySourceEntry,
      options: Record<string, unknown> = {},
    ) => sourceController.removeSource(entry, options),
  });
  const handoff = new RemoteMediaHandoff(registry);
  function setActiveProvider(provider: "sfu" | "p2p" | null) {
    if (provider !== activeProvider) {
      if (activeProvider === "sfu" && sfu) {
        sfu.setJitterBufferConfig({ minDelayMs: 0, targetDelayMs: 20 });
      } else if (activeProvider === "p2p" && p2pMesh) {
        p2pMesh.setJitterBufferConfig({ minDelayMs: 0, targetDelayMs: 20 });
      }
      currentJitterBufferConfig.value = { minDelayMs: 0, targetDelayMs: 20 };
    }
    activeProvider = provider;
    activeProviderState.value = provider;
    if (provider) topologyController?.applyAdaptiveJitterBuffer();
  }
  function resetTopologySequencing(reason = "reconnecting") {
    topologyController?.reset();
    localPeerId = null;
    lastP2pEdges = [];
    rtpStatsSamples.clear();
    providerRecovery.reset();
    topologyState.value = initialMediaTopologyState(reason);
    attenuationReporter.clear();
  }
  function getRequestedVideoSettings(source: string) {
    const policy = voiceStore.currentChannelId
      ? (
          channelsStore.getChannelById(voiceStore.currentChannelId) as
            HybridChannelRecord | null | undefined
        )?.mediaPolicy
      : null;
    return resolveRequestedVideoSettings({
      policy,
      settings: settingsStore,
      source,
    });
  }
  const {
    createSharedAudioSource,
    producerFacade,
    refreshAudioSenderSettings,
    refreshMediaPolicy,
    setSharedAudioVolume,
    setSharedAudioAttenuation,
    setSystemAudioBitrate,
    startLocalVoiceDetection,
    startSharedAudioMeter,
    stopLocalVoiceDetection,
    stopSharedAudioMeter,
  } = createLocalAudioEngine({
    authStore,
    automaticGateThreshold,
    capture,
    collectOutboundAudioStats,
    createNoiseFloorEstimator,
    getActiveProvider: () => activeProvider,
    getAttenuation,
    getAudioStereo,
    getEffectiveAudioBitrate,
    getP2pMesh: () => p2pMesh,
    getRequestedVideoSettings: (source: string): VideoSettings =>
      getRequestedVideoSettings(source),
    getSfu: () => sfu,
    localSources,
    echoDetected,
    microphoneLevelDb,
    onSpeakingChange: (userId: string, speaking: boolean) =>
      registry.setExternalSpeaking(userId, speaking),
    settingsStore,
    sharedAudioDucking,
    sharedAudioStats,
    updateNoiseFloor,
    voiceStore,
  });
  watch(
    () =>
      buildMediaAttenuationWatchKey({
        roomAttenuation: voiceStore.currentRoomId
          ? (
              roomsStore.getRoomById(voiceStore.currentRoomId) as
                HybridRoomRecord | null | undefined
            )?.attenuation
          : undefined,
        streamAttenuation: settingsStore.streamAttenuation,
        speaking: [...voiceStore.connectedUsers.values()].some(
          (participant) => participant.speaking === true,
        ),
      }),
    () => {
      const speaking = [...voiceStore.connectedUsers.values()].some(
        (participant) => participant.speaking === true,
      );
      registry.applyAttenuation();
      setSharedAudioAttenuation(
        speaking,
        resolveMediaAttenuation(
          voiceStore.currentRoomId
            ? (
                roomsStore.getRoomById(voiceStore.currentRoomId) as
                  HybridRoomRecord | null | undefined
              )?.attenuation
            : undefined,
          settingsStore.streamAttenuation,
        ),
      );
    },
    { immediate: true },
  );
  registerEchoWarning(echoDetected);
  watch(
    () =>
      (
        channelsStore.getChannelById(voiceStore.currentChannelId) as
          HybridChannelRecord | null | undefined
      )?.mediaPolicy?.revision,
    () => {
      if (connected.value)
        refreshMediaPolicy().catch((policyError: unknown) => {
          error.value = `Media policy could not be fully applied: ${String(policyError)}`;
        });
    },
  );
  const {
    refreshPublicMaps,
    refreshTopologyGraph,
    syncConnectedUsers,
    updateP2pStats,
  } = createMediaTopologyView({
    activeProvider: () => activeProvider,
    addressFamily,
    buildTopologyGraph,
    consumers,
    getParticipantProfile: (userId: string) =>
      channelsStore.getVoiceProfile(userId),
    getLocalPeerId: () => localPeerId,
    getP2pEdges: () => lastP2pEdges,
    getP2pMesh: () => p2pMesh,
    getSfu: () => sfu,
    mapPeerConnectionMetrics,
    mapPeerRoundTripTimes,
    mediaPathMetrics,
    participantSfuRoundTripTimes,
    peerConnectionMetrics,
    peerRoundTripTimes,
    producers,
    setP2pEdges: (edges: unknown[]) => {
      lastP2pEdges = edges;
    },
    topologyGraph,
    topologyState,
    voiceStore,
  });
  sourceController = createMediaSourceController({
    capture,
    connected,
    createSharedAudioSource,
    error,
    getActiveProvider: () => activeProvider,
    getConnectionEpoch: () => sessionConnectionEpoch,
    getIntentionalClose: () => intentionalClose,
    getLastAppliedRoomRevision: () => lastAppliedRoomRevision.value,
    getP2pMesh: () => p2pMesh,
    getSfu: () => sfu,
    getVideoReport: (source: string) => {
      if (activeProvider === "sfu") {
        const report = sfu?.producers.get(source)?.producer.getStats();
        return report
          ? Promise.resolve(report).then(
              (value) =>
                value as unknown as Map<string, Record<string, unknown>>,
            )
          : Promise.resolve(null);
      }
      if (activeProvider === "p2p")
        return p2pMesh
          ? p2pMesh
              .getOutboundTrackStats(source)
              .then(
                (report) =>
                  report as unknown as Map<string, Record<string, unknown>>,
              )
          : Promise.resolve(null);
      return Promise.resolve(null);
    },
    getVideoSettings: (source: string) => getRequestedVideoSettings(source),
    localSources,
    localVideoFeeds,
    onSharedAudioStopped: attenuationReporter.clear,
    producerFacade,
    refreshMediaPolicy: async () => {
      await refreshMediaPolicy();
    },
    refreshPublicMaps,
    reportSfuFailure,
    send,
    startLocalVoiceDetection,
    startSharedAudioMeter,
    stopLocalVoiceDetection,
    stopSharedAudioMeter,
    topologyState,
    voiceStore,
  });
  const {
    restartAudioProduction,
    sendParticipantVoiceState,
    resolveOperationAck,
    rejectOperationAck,
    startAudioProduction,
    startSystemAudioProduction,
    startVideoProduction,
    stopAudioProduction,
    stopSystemAudioProduction,
    stopVideoProduction,
  } = sourceController;
  function applyRoomRevision(roomRevision: string) {
    if (BigInt(roomRevision) > BigInt(lastAppliedRoomRevision.value))
      lastAppliedRoomRevision.value = roomRevision;
  }
  function requestSnapshot() {
    send({
      type: "request-snapshot",
      data: { connectionEpoch: sessionConnectionEpoch },
    });
  }
  const {
    getInboundRtpStats,
    getOutboundRtpStats,
    getWebRTCDiagnosticStats,
    getWebRTCStatsSnapshot,
    sfuProducerIds,
  } = createHybridMediaDiagnostics({
    collectRtpStats,
    getActiveProvider: () => activeProvider,
    getActiveRouteProvider: () => selectedSfuProvider,
    getAudioLatencySnapshot: () => registry.getAudioLatencySnapshot(),
    getP2pMesh: () => p2pMesh,
    getRequestedVideoSettings,
    getSfu: () => sfu,
    localSources,
    playbackState,
    peerRoundTripTimes,
    refreshTopologyGraph,
    remoteAudioFeeds,
    remoteVideoFeeds,
    send,
    sfuRoundTripTime,
    topologyGraph,
    topologyState,
    updateP2pStats,
    rtpStatsSamples,
    getLifecycle: lifecycleState.snapshot,
    getProtocolState: () => protocolState.value,
    getReadiness: () =>
      mediaReadinessSnapshot({
        connected: connected.value,
        mediaConnectionState: mediaConnectionState.value,
        playbackState: playbackState.value,
        topologyState: topologyState.value,
        transportReady: transportReady.value,
      }),
  });
  sessionTermination = createHybridMediaSessionTermination({
    capture,
    clearAttenuation: attenuationReporter.clear,
    closeMediaSessionTransports,
    connected,
    cancelConnect: () => sessionLifecycle?.cancel?.(),
    disposeVisibility: () => {
      disposeVisibility?.();
      disposeVisibility = null;
    },
    error,
    getP2pMesh: () => p2pMesh,
    getProviderSocket: () => providerSocket,
    getSfu: () => sfu,
    handoff,
    iceConnectedBoth,
    lifecycleState,
    mediaConnectionState,
    mediaPathMetrics,
    participantSfuRoundTripTimes,
    peerConnectionMetrics,
    peerRoundTripTimes,
    playbackState,
    protocolState,
    protocolUpdateRequired,
    refreshPublicMaps,
    refreshTopologyGraph,
    resetTopologySequencing,
    rtpStatsSamples,
    sfuRoundTripTime,
    setActiveProvider: (provider: "p2p" | "sfu" | null) =>
      setActiveProvider(provider),
    setChannelId: (value: string | null) => {
      channelId = value;
    },
    setIntentionalClose: (value: boolean) => {
      intentionalClose = value;
    },
    setLastP2pEdges: (value: unknown[]) => {
      lastP2pEdges = value;
    },
    setP2pMesh: (value: HybridP2pMesh | null) => {
      p2pMesh = value;
    },
    setProviderSocket: (value: HybridProviderSocket | null) => {
      providerSocket = value;
    },
    sendLeave: () => sourceController.leave(),
    setSfu: (value: HybridSfuSession | null) => {
      sfu = value;
    },
    signaling,
    stopLocalVoiceDetection,
    stopSharedAudioMeter,
    resolveTopologyWaiter: (reason: unknown) => {
      topologyWaiter?.(reason);
      topologyWaiter = null;
    },
    transportReady,
  });
  topologyController = createHybridMediaTopologyController({
    CloudflareRealtimeSession,
    MediasoupClientSession,
    MediasoupProviderSocket,
    NativeP2pMesh,
    buildP2pVideoSenderOptions,
    buildVoiceProducerOptions,
    closeSocket: () => providerSocket?.close(),
    currentJitterBufferConfig,
    error,
    failSession,
    getActiveProvider: () => activeProvider,
    getAudioStereo,
    getEffectiveAudioBitrate,
    getIceServers: () => iceServers,
    getMediaCapabilities: () => mediaCapabilities.value,
    getLocalPeerId: () => localPeerId,
    getMessageHandler: (type: string) => messageHandlers.get(type),
    getProviderSocket: () => providerSocket,
    getRequestedVideoSettings,
    getSelectedSfuProvider: () => selectedSfuProvider,
    getSfu: () => sfu as unknown as TopologySfuSession | null,
    getP2pMesh: () => p2pMesh as unknown as TopologyP2pMesh | null,
    handoff,
    iceConnectedBoth,
    localSources,
    mediaConnectionState,
    mediaGeneration,
    mediaReadinessPollMs: MEDIA_TIMING.readinessPollMs,
    mediaHandoffTimeoutMs: MEDIA_TIMING.handoffTimeoutMs,
    onP2pQualification: (data: Record<string, unknown>) =>
      voiceStore.setP2pQualification?.(data),
    onRemotePublication: () => cloudflarePublications.values(),
    onTopologyStateUpdated: (
      data: TopologyData,
      nextTopologyState: TopologyState,
    ) => {
      for (const peer of nextTopologyState.peers as HybridTopologyPeer[]) {
        const profileId = peer.profile?.id;
        if (peer.profile && profileId != null)
          voiceStore.upsertUserProfile({
            ...peer.profile,
            id: String(profileId),
          });
      }
      attenuationReporter.prune();
      topologyWaiter?.();
      topologyWaiter = null;
      if (data.mode === "idle") {
        remoteProducersCount.value = 0;
        peerRoundTripTimes.value = {};
        peerConnectionMetrics.value = {};
        mediaPathMetrics.value = [];
        sfuRoundTripTime.value = null;
        currentJitterBufferConfig.value = { minDelayMs: 0, targetDelayMs: 20 };
        participantSfuRoundTripTimes.value = {};
      }
    },
    peerConnectionMetrics,
    refreshPublicMaps,
    refreshTopologyGraph,
    reportedSfuFailureState,
    send,
    sfuRoundTripTime,
    setActiveProvider,
    setP2pMesh: (mesh: TopologyP2pMesh | null) => {
      p2pMesh = mesh as unknown as HybridP2pMesh | null;
    },
    setProviderSocket: (socket) => {
      providerSocket = socket as HybridProviderSocket | null;
    },
    setSelectedSfuProvider: (provider: string) => {
      selectedSfuProvider = provider;
    },
    setSfu: (session) => {
      sfu = session as HybridSfuSession | null;
    },
    setConnectionPhase,
    setRouteConnectionState,
    shouldAcceptTopologyEvent,
    topologyEventKey,
    topologyState,
    transportReady,
    updateP2pStats,
    waitForMediaTimeoutMs: providerRecovery.timeout,
  });
  sessionLifecycle = createHybridMediaSessionRuntime({
    authStore,
    buildMediaControlSocketUrl,
    channelsStore,
    connected,
    error,
    getIntentionalClose: () => intentionalClose,
    getMediaControlUrl: () => runtimeConfig.public.mediaControlUrl,
    getRoomId: () => voiceStore.currentRoomId,
    getSfu: () => sfu,
    getSupabaseClient,
    handleMediaSignalingClose,
    handoff,
    iceConnectedBoth,
    lastInRoom,
    mediaConnectionState,
    mediaControlApiPath: runtimeConfig.public.apiPath,
    mediaControlTicketState,
    mediaControlSocketUrlState,
    messageHandlers,
    participantSfuRoundTripTimes,
    protocolState,
    protocolUpdateRequired,
    providerRecovery,
    queueTopology,
    remoteProducersCount,
    resetMediaTelemetryState,
    resetTopologySequencing,
    runtimeConnectionTimeoutMs: MEDIA_TIMING.connectionTimeoutMs,
    setActiveProvider,
    setChannelId: (value: string | null) => {
      channelId = value;
    },
    setConnectionPhase,
    setIceServers: (value: unknown[]) => {
      iceServers = value;
    },
    setIntentionalClose: (value: boolean) => {
      intentionalClose = value;
    },
    setLocalPeerId: (value: string | null) => {
      localPeerId = value;
    },
    setMediaControlSocketUrl: (value: string | null) => {
      mediaControlSocketUrlState.value = value;
    },
    setMediaControlTicket: (value: string | null) => {
      mediaControlTicketState.value = value;
    },
    setP2pMesh: (value: HybridP2pMesh | null) => {
      p2pMesh = value;
    },
    setSfu: (value: HybridSfuSession | null) => {
      sfu = value;
    },
    signaling,
    syncConnectedUsers,
    topologyState,
    transportReady,
    voiceStore,
    closeProviders: closeMediaProviders,
    ensureP2p,
    ensureSfu,
    getChannelId: () => channelId,
    getDeviceId: getOrCreateDeviceId,
    getP2pMesh: () => p2pMesh,
    getBootstrap: getMediaControlBootstrap,
    handleP2pQualification,
    handleProviderFailure,
    handleProviderRecovering: (data: Record<string, unknown>) =>
      topologyController?.handleProviderRecovering(data),
    handleProviderTicket: (data: Record<string, unknown>) =>
      topologyController?.handleProviderTicket(data),
    mediaPathMetrics,
    peerConnectionMetrics,
    peerRoundTripTimes,
    sfuRoundTripTime,
    receiveAttenuation: attenuationReporter.receive,
    resetLifecycle: lifecycleState.reset,
    resolveTopologyWaiter: (reason: unknown) => {
      topologyWaiter?.(reason);
      topologyWaiter = null;
    },
    sfuProducerIds,
    sendParticipantVoiceState,
    sendSourceState: () => sourceController.sendSourceState(),
    resolveOperationAck,
    rejectOperationAck,
    getConnectionEpoch: () => sessionConnectionEpoch,
    getLastAppliedRoomRevision: () => lastAppliedRoomRevision.value,
    applyRoomRevision,
    requestSnapshot,
    setTopologyWaiter: (waiter: ((error?: unknown) => void) | null) => {
      topologyWaiter = waiter;
    },
    setupMessageHandlers: setupMediaMessageHandlers,
    queueCloudflarePublication: (data: Record<string, unknown>) =>
      cloudflarePublications.update(data),
  } as unknown as RuntimeDependencyContext);
  watch(
    () => [peerConnectionMetrics.value, sfuRoundTripTime.value],
    () => {
      topologyController?.applyAdaptiveJitterBuffer();
    },
    { deep: true, immediate: false },
  );
  return createHybridMediaSessionApi({
    activeProviderState,
    areTransportsIceConnected: () => Promise.resolve(iceConnectedBoth.value),
    connect,
    connected,
    connectionPhase: lifecycleState.phase,
    consumers,
    disconnect,
    echoDetected,
    error,
    getInboundRtpStats,
    getOutboundRtpStats,
    getVoiceTransportTimeout: providerRecovery.timeout,
    getWebRTCDiagnosticStats,
    getWebRTCStatsSnapshot,
    iceConnectedBoth,
    isProducing: computed(() => localSources.size > 0),
    joinReady,
    lastInRoom,
    lastReceivedConsumerParams: () => sfu?.lastReceivedConsumerParams || null,
    lastSentClientRtpCapabilities: () =>
      sfu?.lastSentClientRtpCapabilities || null,
    lifecycle: lifecycleState.lifecycle,
    localVideoFeeds,
    mediaConnectionState,
    mediaCapabilities,
    mediaPathMetrics,
    microphoneDeviceState,
    participantSfuRoundTripTimes,
    peerConnectionMetrics,
    peerRoundTripTimes,
    playbackState,
    prepareAudioPlayback: () => registry.preparePlayback(),
    producers,
    protocolState,
    protocolUpdateRequired,
    remoteAudioFeeds,
    remoteProducersCount,
    remoteVideoFeeds,
    restartAudioProduction,
    sharedAudioAttenuation,
    sharedAudioDucking,
    sharedAudioStats,
    sfuRoundTripTime,
    sendParticipantVoiceState,
    setMediaCapabilities: (value: unknown) => {
      mediaCapabilities.value = value as ParticipantMediaCapabilities | null;
    },
    setRemoteScreenReceiving: (feedKey: string, receiving: boolean) =>
      registry.setVideoReceiving(feedKey, receiving),
    setRemoteSystemAudioReceiving: (key: string, on: boolean) =>
      registry.setAudioReceiving(key, on),
    setSharedAudioAttenuation,
    setSharedAudioVolume,
    setSystemAudioBitrate,
    startAudioProduction,
    startSystemAudioProduction,
    startVideoProduction,
    stopAudioProduction,
    stopSystemAudioProduction,
    stopVideoProduction,
    topologyGraph,
    topologyState,
    transportReady,
    applyOutputDeviceToAll: () => registry.applyOutputDevice(),
    applyVolumeForUser: (userId: string, volume: number) =>
      registry.applyVolume(userId, "", volume),
    applyVolumeForTrack: (userId: string, source: string, volume: number) =>
      registry.applyVolume(userId, source, volume),
    ensureAudioElements: () => registry.ensurePlayback(),
  } as unknown as HybridMediaSessionApiContext);
}
