import { computed, readonly, ref } from "vue";
import { useRuntimeConfig } from "#app";
import { MediaCaptureManager } from "~/shared/media-capture.js";
import { MediasoupClientSession } from "~/shared/mediasoup-client-session.js";
import { NativeP2pMesh } from "~/shared/native-p2p.js";
import { RemoteMediaRegistry } from "~/shared/remote-media-registry.js";
import { RemoteMediaHandoff } from "~/shared/remote-media-handoff.js";
import { createHybridMediaDiagnostics } from "~/shared/hybrid-media-diagnostics.js";
import { createLocalAudioEngine } from "~/shared/local-audio-engine.js";
import { createMediaTopologyView } from "~/shared/media-topology-view.js";
import { setupMediaMessageHandlers } from "~/shared/media-message-handlers.js";
import { createMediaSourceController } from "~/shared/media-source-controller.js";
import {
  waitForInitialMediaTopology,
  waitForMediaHandoff,
} from "~/shared/media-handoff-readiness.js";
import { addressFamily, buildTopologyGraph } from "~/shared/rtc-topology.js";
import {
  collectOutboundAudioStats,
  collectVideoRtpStats,
} from "~/shared/rtc-media-stats.js";
import { hasUsableVoiceRoute } from "~/shared/voice-join-readiness.js";
import { buildP2pVideoSenderOptions } from "~/shared/video-settings.js";
import {
  buildVoiceProducerOptions,
  getAudioBitrateBps,
  mapPeerConnectionMetrics,
  mapPeerRoundTripTimes,
} from "~/shared/voice-transport.js";
import {
  matchesPreparedActivation,
  shouldAcceptTopologyEvent,
  topologyEventKey,
} from "~~/server/utils/media-transition.js";
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

