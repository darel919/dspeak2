import { computed, getCurrentScope, onScopeDispose, ref, watch } from "vue";
import { useRuntimeConfig } from "#app";
import { MediaCaptureManager } from "~/shared/media-capture.js";
import { MediasoupClientSession } from "~/shared/mediasoup-client-session.js";
import { MediasoupProviderSocket } from "~/shared/mediasoup-provider-socket.js";
import { CloudflareRealtimeSession } from "~/shared/cloudflare-realtime-session.js";
import { NativeP2pMesh } from "~/shared/native-p2p.js";
import { createHybridMediaRegistry } from "~/shared/hybrid-media-registry.js";
import { createHybridMediaAudioState } from "~/shared/hybrid-media-audio-state.js";
import { RemoteMediaHandoff } from "~/shared/remote-media-handoff.js";
import { createHybridMediaTopologyController } from "~/shared/hybrid-media-topology-controller.js";
import { createHybridMediaSessionTermination } from "~/shared/hybrid-media-session-termination.js";
import {
  createHybridMediaDiagnostics,
  mediaReadinessSnapshot,
} from "~/shared/hybrid-media-diagnostics.js";
import { createLocalAudioEngine } from "~/shared/local-audio-engine.js";
import { registerEchoWarning } from "~/shared/echo-warning.js";
import {
  buildMediaControlSocketUrl,
  getMediaControlBootstrap,
  getOrCreateDeviceId,
} from "~/shared/media-control-client.js";
import {
  closeMediaProviders,
  closeMediaSessionTransports,
  handleMediaSignalingClose,
  resetMediaTelemetryState,
} from "~/shared/media-session-cleanup.js";
import {
  createMediaGeneration,
  initialMediaTopologyState,
} from "~/shared/media-session-state.js";
import { createMediaTopologyView } from "~/shared/media-topology-view.js";
import { createMediaLifecycleState } from "~/shared/media-lifecycle-trace.js";
import { createMediaAudioPolicy } from "~/shared/media-audio-policy.js";
import { setupMediaMessageHandlers } from "~/shared/media-message-handlers.js";
import { createHybridMediaSignaling } from "~/shared/hybrid-media-signaling.js";
import { createMediaSourceController } from "~/shared/media-source-controller.js";
import { createHybridMediaSessionApi } from "~/shared/hybrid-media-session-api.js";
import { createHybridMediaSessionRuntime } from "~/shared/hybrid-media-session-runtime.js";
import { createHybridMediaSessionOperations } from "~/shared/hybrid-media-session-operations.js";
import { bindMediaVisibility } from "~/shared/media-visibility.js";
import {
  createMediaAttenuationReporter,
  resolveMediaAttenuation,
} from "~/shared/media-attenuation-reporter.js";
import { addressFamily, buildTopologyGraph } from "~/shared/rtc-topology.js";
import {
  collectOutboundAudioStats,
  collectRtpStats,
} from "~/shared/rtc-media-stats.js";
import { hasUsableVoiceRoute } from "~/shared/voice-join-readiness.js";
import { createProviderRecoveryState } from "~/shared/media-provider-recovery.js";
import {
  buildP2pVideoSenderOptions,
  resolveRequestedVideoSettings,
} from "~/shared/video-settings.js";
import { MEDIA_TIMING } from "~/const/media.js";
import {
  buildVoiceProducerOptions,
  mapPeerConnectionMetrics,
  mapPeerRoundTripTimes,
} from "~/shared/voice-transport.js";
import {
  matchesPreparedActivation,
  shouldAcceptTopologyEvent,
  topologyEventKey,
} from "~~/server/utils/media-transition.js";
import { MEDIA_SIGNALING_CLIENT_PROTOCOL } from "~~/shared/media-signaling-protocol.js";
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
} from "~/shared/microphone-gate.js";
export function useHybridMediaSession() {
  const runtimeConfig = useRuntimeConfig();
  const authStore = useAuthStore();
  const channelsStore = useChannelsStore();
  const settingsStore = useSettingsStore();
  const roomsStore = useRoomsStore();
  const voiceStore = useVoiceStore();
  const connected = ref(false);
  const error = ref(null);
  const transportReady = ref(false);
  const iceConnectedBoth = ref(false);
  const mediaConnectionState = ref("disconnected");
  const protocolUpdateRequired = ref(false);
  const protocolState = ref(null);
  const playbackState = ref("idle");
  const microphoneDeviceState = ref("preferred");
  const localVideoFeeds = ref(new Map());
  const remoteVideoFeeds = ref(new Map());
  const remoteAudioFeeds = ref(new Map());
  const lastInRoom = ref([]);
  const remoteProducersCount = ref(0);
  const sharedAudioStats = ref({ kbps: 0, level: 0, dbfs: -60 });
  const echoDetected = ref(false);
  const attenuationReports = ref(new Map());
  const peerRoundTripTimes = ref({});
  const peerConnectionMetrics = ref({});
  const mediaPathMetrics = ref([]);
  const sfuRoundTripTime = ref(null);
  const currentJitterBufferConfig = ref({ minDelayMs: 0, targetDelayMs: 20 });
  const participantSfuRoundTripTimes = ref({});
  const activeProviderState = ref(null);
  const topologyState = ref(initialMediaTopologyState());
  const topologyGraph = ref(
    buildTopologyGraph({ mode: "idle", participantIds: [] }),
  );
  const producers = ref(new Map());
  const consumers = ref(new Map());
  const messageHandlers = new Map();
  const localSources = new Map();
  let channelId = null;
  const mediaControlSocketUrlState = ref(null);
  const mediaControlTicketState = ref(null);
  let localPeerId = null;
  let iceServers = [];
  let p2pMesh = null;
  let sfu = null;
  let providerSocket = null;
  let selectedSfuProvider = "mediasoup";
  const pendingCloudflarePublications = [];
  let activeProvider = null;
  let intentionalClose = false;
  let topologyWaiter = null;
  let lastP2pEdges = [];
  const rtpStatsSamples = new Map();
  const reportedSfuFailureState = ref(null);
  let topologyController = null;
  let sessionLifecycle = null;
  let sessionTermination = null;
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
    buildClientHelloData: ({ mediaSessionId }) => ({
      mediaSessionId,
      providerCapabilities: ["cloudflare-realtime", "mediasoup"],
      ...(mediaControlTicketState.value
        ? { ticket: mediaControlTicketState.value }
        : {}),
    }),
    buildHeartbeatData: (sequence) => ({
      sequence,
      topologyEpoch: topologyState.value.epoch,
      sourceRevision: topologyState.value.sourceRevision || 0,
    }),
    buildUrl: () => {
      if (!mediaControlSocketUrlState.value)
        throw new Error("Media control bootstrap is required");
      return mediaControlSocketUrlState.value;
    },
    connectionTimeoutMs: MEDIA_TIMING.connectionTimeoutMs,
    defaultHeartbeatIntervalMs: MEDIA_TIMING.heartbeatIntervalMs,
    defaultHeartbeatTimeoutMs: MEDIA_TIMING.heartbeatTimeoutMs,
    getHandler: (type) => messageHandlers.get(type),
    isIntentionalClose: () => intentionalClose,
    onClose: handleSignalingClose,
    onError: (signalingError) => (error.value = signalingError.message),
    onOpen: () => setConnectionPhase("protocol-negotiating"),
    onProtocolRejected: (event) => {
      protocolUpdateRequired.value = true;
      error.value = event.reason || "Media client update required";
      setConnectionPhase("failed", {
        code: event.code,
        reason: error.value,
      });
    },
    onReconnect: () => {
      setConnectionPhase("reconnecting");
      if (mediaConnectionState.value === "recovering") {
        const live = activeProvider === "sfu" ? sfu : p2pMesh;
        mediaConnectionState.value = live
          ? "media-flowing"
          : "ready-no-active-media";
      }
    },
    onFailure: (message) => sessionOperations.failSession(message),
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
      roomsStore.getRoomById(voiceStore.currentRoomId)?.attenuation,
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
    getSfu: () => sfu,
    getP2pMesh: () => p2pMesh,
    error,
    playbackState,
    mediaConnectionState,
    iceConnectedBoth,
    setConnectionPhase,
    getAttenuationReporter: () => attenuationReporter,
  });
  let disposeVisibility = null;
  if (import.meta.client) {
    disposeVisibility = bindMediaVisibility(registry);
    if (getCurrentScope()) onScopeDispose(disposeVisibility);
  }
  const attenuationReporter = createMediaAttenuationReporter({
    getLocalPeerId: () => localPeerId,
    getPeers: () => topologyState.value.peers,
    onReportsChange: (reports) => (attenuationReports.value = reports),
    send,
  });
  let sourceController;
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
    onSource: (entry) => sourceController.publishSource(entry),
    onSourceEnded: (entry, options) =>
      sourceController.removeSource(entry, options),
  });
  const handoff = new RemoteMediaHandoff(registry);
  function setActiveProvider(provider) {
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
  function getRequestedVideoSettings(source) {
    const policy = voiceStore.currentChannelId
      ? channelsStore.getChannelById(voiceStore.currentChannelId)?.mediaPolicy
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
    getRequestedVideoSettings,
    getSfu: () => sfu,
    localSources,
    echoDetected,
    microphoneLevelDb,
    onSpeakingChange: (userId, speaking) =>
      registry.setExternalSpeaking(userId, speaking),
    settingsStore,
    sharedAudioDucking,
    sharedAudioStats,
    updateNoiseFloor,
    voiceStore,
  });
  watch(
    () => [
      settingsStore.streamAttenuation,
      roomsStore.getRoomById(voiceStore.currentRoomId)?.attenuation,
      [...voiceStore.connectedUsers.values()].some(
        (participant) => participant.speaking === true,
      ),
    ],
    () => {
      const speaking = [...voiceStore.connectedUsers.values()].some(
        (participant) => participant.speaking === true,
      );
      registry.applyAttenuation();
      setSharedAudioAttenuation(
        speaking,
        resolveMediaAttenuation(
          roomsStore.getRoomById(voiceStore.currentRoomId)?.attenuation,
          { mode: "inherit" },
        ),
      );
    },
    { deep: true, immediate: true },
  );
  registerEchoWarning(echoDetected);
  watch(
    () =>
      channelsStore.getChannelById(voiceStore.currentChannelId)?.mediaPolicy
        ?.revision,
    () => {
      if (connected.value)
        refreshMediaPolicy().catch((policyError) => {
          error.value = `Media policy could not be fully applied: ${policyError.message}`;
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
    setP2pEdges: (edges) => {
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
    getIntentionalClose: () => intentionalClose,
    getP2pMesh: () => p2pMesh,
    getSfu: () => sfu,
    getVideoReport: (source) => {
      if (activeProvider === "sfu")
        return sfu?.producers.get(source)?.producer.getStats() || null;
      if (activeProvider === "p2p")
        return p2pMesh?.getOutboundTrackStats(source) || null;
      return null;
    },
    getVideoSettings: getRequestedVideoSettings,
    localSources,
    localVideoFeeds,
    onSharedAudioStopped: attenuationReporter.clear,
    producerFacade,
    refreshMediaPolicy,
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
    startAudioProduction,
    startSystemAudioProduction,
    startVideoProduction,
    stopAudioProduction,
    stopSystemAudioProduction,
    stopVideoProduction,
  } = sourceController;
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
    setActiveProvider,
    setChannelId: (value) => {
      channelId = value;
    },
    setIntentionalClose: (value) => {
      intentionalClose = value;
    },
    setLastP2pEdges: (value) => {
      lastP2pEdges = value;
    },
    setP2pMesh: (value) => {
      p2pMesh = value;
    },
    setProviderSocket: (value) => {
      providerSocket = value;
    },
    setSfu: (value) => {
      sfu = value;
    },
    signaling,
    stopLocalVoiceDetection,
    stopSharedAudioMeter,
    resolveTopologyWaiter: (reason) => {
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
    getLocalPeerId: () => localPeerId,
    getMessageHandler: (type) => messageHandlers.get(type),
    getProviderSocket: () => providerSocket,
    getRequestedVideoSettings,
    getSelectedSfuProvider: () => selectedSfuProvider,
    getSfu: () => sfu,
    getP2pMesh: () => p2pMesh,
    handoff,
    iceConnectedBoth,
    localSources,
    mediaConnectionState,
    mediaGeneration,
    mediaReadinessPollMs: MEDIA_TIMING.readinessPollMs,
    mediaHandoffTimeoutMs: MEDIA_TIMING.handoffTimeoutMs,
    matchesPreparedActivation,
    onP2pQualification: (data) => voiceStore.setP2pQualification?.(data),
    onRemotePublication: () => pendingCloudflarePublications.splice(0),
    onTopologyStateUpdated: (data, nextTopologyState) => {
      for (const peer of nextTopologyState.peers)
        if (peer.profile) voiceStore.upsertUserProfile(peer.profile);
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
    setP2pMesh: (mesh) => {
      p2pMesh = mesh;
    },
    setProviderSocket: (socket) => {
      providerSocket = socket;
    },
    setSelectedSfuProvider: (provider) => {
      selectedSfuProvider = provider;
    },
    setSfu: (session) => {
      sfu = session;
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
    setChannelId: (value) => {
      channelId = value;
    },
    setConnectionPhase,
    setIceServers: (value) => {
      iceServers = value;
    },
    setIntentionalClose: (value) => {
      intentionalClose = value;
    },
    setLocalPeerId: (value) => {
      localPeerId = value;
    },
    setMediaControlSocketUrl: (value) => {
      mediaControlSocketUrlState.value = value;
    },
    setMediaControlTicket: (value) => {
      mediaControlTicketState.value = value;
    },
    setP2pMesh: (value) => {
      p2pMesh = value;
    },
    setSfu: (value) => {
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
    handleProviderTicket: (data) =>
      topologyController?.handleProviderTicket(data),
    mediaPathMetrics,
    peerConnectionMetrics,
    peerRoundTripTimes,
    receiveAttenuation: attenuationReporter.receive,
    resetLifecycle: lifecycleState.reset,
    resolveTopologyWaiter: (reason) => {
      topologyWaiter?.(reason);
      topologyWaiter = null;
    },
    sfuProducerIds,
    sendParticipantVoiceState,
    sendSourceState: () => sourceController.sendSourceState(),
    setTopologyWaiter: (waiter) => {
      topologyWaiter = waiter;
    },
    setupMessageHandlers: setupMediaMessageHandlers,
    queueCloudflarePublication: (data) =>
      pendingCloudflarePublications.push(data),
  });
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
    setRemoteScreenReceiving: (feedKey, receiving) =>
      registry.setVideoReceiving(feedKey, receiving),
    setRemoteSystemAudioReceiving: (key, on) =>
      registry.setAudioReceiving(key, on),
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
    applyVolumeForUser: (userId, volume) =>
      registry.applyVolume(userId, null, volume),
    applyVolumeForTrack: (userId, source, volume) =>
      registry.applyVolume(userId, source, volume),
    ensureAudioElements: () => registry.ensurePlayback(),
  });
}
