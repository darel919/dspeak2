import { computed, readonly, ref, watch } from "vue";
import { useRuntimeConfig } from "#app";
import { MediaCaptureManager } from "~/shared/media-capture.js";
import { MediasoupClientSession } from "~/shared/mediasoup-client-session.js";
import { NativeP2pMesh } from "~/shared/native-p2p.js";
import { RemoteMediaRegistry } from "~/shared/remote-media-registry.js";
import { RemoteMediaHandoff } from "~/shared/remote-media-handoff.js";
import {
  createHybridMediaDiagnostics,
  mediaReadinessSnapshot,
} from "~/shared/hybrid-media-diagnostics.js";
import { createLocalAudioEngine } from "~/shared/local-audio-engine.js";
import { registerEchoWarning } from "~/shared/echo-warning.js";
import {
  closeMediaProviders,
  closeMediaSessionTransports,
} from "~/shared/media-session-cleanup.js";
import {
  createMediaGeneration,
  initialMediaTopologyState,
} from "~/shared/media-session-state.js";
import { createMediaTopologyView } from "~/shared/media-topology-view.js";
import { createMediaLifecycleState } from "~/shared/media-lifecycle-trace.js";
import { createMediaAudioPolicy } from "~/shared/media-audio-policy.js";
import { setupMediaMessageHandlers } from "~/shared/media-message-handlers.js";
import {
  createMediaSignalingSocket,
  dispatchMediaSignalingMessage,
} from "~/shared/media-signaling-socket.js";
import { createMediaSourceController } from "~/shared/media-source-controller.js";
import { bindMediaVisibility } from "~/shared/media-visibility.js";
import {
  createMediaAttenuationReporter,
  resolveMediaAttenuation,
  summarizeMediaAttenuation,
} from "~/shared/media-attenuation-reporter.js";
import {
  waitForInitialMediaTopology,
  waitForMediaHandoff,
} from "~/shared/media-handoff-readiness.js";
import { addressFamily, buildTopologyGraph } from "~/shared/rtc-topology.js";
import {
  collectOutboundAudioStats,
  collectRtpStats,
} from "~/shared/rtc-media-stats.js";
import { hasUsableVoiceRoute } from "~/shared/voice-join-readiness.js";
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
  const sfuRoundTripTime = ref(null);
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
  let localPeerId = null;
  let iceServers = [];
  let p2pMesh = null;
  let sfu = null;
  let activeProvider = null;
  let intentionalClose = false;
  let topologyWaiter = null;
  let topologyOperation = Promise.resolve();
  let pendingTopologyKey = null;
  let appliedTopologyKey = null;
  let highestQueuedEpoch = 0;
  let lastP2pEdges = [];
  let latestTopologyKey = null;
  let reportedSfuFailureEpoch = null;
  let preparedTransition = null;
  const rtpStatsSamples = new Map();
  const lifecycleState = createMediaLifecycleState();
  const mediaGeneration = createMediaGeneration();
  const connectionPhase = lifecycleState.phase;
  const lifecycle = lifecycleState.lifecycle;
  const setConnectionPhase = lifecycleState.record;
  const { getAudioStereo, getEffectiveAudioBitrate } = createMediaAudioPolicy({
    channelsStore,
    settingsStore,
    voiceStore,
  });
  const signaling = createMediaSignalingSocket({
    buildHeartbeatData: (sequence) => ({
      sequence,
      topologyEpoch: topologyState.value.epoch,
      sourceRevision: topologyState.value.sourceRevision || 0,
    }),
    buildUrl: () => {
      const origin = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
      const base = runtimeConfig.public.sfuPath || `${origin}/socket`;
      return `${base}?channelId=${encodeURIComponent(channelId)}`;
    },
    connectionTimeoutMs: MEDIA_TIMING.connectionTimeoutMs,
    defaultHeartbeatIntervalMs: MEDIA_TIMING.heartbeatIntervalMs,
    defaultHeartbeatTimeoutMs: MEDIA_TIMING.heartbeatTimeoutMs,
    handleMessage: (raw) =>
      dispatchMediaSignalingMessage(raw, {
        getHandler: (type) => messageHandlers.get(type),
        onFailure: failSession,
      }),
    isIntentionalClose: () => intentionalClose,
    onClose: handleSignalingClose,
    onError: (signalingError) => {
      error.value = signalingError.message;
    },
    onOpen: () => setConnectionPhase("protocol-negotiating"),
    onProtocolRejected: (event) => {
      protocolUpdateRequired.value = true;
      error.value = event.reason || "Media client update required";
      setConnectionPhase("failed", {
        code: event.code,
        reason: error.value,
      });
    },
    onReconnect: () => setConnectionPhase("reconnecting"),
    protocol: MEDIA_SIGNALING_CLIENT_PROTOCOL,
  });
  const joinReady = computed(() =>
    hasUsableVoiceRoute({
      activeProvider,
      p2pReady: p2pMesh?.isMediaReady() === true,
      sfuReady: sfu?.connectionState().ready === true,
      signalingConnected: connected.value,
      topologyMode: topologyState.value.mode,
      transportReady: transportReady.value,
    }),
  );
  const getAttenuation = () =>
    resolveMediaAttenuation(
      roomsStore.getRoomById(voiceStore.currentRoomId)?.attenuation,
      settingsStore.streamAttenuation,
    );
  const registry = new RemoteMediaRegistry({
    audioFeeds: remoteAudioFeeds,
    videoFeeds: remoteVideoFeeds,
    getVolume: (userId, source) => voiceStore.getTrackVolume(userId, source),
    getOutputDevice: () => settingsStore.outputDeviceId,
    isDeafened: () => voiceStore.deafened,
    isBroadcastMode: () => settingsStore.broadcastMode,
    isAnyoneSpeaking: () =>
      [...voiceStore.connectedUsers.values()].some(
        (participant) => participant.speaking === true,
      ),
    onSpeaking: (userId, speaking) =>
      voiceStore.updateUserSpeaking(userId, speaking),
    getAttenuation,
    onVideoReceivingChange: (entry, receiving) => {
      if (entry.provider === "sfu")
        sfu
          ?.setRemoteReceiving(entry.userId, entry.source, receiving)
          .catch((receivingError) => {
            error.value =
              receivingError.message || "Remote media state change failed";
          });
      if (entry.provider === "p2p")
        p2pMesh?.setRemoteReceiving(entry.peerId, entry.source, receiving);
    },
    onPlaybackState: ({ state }) => {
      playbackState.value = state;
      if (state === "blocked" || state === "output-blocked") {
        mediaConnectionState.value = "playback-blocked";
        setConnectionPhase("playback-blocked", { reason: state });
        iceConnectedBoth.value = false;
      } else if (
        state === "ready" &&
        mediaConnectionState.value === "playback-blocked"
      ) {
        const readiness = sfu?.connectionState();
        mediaConnectionState.value = readiness?.ready
          ? "media-flowing"
          : "transport-connecting";
      }
    },
    onEffectiveGain: (state) => attenuationReporter.report(state),
  });
  if (import.meta.client) onScopeDispose(bindMediaVisibility(registry));
  const attenuationReporter = createMediaAttenuationReporter({
    getLocalPeerId: () => localPeerId,
    getPeers: () => topologyState.value.peers,
    onReportsChange: (reports) => (attenuationReports.value = reports),
    send,
  });
  const sharedAudioAttenuation = computed(() =>
    summarizeMediaAttenuation(
      attenuationReports.value,
      topologyState.value.peers,
      localPeerId,
    ),
  );
  const sharedAudioDucking = ref({ active: false, effectivePercent: 100 });
  function setRouteConnectionState(state) {
    mediaConnectionState.value =
      playbackState.value === "blocked" ||
      playbackState.value === "output-blocked"
        ? "playback-blocked"
        : state;
  }
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
    activeProvider = provider;
    activeProviderState.value = provider;
  }
  function send(message) {
    return signaling.send(message);
  }
  async function connect(nextChannelId) {
    if (connected.value && channelId === nextChannelId) return;
    intentionalClose = false;
    protocolUpdateRequired.value = false;
    channelId = nextChannelId;
    error.value = null;
    lifecycleState.reset();
    setConnectionPhase("socket-connecting");
    const nextIceServers = await $fetch(
      `${runtimeConfig.public.apiPath}/config`,
    );
    if (!Array.isArray(nextIceServers))
      throw new Error("The ICE server configuration is invalid");
    iceServers = nextIceServers;
    setupHandlers();
    await openSocket();
    await waitForInitialTopology();
  }
  function openSocket() {
    const userId = authStore.getUserData()?.id;
    if (!userId) return Promise.reject(new Error("User not authenticated"));
    if (!channelId) return Promise.reject(new Error("Channel ID is required"));
    return signaling.open();
  }
  function handleSignalingClose(event, protocolRejected) {
    connected.value = false;
    protocolState.value = null;
    if (intentionalClose) return;
    closeMediaProviders({
      getP2pMesh: () => p2pMesh,
      getSfu: () => sfu,
      handoff,
    });
    p2pMesh = null;
    sfu = null;
    setActiveProvider(null);
    transportReady.value = false;
    iceConnectedBoth.value = false;
    remoteProducersCount.value = 0;
    peerRoundTripTimes.value = {};
    peerConnectionMetrics.value = {};
    sfuRoundTripTime.value = null;
    participantSfuRoundTripTimes.value = {};
    resetTopologySequencing();
    if (!protocolRejected)
      setConnectionPhase("reconnecting", {
        code: event.code,
        reason: event.reason || "signaling-closed",
      });
  }
  function waitForInitialTopology() {
    return waitForInitialMediaTopology({
      isReady: () => topologyState.value.epoch > 0,
      setWaiter: (waiter) => {
        topologyWaiter = waiter;
      },
      timeoutMs: MEDIA_TIMING.connectionTimeoutMs,
    });
  }
  function resetTopologySequencing(reason = "reconnecting") {
    mediaGeneration.retire();
    pendingTopologyKey = null;
    appliedTopologyKey = null;
    latestTopologyKey = null;
    highestQueuedEpoch = 0;
    topologyOperation = Promise.resolve();
    topologyState.value = {
      mode: "idle",
      epoch: 0,
      reason,
      peers: [],
      activatedAt: null,
    };
    attenuationReporter.clear();
  }
  function setupHandlers() {
    if (messageHandlers.size) return;
    setupMediaMessageHandlers({
      ensureP2p,
      getHeartbeatSequence: signaling.getHeartbeatSequence,
      getLastHeartbeatAckSequence: signaling.getLastHeartbeatAckSequence,
      getSfu: ensureSfu,
      getSocket: signaling.getSocket,
      lastInRoom,
      participantSfuRoundTripTimes,
      queueTopology,
      registerHandler: (type, handler) => messageHandlers.set(type, handler),
      remoteProducersCount,
      onServerConnected: () => {
        if (signaling.markReady()) {
          connected.value = true;
          setConnectionPhase("signaling-ready", {
            mediaSessionId: protocolState.value?.mediaSessionId,
            protocolVersion: protocolState.value?.protocolVersion,
          });
        }
        sourceController.sendSourceState();
        sendParticipantVoiceState();
      },
      onServerHello: (data) => {
        if (signaling.acceptServerHello(data))
          protocolState.value = signaling.getProtocolState();
      },
      onAttenuationState: attenuationReporter.receive,
      setHeartbeatAck: signaling.acknowledgeHeartbeat,
      setLocalPeerId: (peerId) => {
        localPeerId = peerId;
      },
      sfuProducerIds,
      syncConnectedUsers,
      voiceStore,
    });
  }
  function ensureP2p() {
    if (p2pMesh || typeof RTCPeerConnection === "undefined") return p2pMesh;
    p2pMesh = new NativeP2pMesh({
      iceServers,
      sendSignal: (payload) => {
        if (payload.type === "ready")
          send({ type: "p2p-ready", data: payload });
        else send({ type: "p2p-signal", data: payload });
      },
      onRemoteTrack: (entry) =>
        handoff.stage({ ...entry, provider: "p2p" }, activeProvider),
      onRemoteTrackEnded: (entry) =>
        handoff.remove({ ...entry, provider: "p2p" }),
      onFailure: (failure) => send({ type: "p2p-failed", data: failure }),
      onSnapshot: updateP2pStats,
      getAudioStereo,
      getSenderOptions: (source, track) => {
        if (track.kind === "audio") {
          const options = buildVoiceProducerOptions(
            track,
            getEffectiveAudioBitrate(source),
            getAudioStereo(source),
          );
          return { encodings: options.encodings };
        }
        const settings = track.getSettings?.() || {};
        const options = buildP2pVideoSenderOptions({
          width: settings.width,
          height: settings.height,
          frameRate: getRequestedVideoSettings(source).frameRate,
          qualityPriority: getRequestedVideoSettings(source).qualityPriority,
          screen: source === "screen",
        });
        const ceiling = getRequestedVideoSettings(source).maxBitrate;
        if (ceiling && options.encodings?.[0])
          options.encodings[0].maxBitrate = Math.min(
            options.encodings[0].maxBitrate || ceiling,
            ceiling,
          );
        return options;
      },
    });
    return p2pMesh;
  }
  function queueTopology(data) {
    setConnectionPhase("topology-selecting", {
      topologyEpoch: Number(data.epoch) || 0,
      topologyMode: data.mode || null,
      sourceRevision: Number(data.sourceRevision) || 0,
    });
    const epoch = Number(data.epoch);
    if (!shouldAcceptTopologyEvent(data, highestQueuedEpoch))
      return topologyOperation;
    highestQueuedEpoch = Math.max(highestQueuedEpoch, epoch);
    const key = topologyEventKey(data);
    latestTopologyKey = key;
    if (key === appliedTopologyKey || key === pendingTopologyKey)
      return topologyOperation;
    pendingTopologyKey = key;
    const generation = mediaGeneration.capture();
    topologyOperation = topologyOperation
      .catch(() => {})
      .then(() => applyTopology(data, generation))
      .then(() => {
        appliedTopologyKey = key;
      })
      .catch((topologyError) => handleTopologyFailure(data, topologyError))
      .finally(() => {
        if (pendingTopologyKey === key) pendingTopologyKey = null;
      });
    return topologyOperation;
  }
  function ensureSfu() {
    if (sfu) return sfu;
    sfu = new MediasoupClientSession({
      send,
      iceServers,
      onRemoteTrack: (entry) => handoff.stage(entry, activeProvider),
      onRemoteTrackEnded: (entry) => handoff.remove(entry),
      onStateChange: (_, state, summary) => {
        if (topologyState.value.mode !== "sfu") return;
        if (state === "failed" || state === "closed") {
          mediaConnectionState.value = "failed";
          setConnectionPhase("failed", {
            direction: _,
            reason: `transport-${state}`,
          });
          reportSfuFailure("media-transport-failed");
          return;
        }
        transportReady.value = summary.ready;
        iceConnectedBoth.value =
          summary.sendRequired &&
          summary.receiveRequired &&
          summary.send === "connected" &&
          summary.recv === "connected";
        setRouteConnectionState(
          summary.ready
            ? summary.sendRequired || summary.receiveRequired
              ? "transport-connected"
              : "ready-no-active-media"
            : state === "disconnected"
              ? "reconnecting"
              : "transport-connecting",
        );
        setConnectionPhase(
          summary.ready ? "media-ready" : "transport-connecting",
          { direction: _, topologyMode: "sfu" },
        );
      },
      getAudioBitrate: getEffectiveAudioBitrate,
      getAudioStereo,
      getVideoSettings: getRequestedVideoSettings,
    });
    return sfu;
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
  async function applyTopology(data, generation) {
    mediaGeneration.assert(generation);
    if (Number(data.epoch) < topologyState.value.epoch) return;
    for (const peer of Array.isArray(data.peers) ? data.peers : [])
      if (peer.profile) voiceStore.upsertUserProfile(peer.profile);
    const previousProvider = activeProvider;
    topologyState.value = {
      mode: data.mode,
      epoch: Number(data.epoch),
      reason: data.reason || null,
      transitionFailure: data.transitionFailure || null,
      target: data.target || (data.mode === "probing" ? "p2p" : null),
      sourceRevision: Number(data.sourceRevision) || 0,
      preparedEpoch: Number.isInteger(Number(data.preparedEpoch))
        ? Number(data.preparedEpoch)
        : null,
      peers: Array.isArray(data.peers) ? data.peers : [],
      activatedAt: data.activatedAt || Date.now(),
      displayMode:
        data.mode === "probing" && previousProvider ? "switching" : null,
    };
    handoff.pruneExpectedFeeds(topologyState.value.peers, localPeerId);
    attenuationReporter.prune();
    topologyWaiter?.();
    if (data.mode === activeProvider) {
      await updateActiveTopology(data, generation);
      return;
    }
    if (data.mode === "idle") {
      setActiveProvider(null);
      p2pMesh?.closeAll();
      p2pMesh = null;
      sfu?.closeMedia();
      handoff.clear();
      preparedTransition = null;
      remoteProducersCount.value = 0;
      peerRoundTripTimes.value = {};
      peerConnectionMetrics.value = {};
      sfuRoundTripTime.value = null;
      participantSfuRoundTripTimes.value = {};
      transportReady.value = true;
      iceConnectedBoth.value = false;
      mediaConnectionState.value = "ready-no-active-media";
      setConnectionPhase("media-ready", { topologyMode: "idle" });
      refreshPublicMaps();
      refreshTopologyGraph();
      return;
    }
    if (data.mode === "probing") {
      const mesh = ensureP2p();
      if (!mesh) {
        send({
          type: "p2p-failed",
          data: { epoch: data.epoch, reason: "webrtc-unavailable" },
        });
        return;
      }
      mesh.applyTopology({ ...data, localPeerId });
      await Promise.all(
        [...localSources.values()].map((entry) =>
          mesh.publishSource(entry.source, entry.track, entry.stream),
        ),
      );
      mediaGeneration.assert(generation);
      transportReady.value = true;
      iceConnectedBoth.value = false;
      mediaConnectionState.value = "topology-probing";
      setConnectionPhase("topology-selecting", {
        topologyEpoch: Number(data.epoch),
        topologyMode: "probing",
      });
      refreshTopologyGraph();
      return;
    }
    if (data.mode === "switching") {
      await prepareTransition(data, generation);
      return;
    }
    if (data.mode === "p2p") {
      await activateP2p(data, generation);
      return;
    }
    if (data.mode === "sfu") await activateSfu(data, generation);
  }
  async function updateActiveTopology(data, generation) {
    if (data.mode === "p2p") {
      p2pMesh?.applyTopology({ ...data, localPeerId });
      await Promise.all(
        [...localSources.values()].map((entry) =>
          p2pMesh?.publishSource(entry.source, entry.track, entry.stream),
        ),
      );
      mediaGeneration.assert(generation);
    } else if (data.mode === "sfu") {
      p2pMesh?.closeAll();
      p2pMesh = null;
      handoff.retire("p2p");
    }
    const readiness =
      data.mode === "sfu" ? sfu?.connectionState() : { ready: true };
    transportReady.value = readiness?.ready === true;
    iceConnectedBoth.value =
      data.mode === "sfu"
        ? readiness.sendRequired &&
          readiness.receiveRequired &&
          readiness.send === "connected" &&
          readiness.recv === "connected"
        : p2pMesh?.isMediaReady() === true;
    setRouteConnectionState(
      transportReady.value
        ? iceConnectedBoth.value
          ? "media-flowing"
          : "ready-no-active-media"
        : "transport-connecting",
    );
    setConnectionPhase(
      transportReady.value ? "media-ready" : "transport-connecting",
      {
        topologyEpoch: Number(data.epoch),
        topologyMode: data.mode,
      },
    );
    error.value = null;
    refreshPublicMaps();
    refreshTopologyGraph();
  }
  function handleTopologyFailure(data, topologyError) {
    if (topologyEventKey(data) !== latestTopologyKey) return;
    const reason = topologyError?.message || "Topology operation failed";
    preparedTransition = null;
    if (data.mode === "p2p" || data.target === "p2p") {
      send({
        type: "p2p-failed",
        data: { epoch: data.epoch, reason: `activation-failed-${reason}` },
      });
      console.warn(`[Media] P2P topology operation failed: ${reason}`);
      return;
    }
    if (data.mode === "sfu" || data.target === "sfu") {
      reportSfuFailure(`activation-failed-${reason}`);
      return;
    }
    failSession(reason);
  }
  function reportSfuFailure(reason) {
    const epoch = topologyState.value.epoch;
    if (reportedSfuFailureEpoch === epoch) return;
    reportedSfuFailureEpoch = epoch;
    send({ type: "sfu-failed", data: { epoch, reason } });
    transportReady.value = false;
    iceConnectedBoth.value = false;
    mediaConnectionState.value = "failed";
    setConnectionPhase("failed", { reason });
    console.warn(
      `[Media] SFU failure reported for topology epoch ${epoch}: ${reason}`,
    );
  }
  async function prepareTransition(data, generation) {
    let destinationSfu = null;
    try {
      transportReady.value = true;
      if (data.target === "p2p") {
        const mesh = ensureP2p();
        if (!mesh) throw new Error("Native WebRTC is unavailable");
        mesh.applyTopology({ ...data, mode: "p2p", localPeerId });
        await Promise.all(
          [...localSources.values()].map((entry) =>
            mesh.publishSource(entry.source, entry.track, entry.stream),
          ),
        );
        await waitForRemoteTracks("p2p", data);
      } else if (data.target === "sfu") {
        destinationSfu = ensureSfu();
        if (activeProvider === "sfu") destinationSfu.closeMedia();
        await destinationSfu.initialize();
        for (const entry of localSources.values())
          await destinationSfu.addSource(entry);
        await waitForRemoteTracks("sfu", data);
      } else {
        throw new Error("The server requested an invalid media topology");
      }
      mediaGeneration.assert(generation);
      preparedTransition = {
        target: data.target,
        epoch: Number(data.epoch),
        sourceRevision: Number(data.sourceRevision) || 0,
      };
      send({
        type: "topology-ready",
        data: {
          epoch: data.epoch,
          target: data.target,
          sourceRevision: data.sourceRevision,
        },
      });
      refreshPublicMaps();
      refreshTopologyGraph();
    } catch (transitionError) {
      preparedTransition = null;
      if (destinationSfu && destinationSfu === sfu) destinationSfu.closeMedia();
      if (topologyEventKey(data) !== latestTopologyKey) return;
      send({
        type: "topology-failed",
        data: {
          epoch: data.epoch,
          target: data.target,
          sourceRevision: data.sourceRevision,
          reason: transitionError.message,
        },
      });
      console.warn(
        `[Media] ${data.target?.toUpperCase() || "Unknown"} handoff preparation failed: ${transitionError.message}`,
      );
    }
  }
  async function activateP2p(data, generation) {
    const mesh = ensureP2p();
    mesh.applyTopology({ ...data, localPeerId });
    await Promise.all(
      [...localSources.values()].map((entry) =>
        mesh.publishSource(entry.source, entry.track, entry.stream),
      ),
    );
    if (!matchesPreparedActivation(preparedTransition, data, "p2p"))
      await waitForRemoteTracks("p2p", data);
    mediaGeneration.assert(generation);
    handoff.bind("p2p");
    setActiveProvider("p2p");
    sfuRoundTripTime.value = null;
    participantSfuRoundTripTimes.value = {};
    handoff.retire("sfu");
    sfu?.closeMedia();
    transportReady.value = true;
    iceConnectedBoth.value = true;
    setRouteConnectionState("media-flowing");
    setConnectionPhase("media-ready", {
      topologyEpoch: Number(data.epoch),
      topologyMode: "p2p",
    });
    error.value = null;
    preparedTransition = null;
    refreshPublicMaps();
    refreshTopologyGraph();
  }
  async function activateSfu(data, generation) {
    transportReady.value = false;
    mediaConnectionState.value = "transport-connecting";
    setConnectionPhase("transport-connecting", {
      topologyEpoch: Number(data.epoch),
      topologyMode: "sfu",
    });
    const session = ensureSfu();
    await session.initialize();
    for (const entry of localSources.values()) await session.addSource(entry);
    if (!matchesPreparedActivation(preparedTransition, data, "sfu"))
      await waitForRemoteTracks("sfu", data);
    mediaGeneration.assert(generation);
    handoff.bind("sfu");
    setActiveProvider("sfu");
    reportedSfuFailureEpoch = null;
    handoff.retire("p2p");
    p2pMesh?.closeAll();
    p2pMesh = null;
    transportReady.value = true;
    const readiness = session.connectionState();
    iceConnectedBoth.value =
      readiness.sendRequired &&
      readiness.receiveRequired &&
      readiness.send === "connected" &&
      readiness.recv === "connected";
    setRouteConnectionState(
      iceConnectedBoth.value ? "media-flowing" : "ready-no-active-media",
    );
    setConnectionPhase("media-ready", {
      topologyEpoch: Number(data.epoch),
      topologyMode: "sfu",
    });
    error.value = null;
    preparedTransition = null;
    refreshPublicMaps();
    refreshTopologyGraph();
  }
  function waitForRemoteTracks(provider, topology) {
    return waitForMediaHandoff({
      getLatestTopologyKey: () => latestTopologyKey,
      getLocalPeerId: () => localPeerId,
      getP2pMesh: () => p2pMesh,
      getSfu: () => sfu,
      handoff,
      localSources,
      pollIntervalMs: MEDIA_TIMING.readinessPollMs,
      provider,
      timeoutMs: MEDIA_TIMING.handoffTimeoutMs,
      topology,
      topologyEventKey,
      topologyState,
    });
  }
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
  function failSession(message) {
    error.value = message;
    iceConnectedBoth.value = false;
    mediaConnectionState.value = "failed";
    setConnectionPhase("failed", { reason: message });
  }
  function disconnect() {
    rtpStatsSamples.clear();
    intentionalClose = true;
    channelId = null;
    signaling.stop();
    stopLocalVoiceDetection();
    stopSharedAudioMeter();
    attenuationReporter.clear();
    capture.stopDeviceMonitoring();
    closeMediaSessionTransports({
      capture,
      getP2pMesh: () => p2pMesh,
      getSfu: () => sfu,
      handoff,
      socket: signaling.getSocket(),
    });
    p2pMesh = null;
    sfu = null;
    setActiveProvider(null);
    connected.value = false;
    transportReady.value = false;
    iceConnectedBoth.value = false;
    mediaConnectionState.value = "disconnected";
    protocolState.value = null;
    protocolUpdateRequired.value = false;
    setConnectionPhase("closed");
    playbackState.value = "idle";
    resetTopologySequencing("disconnected");
    lastP2pEdges = [];
    peerRoundTripTimes.value = {};
    peerConnectionMetrics.value = {};
    sfuRoundTripTime.value = null;
    participantSfuRoundTripTimes.value = {};
    refreshPublicMaps();
    refreshTopologyGraph();
  }
  return {
    connected: readonly(connected),
    joinReady,
    error: readonly(error),
    transportReady: readonly(transportReady),
    iceConnectedBoth: readonly(iceConnectedBoth),
    mediaConnectionState: readonly(mediaConnectionState),
    connectionPhase: readonly(connectionPhase),
    lifecycle: readonly(lifecycle),
    protocolState: readonly(protocolState),
    protocolUpdateRequired: readonly(protocolUpdateRequired),
    playbackState: readonly(playbackState),
    microphoneDeviceState: readonly(microphoneDeviceState),
    isProducing: computed(() => localSources.size > 0),
    producers: readonly(producers),
    consumers: readonly(consumers),
    localVideoFeeds: readonly(localVideoFeeds),
    remoteVideoFeeds: readonly(remoteVideoFeeds),
    remoteAudioFeeds: readonly(remoteAudioFeeds),
    sharedAudioStats: readonly(sharedAudioStats),
    echoDetected: readonly(echoDetected),
    sharedAudioAttenuation,
    sharedAudioDucking: readonly(sharedAudioDucking),
    peerRoundTripTimes: readonly(peerRoundTripTimes),
    peerConnectionMetrics: readonly(peerConnectionMetrics),
    sfuRoundTripTime: readonly(sfuRoundTripTime),
    participantSfuRoundTripTimes: readonly(participantSfuRoundTripTimes),
    remoteProducersCount,
    lastInRoom,
    topologyState: readonly(topologyState),
    topologyGraph: readonly(topologyGraph),
    activeProvider: readonly(activeProviderState),
    lastSentClientRtpCapabilities: computed(
      () => sfu?.lastSentClientRtpCapabilities || null,
    ),
    lastReceivedConsumerParams: computed(
      () => sfu?.lastReceivedConsumerParams || null,
    ),
    connect,
    disconnect,
    prepareAudioPlayback: () => registry.preparePlayback(),
    restartAudioProduction,
    startAudioProduction,
    stopAudioProduction,
    startVideoProduction,
    stopVideoProduction,
    startSystemAudioProduction,
    stopSystemAudioProduction,
    setRemoteScreenReceiving: (feedKey, receiving) =>
      registry.setVideoReceiving(feedKey, receiving),
    setRemoteSystemAudioReceiving: (key, on) =>
      registry.setAudioReceiving(key, on),
    setSharedAudioVolume,
    setSystemAudioBitrate,
    sendParticipantVoiceState,
    applyOutputDeviceToAll: () => registry.applyOutputDevice(),
    applyVolumeForUser: (userId, volume) =>
      registry.applyVolume(userId, null, volume),
    applyVolumeForTrack: (userId, source, volume) =>
      registry.applyVolume(userId, source, volume),
    ensureAudioElements: () => registry.ensurePlayback(),
    getWebRTCStatsSnapshot,
    getOutboundRtpStats,
    getInboundRtpStats,
    getWebRTCDiagnosticStats,
    areTransportsIceConnected: () => Promise.resolve(iceConnectedBoth.value),
  };
}