const connectionTimeoutMs = 10000;
const mediaHandoffTimeoutMs = 8000;
const mediaReadinessPollMs = 200;
const signalingHeartbeatIntervalMs = 5000;
const signalingHeartbeatTimeoutMs = 15000;

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
  const playbackState = ref("idle");
  const localVideoFeeds = ref(new Map());
  const remoteVideoFeeds = ref(new Map());
  const remoteAudioFeeds = ref(new Map());
  const lastInRoom = ref([]);
  const remoteProducersCount = ref(0);
  const sharedAudioStats = ref({ kbps: 0, level: 0, dbfs: -60 });
  const peerRoundTripTimes = ref({});
  const peerConnectionMetrics = ref({});
  const sfuRoundTripTime = ref(null);
  const participantSfuRoundTripTimes = ref({});
  const activeProviderState = ref(null);
  const topologyState = ref({
    mode: "idle",
    epoch: 0,
    reason: "waiting-for-peer",
    peers: [],
    activatedAt: null,
  });
  const topologyGraph = ref(
    buildTopologyGraph({ mode: "idle", participantIds: [] }),
  );
  const producers = ref(new Map());
  const consumers = ref(new Map());
  const messageHandlers = new Map();
  const localSources = new Map();
  let socket = null;
  let channelId = null;
  let localPeerId = null;
  let iceServers = [];
  let p2pMesh = null;
  let sfu = null;
  let activeProvider = null;
  let intentionalClose = false;
  let pingTimer = null;
  let heartbeatSequence = 0;
  let lastHeartbeatAckSequence = 0;
  let lastHeartbeatAckAt = 0;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let topologyWaiter = null;
  let topologyOperation = Promise.resolve();
  let pendingTopologyKey = null;
  let appliedTopologyKey = null;
  let highestQueuedEpoch = 0;
  let lastP2pEdges = [];
  let latestTopologyKey = null;
  let reportedSfuFailureEpoch = null;
  let preparedTransition = null;
  const videoStatsSamples = new Map();
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

  const registry = new RemoteMediaRegistry({
    audioFeeds: remoteAudioFeeds,
    videoFeeds: remoteVideoFeeds,
    getVolume: (userId, source) => voiceStore.getTrackVolume(userId, source),
    getOutputDevice: () => settingsStore.outputDeviceId,
    isDeafened: () => voiceStore.deafened,
    isBroadcastMode: () => settingsStore.broadcastMode,
    onSpeaking: (userId, speaking) =>
      voiceStore.updateUserSpeaking(userId, speaking),
    getAttenuation: () => {
      const room = roomsStore.getRoomById(voiceStore.currentRoomId);
      const roomValue = room?.attenuation || {
        enabled: true,
        reductionPercent: 65,
        attackMs: 120,
        releaseMs: 650,
      };
      const override = settingsStore.streamAttenuation;
      if (override.mode === "disabled") return { ...roomValue, enabled: false };
      if (override.mode === "enabled")
        return {
          ...roomValue,
          enabled: true,
          reductionPercent: override.reductionPercent,
        };
      return roomValue;
    },
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
  });

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
    onMicrophoneFallback: () => settingsStore.setMicDeviceId(null),
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
    if (intentionalClose) return false;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  async function connect(nextChannelId) {
    if (connected.value && channelId === nextChannelId) return;
    intentionalClose = false;
    channelId = nextChannelId;
    error.value = null;
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
    const origin = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
    const base = runtimeConfig.public.sfuPath || `${origin}/socket`;
    const url = `${base}?channelId=${encodeURIComponent(channelId)}`;
    return new Promise((resolve, reject) => {
      const candidate = new WebSocket(url);
      socket = candidate;
      const timeout = setTimeout(() => {
        candidate.close();
        reject(new Error("Media signaling connection timed out"));
      }, connectionTimeoutMs);
      candidate.onopen = () => {
        if (socket !== candidate) return;
        clearTimeout(timeout);
        connected.value = true;
        reconnectAttempt = 0;
        sourceController.sendSourceState();
        sendParticipantVoiceState();
        startKeepalive();
        resolve();
      };
      candidate.onmessage = (event) => {
        if (socket === candidate) handleMessage(event.data);
      };
      candidate.onerror = () => {
        clearTimeout(timeout);
        if (!connected.value)
          reject(new Error("Media signaling connection failed"));
      };
      candidate.onclose = () => {
        clearTimeout(timeout);
        if (socket !== candidate) return;
        socket = null;
        connected.value = false;
        stopKeepalive();
        if (!intentionalClose) {
          p2pMesh?.closeAll();
          p2pMesh = null;
          sfu?.close();
          sfu = null;
          handoff.clear();
          setActiveProvider(null);
          transportReady.value = false;
          iceConnectedBoth.value = false;
          remoteProducersCount.value = 0;
          peerRoundTripTimes.value = {};
          peerConnectionMetrics.value = {};
          sfuRoundTripTime.value = null;
          participantSfuRoundTripTimes.value = {};
          resetTopologySequencing();
          scheduleReconnect();
        }
      };
    });
  }

  function waitForInitialTopology() {
    return waitForInitialMediaTopology({
      isReady: () => topologyState.value.epoch > 0,
      setWaiter: (waiter) => {
        topologyWaiter = waiter;
      },
      timeoutMs: connectionTimeoutMs,
    });
  }

  function resetTopologySequencing(reason = "reconnecting") {
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
  }

  function startKeepalive() {
    stopKeepalive();
    lastHeartbeatAckAt = Date.now();
    lastHeartbeatAckSequence = heartbeatSequence;
    const heartbeat = () => {
      if (Date.now() - lastHeartbeatAckAt >= signalingHeartbeatTimeoutMs) {
        console.warn("[Media] signaling heartbeat acknowledgement timed out");
        socket?.close(4000, "Signaling heartbeat timed out");
        return;
      }
      heartbeatSequence += 1;
      send({
        type: "heartbeat",
        data: {
          sequence: heartbeatSequence,
          topologyEpoch: topologyState.value.epoch,
          sourceRevision: topologyState.value.sourceRevision || 0,
        },
      });
    };
    heartbeat();
    pingTimer = setInterval(heartbeat, signalingHeartbeatIntervalMs);
  }

  function stopKeepalive() {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
  }

  function scheduleReconnect() {
    if (reconnectTimer || intentionalClose) return;
    const delay =
      Math.min(10000, 500 * 2 ** reconnectAttempt) +
      Math.floor(Math.random() * 250);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      try {
        await openSocket();
      } catch (reconnectError) {
        error.value = reconnectError.message;
        scheduleReconnect();
      }
    }, delay);
  }

  function handleMessage(raw) {
    let message;
    try {
      if (typeof raw !== "string" || raw.length > 96000)
        throw new Error("Invalid signaling payload");
      message = JSON.parse(raw);
    } catch (_) {
      failSession("The media server sent an invalid message");
      return;
    }
    const handler = messageHandlers.get(message.type);
    if (!handler) return;
    Promise.resolve(handler(message.data || {})).catch((handlerError) => {
      failSession(handlerError.message || "Media message handling failed");
    });
  }

  function setupHandlers() {
    if (messageHandlers.size) return;
    setupMediaMessageHandlers({
      ensureP2p,
      getHeartbeatSequence: () => heartbeatSequence,
      getLastHeartbeatAckSequence: () => lastHeartbeatAckSequence,
      getSfu: () => sfu,
      getSocket: () => socket,
      lastInRoom,
      participantSfuRoundTripTimes,
      queueTopology,
      registerHandler: (type, handler) => messageHandlers.set(type, handler),
      remoteProducersCount,
      setHeartbeatAck: (sequence, acknowledgedAt) => {
        lastHeartbeatAckSequence = sequence;
        lastHeartbeatAckAt = acknowledgedAt;
      },
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
          return { encodings: options.encodings, dtx: "disabled" };
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
    const epoch = Number(data.epoch);
    if (!shouldAcceptTopologyEvent(data, highestQueuedEpoch))
      return topologyOperation;
    highestQueuedEpoch = Math.max(highestQueuedEpoch, epoch);
    const key = topologyEventKey(data);
    latestTopologyKey = key;
    if (key === appliedTopologyKey || key === pendingTopologyKey)
      return topologyOperation;
    pendingTopologyKey = key;
    topologyOperation = topologyOperation
      .catch(() => {})
      .then(() => applyTopology(data))
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
      },
      getAudioBitrate: getEffectiveAudioBitrate,
      getAudioStereo,
      getVideoSettings: getRequestedVideoSettings,
    });
    return sfu;
  }

  function getRequestedVideoSettings(source) {
    const base =
      source === "screen"
        ? settingsStore.screenVideo
        : settingsStore.cameraVideo;
    const policy = voiceStore.currentChannelId
      ? channelsStore.getChannelById(voiceStore.currentChannelId)?.mediaPolicy
      : null;
    return {
      ...base,
      maxBitrate:
        Number(source === "screen" ? policy?.screenKbps : policy?.cameraKbps) *
          1000 || null,
    };
  }

  function getEffectiveAudioBitrate(source) {
    const channel = voiceStore.currentChannelId
      ? channelsStore.getChannelById(voiceStore.currentChannelId)
      : null;
    const channelBitrate =
      source === "screen-audio"
        ? channel?.mediaPolicy?.sharedAudioKbps || channel?.audio_bitrate
        : channel?.mediaPolicy?.microphoneKbps || channel?.audio_bitrate;
    return getAudioBitrateBps(
      source,
      channelBitrate,
      settingsStore.systemAudioBitrate,
    );
  }

  function getAudioStereo(source) {
    if (source === "screen-audio") return true;
    if (!voiceStore.currentChannelId) return false;
    return (
      channelsStore.getChannelById(voiceStore.currentChannelId)?.mediaPolicy
        ?.hdAudio === true
    );
  }

  const {
    createSharedAudioSource,
    producerFacade,
    refreshAudioSenderSettings,
    refreshMediaPolicy,
    setMicrophoneTransmission,
    setSharedAudioVolume,
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
    getAudioStereo,
    getEffectiveAudioBitrate,
    getP2pMesh: () => p2pMesh,
    getRequestedVideoSettings,
    getSfu: () => sfu,
    localSources,
    microphoneLevelDb,
    settingsStore,
    sharedAudioStats,
    updateNoiseFloor,
    voiceStore,
  });

  async function applyTopology(data) {
    if (Number(data.epoch) < topologyState.value.epoch) return;
    for (const peer of Array.isArray(data.peers) ? data.peers : [])
      if (peer.profile) voiceStore.upsertUserProfile(peer.profile);
    const previousProvider = activeProvider;
    topologyState.value = {
      mode: data.mode,
      epoch: Number(data.epoch),
      reason: data.reason || null,
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
    topologyWaiter?.();
    if (data.mode === activeProvider) {
      updateActiveTopology(data);
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
      for (const entry of localSources.values())
        mesh.publishSource(entry.source, entry.track, entry.stream);
      transportReady.value = true;
      iceConnectedBoth.value = false;
      mediaConnectionState.value = "topology-probing";
      refreshTopologyGraph();
      return;
    }
    if (data.mode === "switching") {
      await prepareTransition(data);
      return;
    }
    if (data.mode === "p2p") {
      await activateP2p(data);
      return;
    }
    if (data.mode === "sfu") await activateSfu(data);
  }

  function updateActiveTopology(data) {
    if (data.mode === "p2p") {
      p2pMesh?.applyTopology({ ...data, localPeerId });
      for (const entry of localSources.values())
        p2pMesh?.publishSource(entry.source, entry.track, entry.stream);
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
    console.warn(
      `[Media] SFU failure reported for topology epoch ${epoch}: ${reason}`,
    );
  }

  async function prepareTransition(data) {
    let destinationSfu = null;
    try {
      transportReady.value = true;
      if (data.target === "p2p") {
        const mesh = ensureP2p();
        if (!mesh) throw new Error("Native WebRTC is unavailable");
        mesh.applyTopology({ ...data, mode: "p2p", localPeerId });
        for (const entry of localSources.values())
          mesh.publishSource(entry.source, entry.track, entry.stream);
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

  async function activateP2p(data) {
    const mesh = ensureP2p();
    mesh.applyTopology({ ...data, localPeerId });
    for (const entry of localSources.values())
      mesh.publishSource(entry.source, entry.track, entry.stream);
    if (!matchesPreparedActivation(preparedTransition, data, "p2p"))
      await waitForRemoteTracks("p2p", data);
    handoff.bind("p2p");
    setActiveProvider("p2p");
    sfuRoundTripTime.value = null;
    participantSfuRoundTripTimes.value = {};
    handoff.retire("sfu");
    sfu?.closeMedia();
    transportReady.value = true;
    iceConnectedBoth.value = true;
    setRouteConnectionState("media-flowing");
    error.value = null;
    preparedTransition = null;
    refreshPublicMaps();
    refreshTopologyGraph();
  }

  async function activateSfu(data) {
    transportReady.value = false;
    mediaConnectionState.value = "transport-connecting";
    const session = ensureSfu();
    await session.initialize();
    for (const entry of localSources.values()) await session.addSource(entry);
    if (!matchesPreparedActivation(preparedTransition, data, "sfu"))
      await waitForRemoteTracks("sfu", data);
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
      pollIntervalMs: mediaReadinessPollMs,
      provider,
      timeoutMs: mediaHandoffTimeoutMs,
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
    localSources,
    localVideoFeeds,
    producerFacade,
    refreshPublicMaps,
    reportSfuFailure,
    send,
    settingsStore,
    setMicrophoneTransmission,
    startLocalVoiceDetection,
    startSharedAudioMeter,
    stopLocalVoiceDetection,
    stopSharedAudioMeter,
    topologyState,
    voiceStore,
  });
  const {
    sendParticipantVoiceState,
    startAudioProduction,
    startSystemAudioProduction,
    startVideoProduction,
    stopAudioProduction,
    stopSystemAudioProduction,
    stopVideoProduction,
  } = sourceController;

  const {
    getInboundVideoStats,
    getOutboundVideoStats,
    getWebRTCDiagnosticStats,
    getWebRTCStatsSnapshot,
    sfuProducerIds,
  } = createHybridMediaDiagnostics({
    collectVideoRtpStats,
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
    videoStatsSamples,
  });

  function failSession(message) {
    error.value = message;
    iceConnectedBoth.value = false;
    mediaConnectionState.value = "failed";
  }

  function disconnect() {
    videoStatsSamples.clear();
    intentionalClose = true;
    channelId = null;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    stopKeepalive();
    stopLocalVoiceDetection();
    stopSharedAudioMeter();
    socket?.close();
    socket = null;
    capture.stopAll();
    p2pMesh?.closeAll();
    p2pMesh = null;
    sfu?.close();
    sfu = null;
    handoff.clear();
    setActiveProvider(null);
    connected.value = false;
    transportReady.value = false;
    iceConnectedBoth.value = false;
    mediaConnectionState.value = "disconnected";
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
    playbackState: readonly(playbackState),
    isProducing: computed(() => localSources.size > 0),
    producers: readonly(producers),
    consumers: readonly(consumers),
    localVideoFeeds: readonly(localVideoFeeds),
    remoteVideoFeeds: readonly(remoteVideoFeeds),
    remoteAudioFeeds: readonly(remoteAudioFeeds),
    sharedAudioStats: readonly(sharedAudioStats),
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
    startAudioProduction,
    stopAudioProduction,
    startVideoProduction,
    stopVideoProduction,
    startSystemAudioProduction,
    stopSystemAudioProduction,
    setRemoteScreenReceiving: (feedKey, receiving) =>
      registry.setVideoReceiving(feedKey, receiving),
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
    getOutboundVideoStats,
    getInboundVideoStats,
    getWebRTCDiagnosticStats,
    areTransportsIceConnected: () => Promise.resolve(iceConnectedBoth.value),
  };
}
