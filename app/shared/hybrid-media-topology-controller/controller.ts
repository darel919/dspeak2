import { mediaDebug } from "../media-debug.ts";
import { waitForMediaHandoff } from "../media-handoff-readiness.ts";
import {
  computeJitterBufferConfig,
  computeSfuJitterBufferConfig,
  smoothJitterBufferConfig,
} from "../adaptive-jitter-buffer.ts";
import { createTopologyProviderActions } from "./providers.ts";
import { createTopologyResourceHelpers } from "./resources.ts";
import { resolveMediaProviderIdentity } from "../media-provider-identity.ts";
import { remoteMediaFeedKey } from "../remote-media-handoff.ts";
import type {
  TopologyControllerOptions,
  TopologyData,
  TopologyConnectionState,
  TopologyP2pMesh,
  TopologySfuSession,
  TopologySourceEntry,
} from "../types/topology-controller.ts";

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
  getMediaCapabilities = () => null,
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
}: TopologyControllerOptions) {
  let topologyOperation = Promise.resolve();
  let pendingTopologyKey: string | null = null;
  let appliedTopologyKey: string | null = null;
  let latestTopologyKey: string | null = null;
  let highestQueuedEpoch = 0;
  let highestQueuedSourceRevision = 0;
  let activeTopologyAbort: AbortController | null = null;
  const {
    closeP2pSafely,
    closeSfuSafely,
    ensureP2p,
    handleP2pQualification,
    handleProviderFailure,
  } = createTopologyResourceHelpers({
    NativeP2pMesh: NativeP2pMesh as never,
    buildP2pVideoSenderOptions,
    buildVoiceProducerOptions,
    closeSocket,
    getActiveProvider,
    getAudioStereo,
    getEffectiveAudioBitrate,
    getIceServers,
    getMediaCapabilities,
    getP2pMesh,
    getRequestedVideoSettings,
    getSelectedSfuProvider,
    getSfu,
    handoff,
    iceConnectedBoth,
    mediaConnectionState,
    onP2pQualification,
    send,
    setActiveProvider,
    setP2pMesh,
    setProviderSocket,
    setSfu,
    setConnectionPhase,
    topologyState,
    transportReady,
    updateP2pStats,
  });

  function ensureSfu(): TopologySfuSession {
    const existing = getSfu();
    if (existing) return existing;
    const provider = getSelectedSfuProvider();
    const { providerId } = resolveMediaProviderIdentity(
      topologyState.value,
      true,
    );
    const SessionClass = (
      provider === "cloudflare-realtime"
        ? CloudflareRealtimeSession
        : MediasoupClientSession
    ) as new (options: Record<string, unknown>) => TopologySfuSession;
    const hasLocalAudio = [...localSources.values()].some(
      (entry) => entry.track.kind === "audio",
    );
    const hasLocalVideo = [...localSources.values()].some(
      (entry) => entry.track.kind === "video",
    );
    const mediaProfile = hasLocalVideo
      ? hasLocalAudio
        ? "mixed"
        : "video"
      : "audio";
    const session = new SessionClass({
      send: (message: Record<string, unknown>) =>
        provider === "cloudflare-realtime"
          ? send(message)
          : Boolean(getProviderSocket()?.send(message)),
      iceServers: getIceServers(),
      onRemoteTrack: (entry: TopologySourceEntry) =>
        handoff.stage(
          {
            ...entry,
            key: entry.key || remoteMediaFeedKey(entry),
            provider: entry.provider || provider,
          },
          getActiveProvider(),
        ),
      onRemoteTrackEnded: (entry: TopologySourceEntry) =>
        handoff.remove({
          ...entry,
          key: entry.key || remoteMediaFeedKey(entry),
          provider: entry.provider || provider,
        }),
      onStateChange: (
        direction: string,
        state: string,
        summary: TopologyConnectionState,
      ) => {
        const fallbackActive = getActiveProvider() === "sfu";
        if (topologyState.value.mode !== "sfu" && !fallbackActive) return;
        if (state === "failed" || state === "closed") {
          mediaConnectionState.value = "failed";
          setConnectionPhase("failed", {
            direction,
            reason: `transport-${state}`,
          });
          reportSfuFailure("media-transport-failed", provider);
          return;
        }
        transportReady.value = summary.ready === true;
        iceConnectedBoth.value =
          summary.sendRequired === true &&
          summary.receiveRequired === true &&
          summary.send === "connected" &&
          summary.recv === "connected";
      },
      getAudioBitrate: getEffectiveAudioBitrate,
      getAudioStereo,
      getVideoSettings: getRequestedVideoSettings,
      mediaProfile,
    });
    session.provider = provider;
    session.providerId = providerId;
    setSfu(session);
    mediaDebug("topology.sfu-created", { provider });
    return session;
  }

  const {
    handleProviderTicket,
    reset: resetProviderActions,
    waitForProviderTicket,
  } = createTopologyProviderActions({
    MediasoupProviderSocket,
    closeSfuSafely,
    ensureSfu,
    error,
    getActiveProvider,
    getHighestQueuedEpoch: () => highestQueuedEpoch,
    getMediaCapabilities,
    getMessageHandler,
    getProviderSocket,
    getSelectedSfuProvider,
    getSfu,
    handleProviderFailure,
    replayCloudflarePublications,
    send,
    setProviderSocket,
    setSelectedSfuProvider,
    topologyState,
    waitForMediaTimeoutMs,
  });

  function queueTopology(data: TopologyData): Promise<unknown> {
    setConnectionPhase("topology-selecting", {
      topologyEpoch: Number(data.epoch) || 0,
      topologyMode: data.mode || null,
      sourceRevision: Number(data.sourceRevision) || 0,
    });
    const epoch = Number(data.epoch);
    if (
      !shouldAcceptTopologyEvent(
        data,
        highestQueuedEpoch,
        highestQueuedSourceRevision,
      )
    )
      return topologyOperation;
    const sourceRevision = Number(data.sourceRevision) || 0;
    if (epoch > highestQueuedEpoch)
      highestQueuedSourceRevision = sourceRevision;
    else
      highestQueuedSourceRevision = Math.max(
        highestQueuedSourceRevision,
        sourceRevision,
      );
    highestQueuedEpoch = Math.max(highestQueuedEpoch, epoch);
    const key = topologyEventKey(data);
    latestTopologyKey = key;
    if (key === appliedTopologyKey || key === pendingTopologyKey)
      return topologyOperation;
    pendingTopologyKey = key;
    const generation = mediaGeneration.capture();
    activeTopologyAbort?.abort(new Error("Topology superseded"));
    const abort = new AbortController();
    activeTopologyAbort = abort;
    topologyOperation = topologyOperation
      .catch(() => {})
      .then(() => applyTopology(data, generation, abort.signal))
      .then(() => {
        appliedTopologyKey = key;
        if (activeTopologyAbort === abort) activeTopologyAbort = null;
      })
      .catch((topologyError) => handleTopologyFailure(data, topologyError))
      .finally(() => {
        if (pendingTopologyKey === key) pendingTopologyKey = null;
        if (activeTopologyAbort === abort) activeTopologyAbort = null;
      });
    mediaDebug("topology.queued", {
      mode: data.mode || "idle",
      target: data.target,
      provider: data.provider || data.targetProvider,
      epoch,
      sourceRevision: data.sourceRevision,
    });
    return topologyOperation;
  }

  async function applyTopology(
    data: TopologyData,
    generation: number,
    signal?: AbortSignal,
  ) {
    mediaGeneration.assert(generation);
    if (signal?.aborted)
      throw signal.reason || new Error("Topology superseded");
    const epoch = Number(data.epoch);
    const sourceRevision = Number(data.sourceRevision) || 0;
    if (
      epoch < topologyState.value.epoch ||
      (epoch === topologyState.value.epoch &&
        sourceRevision < Number(topologyState.value.sourceRevision || 0))
    )
      return;
    const previousProvider = getActiveProvider();
    const previousSfu = getSfu();
    topologyState.value = {
      mode: data.mode || "idle",
      epoch: Number(data.epoch),
      provider: data.provider || data.targetProvider || null,
      providerId:
        data.providerId ||
        data.targetProviderId ||
        data.targetRoute?.providerId ||
        data.route?.providerId ||
        null,
      targetProvider: data.targetProvider || null,
      targetProviderId: data.targetProviderId || null,
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
    const previousSelectedSfuProvider = getSelectedSfuProvider();
    const selectedProvider =
      data.mode === "sfu"
        ? data.provider
        : data.target === "sfu"
          ? data.targetProvider || data.provider
          : null;
    if (selectedProvider) setSelectedSfuProvider(selectedProvider);
    handoff.pruneExpectedFeeds(topologyState.value.peers, getLocalPeerId());
    onTopologyStateUpdated?.(data, topologyState.value);
    refreshPublicMaps();
    refreshTopologyGraph();
    const activeSfuMatches =
      data.mode === "sfu" &&
      getActiveProvider() === "sfu" &&
      (!data.provider || data.provider === previousSelectedSfuProvider) &&
      (!data.providerId ||
        (previousSfu?.providerId &&
          previousSfu.providerId === data.providerId));
    if (
      data.mode === getActiveProvider() &&
      (data.mode !== "sfu" || activeSfuMatches)
    ) {
      await updateActiveTopology(data, generation, signal);
      return;
    }
    if (data.mode === "idle") {
      setActiveProvider(null);
      handoff.clear();
      await closeP2pSafely();
      await closeSfuSafely();
      transportReady.value = true;
      iceConnectedBoth.value = false;
      mediaConnectionState.value = "ready-no-active-media";
      setConnectionPhase("media-ready", { topologyMode: "idle" });
      refreshPublicMaps();
      refreshTopologyGraph();
      return;
    }
    if (data.mode === "probing") {
      await ensureQualificationFallback(data, generation);
      const mesh = ensureP2p();
      if (!mesh) {
        send({
          type: "p2p-failed",
          data: { epoch: data.epoch, reason: "webrtc-unavailable" },
        });
        return;
      }
      await mesh.applyTopology({ ...data, localPeerId: getLocalPeerId() });
      await publishLocalSources(mesh);
      mediaGeneration.assert(generation);
      transportReady.value = getActiveProvider() !== null;
      iceConnectedBoth.value = false;
      mediaConnectionState.value = "topology-probing";
      refreshTopologyGraph();
      return;
    }
    if (data.mode === "switching") {
      mediaConnectionState.value = "recovering";
      await prepareTransition(data, generation, signal);
      return;
    }
    if (data.mode === "p2p") {
      await activateP2p(data, generation, signal);
      return;
    }
    if (data.mode === "sfu") await activateSfu(data, generation, signal);
  }

  async function publishLocalSources(
    provider: TopologyP2pMesh | TopologySfuSession | null,
  ) {
    if (!provider) return;
    await Promise.all(
      [...localSources.values()].map((entry) =>
        provider.publishSource(entry.source, entry.track, entry.stream, entry),
      ),
    );
  }

  async function replayCloudflarePublications(
    session: TopologySfuSession | null,
  ) {
    if (session?.provider !== "cloudflare-realtime") return;
    for (const publication of onRemotePublication())
      await session.handle("cloudflare-publication-available", publication);
  }

  async function ensureQualificationFallback(
    data: TopologyData,
    generation: number,
  ) {
    if (getActiveProvider() !== null || data.provider !== "cloudflare-realtime")
      return;
    setSelectedSfuProvider(data.provider);
    const session = ensureSfu();
    try {
      await session.initialize();
      for (const entry of localSources.values()) await session.addSource(entry);
      await replayCloudflarePublications(session);
      await session.startSubscriptions?.();
      mediaGeneration.assert(generation);
      handoff.bind("sfu");
      setActiveProvider("sfu");
    } catch (fallbackError) {
      if (getActiveProvider() === null && getSfu() === session)
        await closeSfuSafely();
      throw fallbackError;
    }
  }

  async function updateActiveTopology(
    data: TopologyData,
    generation: number,
    signal?: AbortSignal,
  ) {
    if (data.mode === "p2p") {
      await getP2pMesh()?.applyTopology({
        ...data,
        localPeerId: getLocalPeerId(),
      });
      await publishLocalSources(getP2pMesh());
      await waitForRemoteTracks("p2p", data, signal);
      mediaGeneration.assert(generation);
    } else if (data.mode === "sfu") {
      await closeP2pSafely();
      handoff.retire("p2p");
      await waitForRemoteTracks("sfu", data, signal);
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

  function handleTopologyFailure(data: TopologyData, topologyError: unknown) {
    if (topologyEventKey(data) !== latestTopologyKey) return;
    if (
      topologyError instanceof Error &&
      (topologyError.name === "AbortError" ||
        /superseded/i.test(topologyError.message))
    ) {
      mediaDebug("topology.superseded", {
        mode: data.mode,
        target: data.target,
        epoch: data.epoch,
      });
      return;
    }
    const reason =
      topologyError instanceof Error
        ? topologyError.message
        : "Topology operation failed";
    if (
      data.mode === "probing" ||
      data.mode === "p2p" ||
      data.target === "p2p"
    ) {
      if (
        data.mode === "probing" &&
        data.provider &&
        getActiveProvider() === null
      ) {
        send({
          type: "provider-failure",
          data: {
            provider: data.provider,
            ...(data.providerId ? { providerId: data.providerId } : {}),
            epoch: data.epoch,
            sourceRevision: data.sourceRevision,
            reason: `fallback-activation-failed-${reason}`,
          },
        });
        return;
      }
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

  function reportSfuFailure(
    reason: string,
    failedProvider: string | null = null,
    failedProviderId: string | null = null,
  ) {
    const epoch = topologyState.value.epoch;
    const sourceRevision = topologyState.value.sourceRevision;
    const identity = resolveMediaProviderIdentity(
      topologyState.value,
      topologyState.value.target === "sfu",
    );
    const provider =
      failedProvider ||
      getSfu()?.provider ||
      identity.provider ||
      getSelectedSfuProvider();
    const providerId =
      failedProviderId || getSfu()?.providerId || identity.providerId;
    const failureKey = `${provider}:${providerId || "family"}:${epoch}:${sourceRevision}`;
    if (reportedSfuFailureState.value === failureKey) return;
    reportedSfuFailureState.value = failureKey;
    send({
      type: "provider-failure",
      data: {
        provider,
        ...(providerId ? { providerId } : {}),
        epoch,
        sourceRevision,
        reason,
      },
    });
    transportReady.value = false;
    iceConnectedBoth.value = false;
    mediaConnectionState.value = "recovering";
    setConnectionPhase("reconnecting", { reason });
    mediaDebug("topology.sfu-failure-reported", { epoch, reason });
  }

  async function prepareTransition(
    data: TopologyData,
    generation: number,
    signal?: AbortSignal,
  ) {
    let destinationSfu: TopologySfuSession | null = null;
    try {
      transportReady.value = getActiveProvider() !== null;
      if (data.target === "p2p") {
        const mesh = ensureP2p();
        if (!mesh) throw new Error("Native WebRTC is unavailable");
        await mesh.applyTopology({
          ...data,
          mode: "p2p",
          localPeerId: getLocalPeerId(),
        });
        await publishLocalSources(mesh);
        await waitForRemoteTracks("p2p", data, signal);
      } else if (data.target === "sfu") {
        const targetProvider = data.targetProvider;
        if (!targetProvider)
          throw new Error("SFU topology transition has no provider");
        const existingSfu = getSfu();
        const sameActiveProvider =
          getActiveProvider() === "sfu" &&
          existingSfu &&
          getSelectedSfuProvider() === targetProvider &&
          (!data.targetProviderId ||
            existingSfu.providerId === data.targetProviderId);
        if (targetProvider === "cloudflare-realtime") {
          setSelectedSfuProvider(targetProvider);
          if (!sameActiveProvider) {
            closeSocket();
            setProviderSocket(null);
            await closeSfuSafely();
          }
        } else if (
          !getSfu() ||
          getSelectedSfuProvider() !== targetProvider ||
          (data.targetProviderId &&
            getSfu()?.providerId !== data.targetProviderId)
        ) {
          await waitForProviderTicket(
            Number(data.epoch),
            targetProvider,
            data.targetProviderId || data.providerId || null,
          );
        }
        destinationSfu = ensureSfu();
        if (getActiveProvider() === "sfu" && destinationSfu !== existingSfu) {
          await closeSfuSafely();
          destinationSfu = ensureSfu();
        }
        await destinationSfu.initialize();
        for (const entry of localSources.values())
          await destinationSfu.addSource(entry);
        await replayCloudflarePublications(destinationSfu);
        await destinationSfu.startSubscriptions?.();
        await waitForRemoteTracks("sfu", data, signal);
      } else throw new Error("The server requested an invalid media topology");
      mediaGeneration.assert(generation);
      send({
        type: "topology-ready",
        data: {
          epoch: data.epoch,
          target: data.target,
          sourceRevision: data.sourceRevision,
          ...(data.target === "sfu"
            ? {
                provider: data.targetProvider || data.provider,
                providerId:
                  data.targetProviderId ||
                  data.providerId ||
                  data.targetRoute?.providerId ||
                  null,
              }
            : {}),
        },
      });
      mediaDebug("topology.prepared", {
        target: data.target,
        provider: data.targetProvider,
        epoch: data.epoch,
      });
      refreshPublicMaps();
      refreshTopologyGraph();
    } catch (transitionError: unknown) {
      if (getActiveProvider() === null) transportReady.value = false;
      if (destinationSfu && destinationSfu === getSfu()) await closeSfuSafely();
      if (
        transitionError &&
        typeof transitionError === "object" &&
        "code" in transitionError &&
        transitionError.code === "MEDIA_SESSION_CLOSED"
      )
        return;
      if (topologyEventKey(data) !== latestTopologyKey) return;
      send({
        type: "topology-failed",
        data: {
          epoch: data.epoch,
          target: data.target,
          sourceRevision: data.sourceRevision,
          ...(data.target === "sfu"
            ? {
                provider: data.targetProvider || data.provider,
                providerId:
                  data.targetProviderId ||
                  data.providerId ||
                  data.targetRoute?.providerId ||
                  null,
              }
            : {}),
          reason:
            transitionError instanceof Error
              ? transitionError.message
              : String(transitionError),
        },
      });
      mediaDebug("topology.handoff-failed", {
        target: data.target,
        provider: data.targetProvider,
        epoch: data.epoch,
        reason:
          transitionError instanceof Error
            ? transitionError.message
            : String(transitionError),
      });
    }
  }

  async function activateP2p(
    data: TopologyData,
    generation: number,
    signal?: AbortSignal,
  ) {
    const mesh = ensureP2p();
    if (!mesh) throw new Error("Native WebRTC is unavailable");
    await mesh.applyTopology({ ...data, localPeerId: getLocalPeerId() });
    await publishLocalSources(mesh);
    await waitForRemoteTracks("p2p", data, signal);
    mediaGeneration.assert(generation);
    handoff.bind("p2p");
    setActiveProvider("p2p");
    handoff.retire("sfu");
    await closeSfuSafely();
    transportReady.value = true;
    iceConnectedBoth.value = getP2pMesh()?.isMediaReady?.() === true;
    setRouteConnectionState(
      iceConnectedBoth.value ? "media-flowing" : "ready-no-active-media",
    );
    setConnectionPhase("media-ready", {
      topologyEpoch: Number(data.epoch),
      topologyMode: "p2p",
    });
    error.value = null;
    refreshPublicMaps();
    refreshTopologyGraph();
  }

  async function activateSfu(
    data: TopologyData,
    generation: number,
    signal?: AbortSignal,
  ) {
    transportReady.value = false;
    mediaConnectionState.value = "transport-connecting";
    setConnectionPhase("transport-connecting", {
      topologyEpoch: Number(data.epoch),
      topologyMode: "sfu",
    });
    const currentSfu = getSfu();
    if (
      currentSfu?.provider &&
      data.provider &&
      currentSfu.provider !== data.provider
    )
      await closeSfuSafely();
    if (
      currentSfu?.providerId &&
      data.providerId &&
      currentSfu.providerId !== data.providerId
    )
      await closeSfuSafely();
    const session = ensureSfu();
    await session.initialize();
    for (const entry of localSources.values()) await session.addSource(entry);
    await replayCloudflarePublications(session);
    await session.startSubscriptions?.();
    await waitForRemoteTracks("sfu", data, signal);
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
    refreshPublicMaps();
    refreshTopologyGraph();
  }

  function waitForRemoteTracks(
    provider: "p2p" | "sfu",
    topology: TopologyData,
    signal?: AbortSignal,
  ) {
    return waitForMediaHandoff({
      getLatestTopologyKey: () => latestTopologyKey || "",
      getLocalPeerId,
      getP2pMesh,
      getSfu,
      handoff,
      localSources,
      pollIntervalMs: mediaReadinessPollMs,
      provider,
      signal,
      timeoutMs: mediaHandoffTimeoutMs,
      topology,
      topologyEventKey,
      topologyState,
    });
  }

  function reset() {
    mediaGeneration.retire();
    activeTopologyAbort?.abort(new Error("Topology superseded"));
    activeTopologyAbort = null;
    resetProviderActions();
    pendingTopologyKey = null;
    appliedTopologyKey = null;
    latestTopologyKey = null;
    highestQueuedEpoch = 0;
    highestQueuedSourceRevision = 0;
    topologyOperation = Promise.resolve();
    reportedSfuFailureState.value = null;
  }

  function applyAdaptiveJitterBuffer() {
    const provider = getActiveProvider();
    if (provider === "p2p" && getP2pMesh()) {
      const values = Object.values(peerConnectionMetrics.value).filter(
        (metric): metric is Record<string, unknown> =>
          Boolean(metric) &&
          Number.isFinite(Number((metric as Record<string, unknown>).rttMs)),
      );
      const jitterMs = values.reduce(
        (max, metric) => Math.max(max, Number(metric.jitterMs) || 0),
        0,
      );
      const rttMs = values.reduce(
        (max, metric) => Math.max(max, Number(metric.rttMs) || 0),
        0,
      );
      const lossPercent = values.reduce(
        (max, metric) => Math.max(max, Number(metric.packetLossPercent) || 0),
        0,
      );
      const mesh = getP2pMesh();
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
        mesh?.setJitterBufferConfig(smoothed);
      }
    } else if (provider === "sfu" && getSfu()) {
      const sfu = getSfu();
      const raw = computeSfuJitterBufferConfig({
        rttMs: sfuRoundTripTime.value,
      });
      if (raw) {
        const smoothed = smoothJitterBufferConfig(
          currentJitterBufferConfig.value,
          raw,
        );
        currentJitterBufferConfig.value = smoothed;
        sfu?.setJitterBufferConfig(smoothed);
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
