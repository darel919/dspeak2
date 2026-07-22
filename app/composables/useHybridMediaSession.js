import { computed, readonly, ref } from "vue";
import { useRuntimeConfig } from "#app";
import { MediaCaptureManager } from "~/shared/media-capture.js";
import { MediasoupClientSession } from "~/shared/mediasoup-client-session.js";
import { NativeP2pMesh } from "~/shared/native-p2p.js";
import { RemoteMediaRegistry } from "~/shared/remote-media-registry.js";
import { RemoteMediaHandoff } from "~/shared/remote-media-handoff.js";
import { addressFamily, buildTopologyGraph } from "~/shared/rtc-topology.js";
import {
  collectOutboundAudioStats,
  collectVideoRtpStats,
} from "~/shared/rtc-media-stats.js";
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
  let sharedAudioMeter = null;
  let sharedAudioStatsSample = null;
  let topologyOperation = Promise.resolve();
  let pendingTopologyKey = null;
  let appliedTopologyKey = null;
  let highestQueuedEpoch = 0;
  let lastP2pEdges = [];
  let latestTopologyKey = null;
  let reportedSfuFailureEpoch = null;
  let preparedTransition = null;
  const videoStatsSamples = new Map();

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
        sfu?.setRemoteReceiving(entry.userId, entry.source, receiving);
      if (entry.provider === "p2p")
        p2pMesh?.setRemoteReceiving(entry.peerId, entry.source, receiving);
    },
  });

  const capture = new MediaCaptureManager({
    getSettings: () => settingsStore,
    onSource: publishSource,
    onSourceEnded: removeSource,
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

  function registerHandler(type, handler) {
    messageHandlers.set(type, handler);
  }

  async function fetchIceServers() {
    const result = await $fetch(`${runtimeConfig.public.apiPath}/config`);
    if (!Array.isArray(result))
      throw new Error("The ICE server configuration is invalid");
    iceServers = result;
  }

  async function connect(nextChannelId) {
    if (connected.value && channelId === nextChannelId) return;
    intentionalClose = false;
    channelId = nextChannelId;
    error.value = null;
    await fetchIceServers();
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
    const url = `${base}?auth=${encodeURIComponent(userId)}&channelId=${encodeURIComponent(channelId)}`;
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
        sendSourceState();
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
    if (topologyState.value.epoch > 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        topologyWaiter = null;
        reject(new Error("Initial media topology timed out"));
      }, connectionTimeoutMs);
      topologyWaiter = () => {
        clearTimeout(timeout);
        topologyWaiter = null;
        resolve();
      };
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
      if (typeof raw !== "string" || raw.length > 600000)
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
    registerHandler("connected", (data) => {
      localPeerId = String(data.peerId);
    });
    registerHandler("heartbeat-ack", (data) => {
      const sequence = Number(data.sequence);
      if (
        !Number.isSafeInteger(sequence) ||
        sequence <= lastHeartbeatAckSequence ||
        sequence > heartbeatSequence
      )
        return;
      lastHeartbeatAckSequence = sequence;
      lastHeartbeatAckAt = Date.now();
    });
    registerHandler("heartbeat-nack", (data) => {
      const sequence = Number(data.sequence);
      if (
        !Number.isSafeInteger(sequence) ||
        sequence <= lastHeartbeatAckSequence ||
        sequence > heartbeatSequence
      )
        return;
      lastHeartbeatAckSequence = sequence;
      lastHeartbeatAckAt = Date.now();
      if (data.topology) queueTopology(data.topology);
    });
    registerHandler("topology-state", queueTopology);
    registerHandler("p2p-signal", async (data) => {
      const mesh = ensureP2p();
      if (!mesh) return;
      try {
        await mesh.receiveSignal(data);
      } catch (signalError) {
        mesh.fail("signaling-failed", signalError);
      }
    });
    registerHandler("currentlyInChannel", (data) => {
      lastInRoom.value = Array.isArray(data.inRoom) ? data.inRoom : [];
      for (const profile of Array.isArray(data.profiles) ? data.profiles : [])
        voiceStore.upsertUserProfile(profile);
      syncConnectedUsers(data.inRoom);
    });
    registerHandler("available-producers", (data) => {
      remoteProducersCount.value = (data.producers || []).filter(
        (id) => ![...sfuProducerIds()].includes(id),
      ).length;
      return sfu?.handle("available-producers", data);
    });
    registerHandler("new-producer", (data) => {
      remoteProducersCount.value += 1;
      return sfu?.handle("new-producer", data);
    });
    registerHandler("producer-closed", (data) => {
      remoteProducersCount.value = Math.max(0, remoteProducersCount.value - 1);
      return sfu?.handle("producer-closed", data);
    });
    registerHandler("participant-sfu-rtt", (data) => {
      if (data.userId && Number.isFinite(Number(data.rttMs))) {
        participantSfuRoundTripTimes.value = {
          ...participantSfuRoundTripTimes.value,
          [data.userId]: Number(data.rttMs),
        };
      }
    });
    registerHandler("server-shutdown", () => socket?.close());
    for (const type of [
      "rtp-capabilities",
      "transport-params",
      "transport-connected",
      "producer-id",
      "consumer-params",
      "error",
    ]) {
      registerHandler(type, (data) => sfu?.handle(type, data));
    }
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
      onRemoteTrack: (entry) => stageRemote({ ...entry, provider: "p2p" }),
      onRemoteTrackEnded: (entry) =>
        removeRemote({ ...entry, provider: "p2p" }),
      onFailure: (failure) => send({ type: "p2p-failed", data: failure }),
      onSnapshot: updateP2pStats,
      getSenderOptions: (source, track) => {
        if (track.kind === "audio") {
          const options = buildVoiceProducerOptions(
            track,
            getEffectiveAudioBitrate(source),
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
      onRemoteTrack: (entry) => stageRemote(entry),
      onRemoteTrackEnded: removeRemote,
      onStateChange: (_, state) => {
        if (state === "failed" && topologyState.value.mode === "sfu")
          reportSfuFailure("media-transport-failed");
      },
      getAudioBitrate: getEffectiveAudioBitrate,
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
      iceConnectedBoth.value = true;
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
      iceConnectedBoth.value = true;
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
    transportReady.value = true;
    iceConnectedBoth.value = true;
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
    error.value = null;
    preparedTransition = null;
    refreshPublicMaps();
    refreshTopologyGraph();
  }

  async function activateSfu(data) {
    transportReady.value = false;
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
    iceConnectedBoth.value = true;
    error.value = null;
    preparedTransition = null;
    refreshPublicMaps();
    refreshTopologyGraph();
  }

  function waitForRemoteTracks(provider, topology) {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
      const poll = () => {
        if (topologyEventKey(topology) !== latestTopologyKey) {
          reject(new Error("Topology handoff was superseded"));
          return;
        }
        const expected = topologyState.value.peers
          .filter((peer) => String(peer.peerId) !== String(localPeerId))
          .reduce(
            (count, peer) =>
              count + (Array.isArray(peer.sources) ? peer.sources.length : 0),
            0,
          );
        const tracksReady = handoff.hasExpectedFeeds(
          provider,
          topologyState.value.peers,
          localPeerId,
        );
        const mediaReady =
          provider === "p2p" ? !!p2pMesh?.isMediaReady() : false;
        const check =
          provider === "sfu" && tracksReady
            ? sfu?.mediaReadiness(expected).catch((readinessError) => ({
                ready: false,
                error: readinessError.message,
              }))
            : Promise.resolve({ ready: mediaReady });
        check.then((readiness) => {
          const flowing = readiness?.ready === true;
          if (
            (tracksReady && flowing) ||
            (expected === 0 && localSources.size === 0)
          ) {
            resolve();
            return;
          }
          if (Date.now() - startedAt >= mediaHandoffTimeoutMs) {
            const detail =
              provider === "sfu"
                ? `tracks ${handoff.count(provider)}/${expected}, outbound ${readiness?.outboundFlowing ?? 0}/${readiness?.outboundExpected ?? localSources.size}, inbound ${readiness?.inboundFlowing ?? 0}/${readiness?.inboundExpected ?? expected}`
                : `tracks ${handoff.count(provider)}/${expected}, mesh ready ${flowing ? "yes" : "no"}`;
            reject(
              new Error(
                `${provider.toUpperCase()} media did not become ready for handoff (${detail})`,
              ),
            );
            return;
          }
          setTimeout(poll, mediaReadinessPollMs);
        });
      };
      poll();
    });
  }

  function stageRemote(entry) {
    handoff.stage(entry, activeProvider);
  }

  function removeRemote(entry) {
    handoff.remove(entry);
  }

  function setRemoteScreenReceiving(feedKey, receiving) {
    return registry.setVideoReceiving(feedKey, receiving);
  }

  function publishSource(entry) {
    if (entry.source === "screen-audio") entry = createSharedAudioSource(entry);
    localSources.set(entry.source, entry);
    if (entry.source === "camera" || entry.source === "screen") {
      localVideoFeeds.value.set(entry.source, {
        source: entry.source,
        stream: entry.stream,
        producerId: `${activeProvider || "local"}:${entry.track.id}`,
      });
      localVideoFeeds.value = new Map(localVideoFeeds.value);
    }
    if (
      topologyState.value.mode === "p2p" ||
      topologyState.value.mode === "probing" ||
      topologyState.value.target === "p2p"
    ) {
      p2pMesh?.publishSource(entry.source, entry.track, entry.stream);
    }
    if (
      topologyState.value.mode === "sfu" ||
      topologyState.value.target === "sfu"
    ) {
      sfu?.addSource(entry).catch((sourceError) => {
        const reason = `source-${entry.source}-failed-${sourceError.message}`;
        if (topologyState.value.mode === "sfu") reportSfuFailure(reason);
        else
          send({
            type: "topology-failed",
            data: {
              epoch: topologyState.value.epoch,
              target: "sfu",
              sourceRevision: topologyState.value.sourceRevision,
              reason,
            },
          });
      });
    }
    if (entry.source === "screen-audio") startSharedAudioMeter(entry.track);
    sendSourceState();
    refreshPublicMaps();
  }

  function removeSource(entry) {
    const publishedEntry = localSources.get(entry.source);
    if (
      publishedEntry?.track !== entry.track &&
      publishedEntry?.captureTrack !== entry.track
    )
      return;
    localSources.delete(entry.source);
    p2pMesh?.unpublishSource(entry.source);
    sfu?.removeSource(entry.source);
    localVideoFeeds.value.delete(entry.source);
    localVideoFeeds.value = new Map(localVideoFeeds.value);
    if (entry.source === "screen-audio") stopSharedAudioMeter();
    sendSourceState();
    refreshPublicMaps();
  }

  function sendSourceState() {
    send({
      type: "media-sources",
      data: { sources: [...localSources.keys()] },
    });
  }

  function startAudioProduction() {
    return capture.startMicrophone().then((entry) => producerFacade(entry));
  }

  function stopAudioProduction() {
    capture.stop("audio");
  }

  function startVideoProduction(source) {
    return capture.startVideo(source).then((entry) => producerFacade(entry));
  }

  function stopVideoProduction(source) {
    capture.stop(source);
  }

  function startSystemAudioProduction() {
    return capture.startSystemAudio().then((entry) => producerFacade(entry));
  }

  function stopSystemAudioProduction() {
    const entry = localSources.get("screen-audio");
    if (entry?.ownerSource === "system-audio") capture.stop("screen-audio");
  }

  function producerFacade(entry) {
    return {
      id: `${activeProvider || "local"}:${entry.source}:${entry.track.id}`,
      track: entry.track,
      closed: entry.track.readyState !== "live",
      on() {},
      close: () => capture.stop(entry.source),
    };
  }

  function setSharedAudioVolume(value) {
    const normalized = Math.max(0, Math.min(100, Number(value))) / 100;
    if (sharedAudioMeter?.gain)
      sharedAudioMeter.gain.gain.setTargetAtTime(
        normalized,
        sharedAudioMeter.context.currentTime,
        0.01,
      );
  }

  function setSystemAudioBitrate(value) {
    settingsStore.systemAudioBitrate = Number(value);
    return refreshAudioSenderSettings();
  }

  function refreshAudioSenderSettings() {
    const sources = [...localSources.values()]
      .filter((entry) => entry.track.kind === "audio")
      .map((entry) => entry.source);
    return Promise.all(
      sources.flatMap((source) =>
        [
          p2pMesh?.reconfigureSource(source),
          sfu?.updateAudioBitrate(source, getEffectiveAudioBitrate(source)),
        ].filter(Boolean),
      ),
    );
  }

  function refreshMediaPolicy() {
    const sources = [...localSources.values()].map((entry) => entry.source);
    return Promise.all(
      sources.flatMap((source) => {
        const entry = localSources.get(source);
        if (entry?.track.kind === "audio")
          return [
            p2pMesh?.reconfigureSource(source),
            sfu?.updateAudioBitrate(source, getEffectiveAudioBitrate(source)),
          ].filter(Boolean);
        return [
          p2pMesh?.reconfigureSource(source),
          sfu?.updateVideoBitrate(
            source,
            getRequestedVideoSettings(source).maxBitrate,
          ),
        ].filter(Boolean);
      }),
    );
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

  function createSharedAudioSource(entry) {
    try {
      const AudioContextConstructor =
        window.AudioContext || window.webkitAudioContext;
      if (!AudioContextConstructor) throw new Error("Web Audio is unavailable");
      const context = new AudioContextConstructor();
      const source = context.createMediaStreamSource(
        new MediaStream([entry.track]),
      );
      const gain = context.createGain();
      const analyser = context.createAnalyser();
      const destination = context.createMediaStreamDestination();
      analyser.fftSize = 512;
      gain.gain.value =
        Math.max(0, Math.min(100, Number(settingsStore.sharedAudioVolume))) /
        100;
      source.connect(gain);
      gain.connect(analyser);
      analyser.connect(destination);
      const track = destination.stream.getAudioTracks()[0];
      sharedAudioMeter = {
        context,
        source,
        gain,
        analyser,
        destination,
        timer: null,
        track,
      };
      return {
        ...entry,
        stream: new MediaStream([track]),
        track,
        captureTrack: entry.track,
      };
    } catch (error) {
      console.warn(
        `[Media] Shared audio processing is unavailable: ${error?.message || error}`,
      );
      return entry;
    }
  }

  function startSharedAudioMeter() {
    if (!sharedAudioMeter) return;
    const values = new Float32Array(sharedAudioMeter.analyser.fftSize);
    const sample = async () => {
      if (!sharedAudioMeter) return;
      sharedAudioMeter.analyser.getFloatTimeDomainData(values);
      const rms = Math.sqrt(
        values.reduce((sum, value) => sum + value * value, 0) / values.length,
      );
      const dbfs = rms > 0 ? 20 * Math.log10(rms) : -60;
      const producer = sfu?.producers.get("screen-audio")?.producer;
      const report =
        activeProvider === "sfu" && producer
          ? await producer.getStats().catch(() => null)
          : p2pMesh
            ? await p2pMesh
                .getOutboundTrackStats("screen-audio")
                .catch(() => null)
            : null;
      const collected = collectOutboundAudioStats(
        report,
        sharedAudioStatsSample,
      );
      if (collected.sample) sharedAudioStatsSample = collected.sample;
      sharedAudioStats.value = {
        kbps: collected.stats?.bitrateKbps ?? 0,
        level: Math.max(0, Math.min(1, collected.stats?.audioLevel ?? rms * 4)),
        dbfs: Math.max(-60, dbfs),
      };
    };
    sample().catch(() => {});
    sharedAudioMeter.timer = setInterval(() => sample().catch(() => {}), 500);
  }

  function stopSharedAudioMeter() {
    if (!sharedAudioMeter) return;
    clearInterval(sharedAudioMeter.timer);
    sharedAudioMeter.source.disconnect();
    sharedAudioMeter.gain.disconnect();
    sharedAudioMeter.analyser.disconnect();
    sharedAudioMeter.track.stop();
    sharedAudioMeter.context.close().catch(() => {});
    sharedAudioMeter = null;
    sharedAudioStatsSample = null;
    sharedAudioStats.value = { kbps: 0, level: 0, dbfs: -60 };
  }

  function syncConnectedUsers(userIds = []) {
    const active = new Set(userIds.map(String));
    for (const userId of active)
      if (!voiceStore.isUserConnected(userId))
        voiceStore.addConnectedUser(userId, { id: userId });
    for (const user of voiceStore.getConnectedUsersArray())
      if (!active.has(String(user.id))) voiceStore.removeConnectedUser(user.id);
  }

  function updateP2pStats(edges) {
    lastP2pEdges = edges;
    peerRoundTripTimes.value = mapPeerRoundTripTimes(
      edges,
      topologyState.value.peers,
    );
    peerConnectionMetrics.value = mapPeerConnectionMetrics(
      edges,
      topologyState.value.peers,
    );
    refreshTopologyGraph();
  }

  function refreshTopologyGraph(candidatePair = null) {
    const details = {};
    for (const connection of p2pMesh ? p2pMesh.connections.values() : []) {
      const edge =
        lastP2pEdges.find(
          (candidate) => candidate.peerId === connection.peerId,
        ) || {};
      const key = [localPeerId, connection.peerId].sort().join(":");
      details[key] = {
        state:
          edge.state ||
          (connection.pc.connectionState === "connected"
            ? "active"
            : "probing"),
        rtt: edge.rtt ?? null,
        network: edge.network || null,
        candidateType: edge.candidatePair?.local?.candidateType || null,
        addressFamily: addressFamily(edge.candidatePair?.remote?.address),
        bitrate: edge.bitrate ?? null,
        packetLoss: edge.packetLoss ?? null,
      };
    }
    topologyGraph.value = buildTopologyGraph({
      mode: topologyState.value.displayMode || topologyState.value.mode,
      currentMode: activeProvider,
      target: topologyState.value.target,
      epoch: topologyState.value.epoch,
      reason: topologyState.value.reason,
      activatedAt: topologyState.value.activatedAt,
      participantIds: topologyState.value.peers.map((peer) => peer.peerId),
      localPeerId,
      edgeDetails: details,
      participantSfuEdges: Object.fromEntries(
        topologyState.value.peers.map((peer) => [
          String(peer.peerId),
          {
            rtt:
              participantSfuRoundTripTimes.value[String(peer.userId)] ?? null,
          },
        ]),
      ),
      sfuEdge: candidatePair
        ? {
            rtt:
              candidatePair.currentRoundTripTime == null
                ? null
                : candidatePair.currentRoundTripTime * 1000,
            network:
              candidatePair.local?.protocol ||
              candidatePair.remote?.protocol ||
              null,
            candidateType: candidatePair.local?.candidateType || null,
            bitrate: candidatePair.availableOutgoingBitrate ?? null,
            packetLoss: candidatePair.packetLoss ?? null,
          }
        : null,
      candidatePair,
    });
  }

  function refreshPublicMaps() {
    producers.value = new Map(
      sfu
        ? [...sfu.producers].map(([source, entry]) => [
            entry.producer.id,
            entry,
          ])
        : [],
    );
    consumers.value = new Map(
      sfu
        ? [...sfu.consumers.values()].map((entry) => [
            entry.producerId,
            entry.consumer,
          ])
        : [],
    );
  }

  function sfuProducerIds() {
    return sfu
      ? [...sfu.producers.values()].map((entry) => entry.producer.id)
      : [];
  }

  async function getWebRTCStatsSnapshot() {
    if (activeProvider === "p2p" && p2pMesh) {
      const edges = await p2pMesh.getSnapshot().catch(() => null);
      if (edges) updateP2pStats(edges);
    }
    const transports =
      activeProvider === "sfu"
        ? (await sfu?.stats()) || []
        : (await p2pMesh?.stats()) || [];
    const pair =
      activeProvider === "sfu"
        ? transports.find((transport) => transport.candidatePair)
            ?.candidatePair || null
        : null;
    sfuRoundTripTime.value =
      pair?.currentRoundTripTime == null
        ? null
        : pair.currentRoundTripTime * 1000;
    if (sfuRoundTripTime.value != null)
      send({ type: "client-sfu-rtt", data: { rttMs: sfuRoundTripTime.value } });
    refreshTopologyGraph(pair);
    return {
      timestamp: Date.now(),
      peerRoundTripTime: Object.keys(peerRoundTripTimes.value).length
        ? Math.max(...Object.values(peerRoundTripTimes.value))
        : null,
      transports,
      topology: topologyGraph.value.topology,
      nodes: topologyGraph.value.nodes,
      edges: topologyGraph.value.edges,
    };
  }

  async function getOutboundVideoStats() {
    const results = [];
    for (const entry of [...localSources.values()].filter(
      (entry) => entry.track.kind === "video",
    )) {
      const settings = entry.track.getSettings?.() || {};
      const producer = sfu?.producers.get(entry.source)?.producer;
      const key = `outbound:${entry.source}`;
      const report =
        activeProvider === "sfu" && producer
          ? await producer.getStats().catch(() => null)
          : p2pMesh
            ? await p2pMesh
                .getOutboundTrackStats(entry.source)
                .catch(() => null)
            : null;
      const collected = report
        ? collectVideoRtpStats(
            report,
            "outbound",
            settings,
            videoStatsSamples.get(key),
          )
        : null;
      if (collected?.sample) videoStatsSamples.set(key, collected.sample);
      const senderParameters =
        activeProvider === "p2p"
          ? p2pMesh?.getOutboundTrackParameters(entry.source)
          : producer?.rtpParameters;
      const encoding = senderParameters?.encodings?.[0] || null;
      results.push({
        source: entry.source,
        targetFps: getRequestedVideoSettings(entry.source).frameRate,
        captureFps: settings.frameRate || null,
        configuredMaxBitrateKbps: Number.isFinite(Number(encoding?.maxBitrate))
          ? Number(encoding.maxBitrate) / 1000
          : null,
        configuredMaxFramerate: Number.isFinite(Number(encoding?.maxFramerate))
          ? Number(encoding.maxFramerate)
          : null,
        degradationPreference: senderParameters?.degradationPreference || null,
        ...(collected?.stats || {
          width: settings.width || null,
          height: settings.height || null,
          fps: settings.frameRate || null,
        }),
      });
    }
    return results;
  }

  async function getInboundVideoStats() {
    const results = [];
    for (const entry of remoteVideoFeeds.value.values()) {
      const settings = entry.track.getSettings?.() || {};
      const key = `inbound:${entry.key}`;
      const report = entry.consumer
        ? await entry.consumer.getStats().catch(() => null)
        : p2pMesh
          ? await p2pMesh
              .getInboundTrackStats(entry.peerId, entry.track)
              .catch(() => null)
          : null;
      const collected = report
        ? collectVideoRtpStats(
            report,
            "inbound",
            settings,
            videoStatsSamples.get(key),
          )
        : null;
      if (collected?.sample) videoStatsSamples.set(key, collected.sample);
      results.push({
        consumerId: entry.key,
        source: entry.source,
        ...(collected?.stats || {
          width: settings.width || null,
          height: settings.height || null,
          fps: settings.frameRate || null,
        }),
      });
    }
    return results;
  }

  async function getWebRTCDiagnosticStats() {
    return activeProvider === "sfu"
      ? (await sfu?.diagnosticStats()) || []
      : (await p2pMesh?.diagnosticStats()) || [];
  }

  function failSession(message) {
    error.value = message;
    iceConnectedBoth.value = false;
  }

  function areTransportsIceConnected() {
    return Promise.resolve(iceConnectedBoth.value);
  }

  function disconnect() {
    videoStatsSamples.clear();
    intentionalClose = true;
    channelId = null;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    stopKeepalive();
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
    error: readonly(error),
    transportReady: readonly(transportReady),
    iceConnectedBoth: readonly(iceConnectedBoth),
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
    startAudioProduction,
    stopAudioProduction,
    startVideoProduction,
    stopVideoProduction,
    startSystemAudioProduction,
    stopSystemAudioProduction,
    setRemoteScreenReceiving,
    setSharedAudioVolume,
    setSystemAudioBitrate,
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
    areTransportsIceConnected,
  };
}
