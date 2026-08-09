import { mediaDebug } from "./media-debug.js";
import { waitForMediaHandoff } from "./media-handoff-readiness.js";
import { closeMediaProviderSafely } from "./media-session-cleanup.js";
import {
  computeJitterBufferConfig,
  computeSfuJitterBufferConfig,
  smoothJitterBufferConfig,
} from "./adaptive-jitter-buffer.js";

export function createHybridMediaTopologyController({
  CloudflareRealtimeSession,
  MediasoupClientSession,
  MediasoupProviderSocket,
  NativeP2pMesh,
  buildP2pVideoSenderOptions,
  buildVoiceProducerOptions,
  closeSocket,
  currentJitterBufferConfig,
  error,
  failSession,
  getActiveProvider,
  getAudioStereo,
  getEffectiveAudioBitrate,
  getIceServers,
  getLocalPeerId,
  getMessageHandler,
  getProviderSocket,
  getRequestedVideoSettings,
  getSelectedSfuProvider,
  getSfu,
  getP2pMesh,
  handoff,
  iceConnectedBoth,
  localSources,
  mediaConnectionState,
  mediaGeneration,
  mediaReadinessPollMs,
  mediaHandoffTimeoutMs,
  matchesPreparedActivation,
  onP2pQualification,
  onRemotePublication,
  onTopologyStateUpdated,
  peerConnectionMetrics,
  refreshPublicMaps,
  refreshTopologyGraph,
  reportedSfuFailureState,
  send,
  sfuRoundTripTime,
  setActiveProvider,
  setP2pMesh,
  setProviderSocket,
  setSelectedSfuProvider,
  setSfu,
  setConnectionPhase,
  setRouteConnectionState,
  shouldAcceptTopologyEvent,
  topologyEventKey,
  topologyState,
  transportReady,
  updateP2pStats,
  waitForMediaTimeoutMs,
}) {
  let topologyOperation = Promise.resolve();
  let pendingTopologyKey = null;
  let appliedTopologyKey = null;
  let latestTopologyKey = null;
  let highestQueuedEpoch = 0;
  let preparedTransition = null;
  const providerTicketWaiters = new Map();

  function ensureP2p() {
    const existing = getP2pMesh();
    if (existing || typeof RTCPeerConnection === "undefined") return existing;
    const mesh = new NativeP2pMesh({
      iceServers: getIceServers(),
      sendSignal: (payload) =>
        payload.type === "ready"
          ? send({ type: "p2p-qualified", data: payload })
          : send({ type: "p2p-signal", data: payload }),
      onRemoteTrack: (entry) =>
        handoff.stage({ ...entry, provider: "p2p" }, getActiveProvider()),
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
        const requested = getRequestedVideoSettings(source);
        const options = buildP2pVideoSenderOptions({
          width: settings.width,
          height: settings.height,
          frameRate: requested.frameRate,
          qualityPriority: requested.qualityPriority,
          screen: source === "screen",
          maxBitrate: requested.maxBitrate,
        });
        const ceiling = requested.maxBitrate;
        if (ceiling && options.encodings?.[0])
          options.encodings[0].maxBitrate = Math.min(
            options.encodings[0].maxBitrate || ceiling,
            ceiling,
          );
        return options;
      },
    });
    setP2pMesh(mesh);
    mediaDebug("topology.p2p-created", { iceServers: getIceServers().length });
    return mesh;
  }

  function ensureSfu() {
    const existing = getSfu();
    if (existing) return existing;
    const provider = getSelectedSfuProvider();
    const SessionClass =
      provider === "cloudflare-realtime"
        ? CloudflareRealtimeSession
        : MediasoupClientSession;
    const session = new SessionClass({
      send: (message) => getProviderSocket()?.send(message) || send(message),
      iceServers: getIceServers(),
      onRemoteTrack: (entry) => handoff.stage(entry, getActiveProvider()),
      onRemoteTrackEnded: (entry) => handoff.remove(entry),
      onStateChange: (direction, state, summary) => {
        if (topologyState.value.mode !== "sfu") return;
        if (state === "failed" || state === "closed") {
          mediaConnectionState.value = "failed";
          setConnectionPhase("failed", {
            direction,
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
      },
      getAudioBitrate: getEffectiveAudioBitrate,
      getAudioStereo,
      getVideoSettings: getRequestedVideoSettings,
    });
    setSfu(session);
    mediaDebug("topology.sfu-created", { provider });
    return session;
  }

  async function closeP2pSafely() {
    const provider = getP2pMesh();
    setP2pMesh(null);
    await closeMediaProviderSafely(provider, "P2P");
  }

  async function closeSfuSafely() {
    const provider = getSfu();
    setSfu(null);
    await closeMediaProviderSafely(provider, "SFU");
  }

  function handleProviderFailure(data = {}) {
    if (!data.provider || getActiveProvider() !== "sfu") return;
    if (data.provider !== getSelectedSfuProvider()) return;
    mediaConnectionState.value = "recovering";
    transportReady.value = false;
    iceConnectedBoth.value = false;
    handoff.retire("sfu");
    void closeSfuSafely();
    setConnectionPhase("reconnecting", {
      topologyEpoch: Number(data.epoch) || topologyState.value.epoch,
      reason: data.reason || "provider-failure",
    });
    mediaDebug("topology.provider-failure", {
      provider: data.provider,
      epoch: data.epoch,
      reason: data.reason,
    });
  }

  function handleP2pQualification(data = {}) {
    const epoch = Number(data.epoch);
    if (!Number.isSafeInteger(epoch) || epoch < topologyState.value.epoch)
      return;
    topologyState.value = {
      ...topologyState.value,
      qualification: {
        acknowledged: data.acknowledged === true,
        failed: data.type === "p2p-failed" || data.failed === true,
        reason: data.reason || null,
        epoch,
      },
    };
    onP2pQualification?.(data);
    if (data.failed === true || data.type === "p2p-failed")
      mediaConnectionState.value = "recovering";
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
    mediaDebug("topology.queued", {
      mode: data.mode,
      target: data.target,
      provider: data.provider || data.targetProvider,
      epoch,
      sourceRevision: data.sourceRevision,
    });
    return topologyOperation;
  }

  async function applyTopology(data, generation) {
    mediaGeneration.assert(generation);
    if (Number(data.epoch) < topologyState.value.epoch) return;
    const previousProvider = getActiveProvider();
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
    if (data.mode === "sfu" && data.provider)
      setSelectedSfuProvider(data.provider);
    handoff.pruneExpectedFeeds(topologyState.value.peers, getLocalPeerId());
    onTopologyStateUpdated?.(data, topologyState.value);
    refreshPublicMaps();
    refreshTopologyGraph();
    if (data.mode === getActiveProvider()) {
      await updateActiveTopology(data, generation);
      return;
    }
    if (data.mode === "idle") {
      setActiveProvider(null);
      handoff.clear();
      await closeP2pSafely();
      await closeSfuSafely();
      preparedTransition = null;
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
      mesh.applyTopology({ ...data, localPeerId: getLocalPeerId() });
      await publishLocalSources(mesh);
      mediaGeneration.assert(generation);
      transportReady.value = true;
      iceConnectedBoth.value = false;
      mediaConnectionState.value = "topology-probing";
      refreshTopologyGraph();
      return;
    }
    if (data.mode === "switching") {
      mediaConnectionState.value = "recovering";
      await prepareTransition(data, generation);
      return;
    }
    if (data.mode === "p2p") {
      await activateP2p(data, generation);
      return;
    }
    if (data.mode === "sfu") await activateSfu(data, generation);
  }

  async function publishLocalSources(provider) {
    await Promise.all(
      [...localSources.values()].map((entry) =>
        provider.publishSource(entry.source, entry.track, entry.stream),
      ),
    );
  }

  async function updateActiveTopology(data, generation) {
    if (data.mode === "p2p") {
      getP2pMesh()?.applyTopology({
        ...data,
        localPeerId: getLocalPeerId(),
      });
      await publishLocalSources(getP2pMesh());
      mediaGeneration.assert(generation);
    } else if (data.mode === "sfu") {
      await closeP2pSafely();
      handoff.retire("p2p");
    }
    const readiness =
      data.mode === "sfu" ? getSfu()?.connectionState() : { ready: true };
    transportReady.value = readiness?.ready === true;
    iceConnectedBoth.value =
      data.mode === "sfu"
        ? readiness?.sendRequired === true &&
          readiness?.receiveRequired === true &&
          readiness?.send === "connected" &&
          readiness?.recv === "connected"
        : getP2pMesh()?.isMediaReady() === true;
    setRouteConnectionState(
      transportReady.value
        ? iceConnectedBoth.value
          ? "media-flowing"
          : "ready-no-active-media"
        : "transport-connecting",
    );
    setConnectionPhase("media-ready", {
      topologyEpoch: Number(data.epoch),
      topologyMode: data.mode,
    });
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
      mediaDebug("topology.failure", {
        mode: data.mode,
        target: data.target,
        reason,
      });
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
    if (reportedSfuFailureState.value === epoch) return;
    reportedSfuFailureState.value = epoch;
    send({
      type: "provider-failure",
      data: { provider: getSelectedSfuProvider(), epoch, reason },
    });
    transportReady.value = false;
    iceConnectedBoth.value = false;
    mediaConnectionState.value = "recovering";
    setConnectionPhase("reconnecting", { reason });
    mediaDebug("topology.sfu-failure-reported", { epoch, reason });
  }

  async function prepareTransition(data, generation) {
    let destinationSfu = null;
    try {
      transportReady.value = getActiveProvider() !== null;
      if (data.target === "p2p") {
        const mesh = ensureP2p();
        if (!mesh) throw new Error("Native WebRTC is unavailable");
        mesh.applyTopology({
          ...data,
          mode: "p2p",
          localPeerId: getLocalPeerId(),
        });
        await publishLocalSources(mesh);
        await waitForRemoteTracks("p2p", data);
      } else if (data.target === "sfu") {
        if (data.targetProvider === "cloudflare-realtime") {
          setSelectedSfuProvider(data.targetProvider);
          closeSocket();
          setProviderSocket(null);
          await closeSfuSafely();
        } else if (
          !getSfu() ||
          getSelectedSfuProvider() !== data.targetProvider
        ) {
          await waitForProviderTicket(data.epoch, data.targetProvider);
        }
        destinationSfu = ensureSfu();
        if (getActiveProvider() === "sfu") {
          await closeSfuSafely();
          destinationSfu = ensureSfu();
        }
        await destinationSfu.initialize();
        for (const entry of localSources.values())
          await destinationSfu.addSource(entry);
        await waitForRemoteTracks("sfu", data);
      } else throw new Error("The server requested an invalid media topology");
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
      mediaDebug("topology.prepared", {
        target: data.target,
        provider: data.targetProvider,
        epoch: data.epoch,
      });
      refreshPublicMaps();
      refreshTopologyGraph();
    } catch (transitionError) {
      preparedTransition = null;
      if (getActiveProvider() === null) transportReady.value = false;
      if (destinationSfu && destinationSfu === getSfu()) await closeSfuSafely();
      if (transitionError?.code === "MEDIA_SESSION_CLOSED") return;
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
      mediaDebug("topology.handoff-failed", {
        target: data.target,
        provider: data.targetProvider,
        epoch: data.epoch,
        reason: transitionError.message,
      });
    }
  }

  function waitForProviderTicket(epoch, provider) {
    if (getSfu() && getSelectedSfuProvider() === provider)
      return Promise.resolve(true);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        providerTicketWaiters.delete(Number(epoch));
        reject(new Error(`Provider ${provider} ticket timed out`));
      }, waitForMediaTimeoutMs());
      providerTicketWaiters.set(Number(epoch), (ready) => {
        clearTimeout(timeout);
        if (ready) resolve(true);
        else reject(new Error("Provider ticket cancelled"));
      });
    });
  }

  async function activateP2p(data, generation) {
    const mesh = ensureP2p();
    if (!mesh) throw new Error("Native WebRTC is unavailable");
    mesh.applyTopology({ ...data, localPeerId: getLocalPeerId() });
    await publishLocalSources(mesh);
    if (!matchesPreparedActivation(preparedTransition, data, "p2p"))
      await waitForRemoteTracks("p2p", data);
    mediaGeneration.assert(generation);
    handoff.bind("p2p");
    setActiveProvider("p2p");
    handoff.retire("sfu");
    await closeSfuSafely();
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
    reportedSfuFailureState.value = null;
    handoff.retire("p2p");
    await closeP2pSafely();
    transportReady.value = true;
    const readiness = session.connectionState();
    iceConnectedBoth.value =
      readiness?.sendRequired === true &&
      readiness?.receiveRequired === true &&
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
      getLocalPeerId,
      getP2pMesh,
      getSfu,
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

  async function handleProviderTicket(data) {
    if (!data?.provider || Number(data.epoch) < highestQueuedEpoch) return;
    setSelectedSfuProvider(data.provider);
    providerTicketWaiters.get(Number(data.epoch))?.(true);
    providerTicketWaiters.delete(Number(data.epoch));
    await closeSfuSafely();
    if (data.provider === "cloudflare-realtime") {
      getProviderSocket()?.close();
      setProviderSocket(null);
      await ensureSfu().initialize();
      for (const publication of onRemotePublication())
        await getSfu().handle("cloudflare-publication-available", publication);
      send({
        type: "provider-ready",
        data: { provider: data.provider, epoch: data.epoch },
      });
      return;
    }
    if (data.provider !== "mediasoup" || !data.signalingUrl) return;
    getProviderSocket()?.close();
    let socket = null;
    socket = new MediasoupProviderSocket({
      onMessage: (type, payload) => {
        if (type === "provider-draining") {
          const failure = {
            provider: data.provider,
            epoch: data.epoch,
            reason: payload?.reason || "provider-draining",
          };
          socket.close();
          setProviderSocket(null);
          handleProviderFailure(failure);
          send({ type: "provider-failure", data: failure });
          return;
        }
        return getMessageHandler(type)?.(payload || {});
      },
      onFailure: (providerError) => {
        error.value = providerError;
        send({
          type: "provider-failure",
          data: {
            provider: "mediasoup",
            epoch: data.epoch,
            reason: providerError.message,
          },
        });
      },
    });
    setProviderSocket(socket);
    await socket.connect(data);
    providerTicketWaiters.get(Number(data.epoch))?.(true);
    providerTicketWaiters.delete(Number(data.epoch));
    send({
      type: "provider-ready",
      data: { provider: "mediasoup", epoch: data.epoch },
    });
  }

  function reset() {
    mediaGeneration.retire();
    for (const resolve of providerTicketWaiters.values()) resolve(false);
    providerTicketWaiters.clear();
    pendingTopologyKey = null;
    appliedTopologyKey = null;
    latestTopologyKey = null;
    highestQueuedEpoch = 0;
    topologyOperation = Promise.resolve();
    preparedTransition = null;
    reportedSfuFailureState.value = null;
  }

  function applyAdaptiveJitterBuffer() {
    const provider = getActiveProvider();
    if (provider === "p2p" && getP2pMesh()) {
      const values = Object.values(peerConnectionMetrics.value).filter(
        (metric) => metric && Number.isFinite(metric.rttMs),
      );
      const jitterMs = values.reduce(
        (max, metric) => Math.max(max, metric.jitterMs ?? 0),
        0,
      );
      const rttMs = values.reduce(
        (max, metric) => Math.max(max, metric.rttMs ?? 0),
        0,
      );
      const lossPercent = values.reduce(
        (max, metric) => Math.max(max, metric.packetLossPercent ?? 0),
        0,
      );
      const raw = computeJitterBufferConfig({
        jitterMs,
        rttMs,
        lossPercent,
      });
      if (raw) {
        const smoothed = smoothJitterBufferConfig(
          currentJitterBufferConfig.value,
          raw,
        );
        currentJitterBufferConfig.value = smoothed;
        getP2pMesh().setJitterBufferConfig(smoothed);
      }
    } else if (provider === "sfu" && getSfu()) {
      const raw = computeSfuJitterBufferConfig({
        rttMs: sfuRoundTripTime.value,
      });
      if (raw) {
        const smoothed = smoothJitterBufferConfig(
          currentJitterBufferConfig.value,
          raw,
        );
        currentJitterBufferConfig.value = smoothed;
        getSfu().setJitterBufferConfig(smoothed);
      }
    }
  }

  return {
    applyAdaptiveJitterBuffer,
    ensureP2p,
    ensureSfu,
    handleP2pQualification,
    handleProviderFailure,
    handleProviderTicket,
    queueTopology,
    reportSfuFailure,
    reset,
  };
}
