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
import { normalizeIceServers } from "../native-p2p-common.ts";
import type {
  CloudflareConsumerEntry,
  CloudflarePublication,
} from "../types/cloudflare-media.ts";
import type { MediasoupConsumerEntry } from "../types/mediasoup-client.ts";
import type {
  TopologyControllerOptions,
  TopologyData,
  TopologySfuSession,
  TopologySourceEntry,
} from "../types/topology-controller.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isMediaStreamTrack(value: unknown): value is MediaStreamTrack {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.kind === "audio" || value.kind === "video")
  );
}

function topologySourceEntry(
  entry:
    CloudflareConsumerEntry | CloudflarePublication | MediasoupConsumerEntry,
): TopologySourceEntry | null {
  if (
    !("track" in entry) ||
    !isMediaStreamTrack(entry.track) ||
    typeof entry.source !== "string"
  )
    return null;
  return {
    ...entry,
    source: entry.source,
    track: entry.track,
  };
}

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
  getConnectionEpoch = () => 0,
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
  onTopologyStateUpdated,
  peerConnectionMetrics,
  publishLocalSources,
  refreshPublicMaps,
  refreshTopologyGraph,
  reportedSfuFailureState,
  replayCloudflarePublications,
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
    handleProviderRecovering,
  } = createTopologyResourceHelpers({
    NativeP2pMesh,
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
    getConnectionEpoch,
  });

  function ensureSfu(): TopologySfuSession {
    const existing = getSfu();
    if (existing) return existing;
    const provider = getSelectedSfuProvider();
    const { providerId } = resolveMediaProviderIdentity(
      topologyState.value,
      true,
    );
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
    const iceServers = normalizeIceServers(getIceServers());
    const onRemoteTrack = (
      entry: CloudflareConsumerEntry | MediasoupConsumerEntry,
    ) => {
      const sourceEntry = topologySourceEntry(entry);
      if (!sourceEntry) return;
      handoff.stage(
        {
          ...sourceEntry,
          key: sourceEntry.key || remoteMediaFeedKey(sourceEntry),
          provider: "sfu",
        },
        getActiveProvider(),
      );
    };
    const onRemoteTrackEnded = (
      entry:
        | CloudflareConsumerEntry
        | CloudflarePublication
        | MediasoupConsumerEntry,
    ) => {
      const sourceEntry = topologySourceEntry(entry);
      if (!sourceEntry) return;
      handoff.remove({
        ...sourceEntry,
        key: sourceEntry.key || remoteMediaFeedKey(sourceEntry),
        provider: "sfu",
      });
    };
    const onStateChange = (
      direction: string,
      state: string,
      summary: Record<string, unknown>,
    ) => {
      const fallbackActive = getActiveProvider() === "sfu";
      if (topologyState.value.mode !== "sfu" && !fallbackActive) return;
      if (state === "closed") {
        mediaConnectionState.value = "failed";
        setConnectionPhase("failed", {
          direction,
          reason: `transport-${state}`,
        });
        reportSfuFailure("media-transport-failed", provider);
        return;
      }
      if (state === "failed") {
        mediaConnectionState.value = "recovering";
        setConnectionPhase("reconnecting", {
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
    };
    const getVideoSettings = (source: string): Record<string, unknown> => ({
      ...getRequestedVideoSettings(source),
    });
    const session =
      provider === "cloudflare-realtime"
        ? new CloudflareRealtimeSession({
            send: (message) => Boolean(send(message)),
            iceServers,
            getControlConnectionEpoch: () => getConnectionEpoch(),
            localPeerId: getLocalPeerId() || undefined,
            onRemoteTrack,
            onRemoteTrackEnded,
            onStateChange,
            getVideoSettings,
          })
        : new MediasoupClientSession({
            send: (message) => getProviderSocket()?.send(message) ?? false,
            iceServers,
            onRemoteTrack,
            onRemoteTrackEnded,
            onStateChange,
            getAudioBitrate: getEffectiveAudioBitrate,
            getAudioStereo,
            getVideoSettings,
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
  let stagedSfu: {
    generation: number;
    session: TopologySfuSession;
  } | null = null;

  async function prepareSfu(
    data: TopologyData,
    generation: number,
    signal?: AbortSignal,
  ): Promise<TopologySfuSession> {
    const identity = resolveMediaProviderIdentity(data, true);
    const provider = identity.provider || getSelectedSfuProvider();
    if (identity.provider) setSelectedSfuProvider(identity.provider);
    if (provider === "mediasoup") {
      const epoch = Number(data.epoch);
      const sourceRevision = Number.isFinite(Number(data.sourceRevision))
        ? Number(data.sourceRevision)
        : Number(topologyState.value.sourceRevision) || 0;
      if (Number.isSafeInteger(epoch))
        await waitForProviderTicket(
          epoch,
          provider,
          identity.providerId,
          sourceRevision,
          signal,
        );
      else throw new Error("Mediasoup provider ticket is unavailable");
    }
    if (signal?.aborted)
      throw signal.reason || new Error("Topology superseded");
    const previousSfu = getSfu();
    const session = ensureSfu();
    stagedSfu = { generation, session };
    try {
      await session.initialize();
      for (const entry of localSources.values()) await session.addSource(entry);
      await replayCloudflarePublications(session);
      await session.startSubscriptions?.();
      mediaGeneration.assert(generation);
      if (signal?.aborted)
        throw signal.reason || new Error("Topology superseded");
      return session;
    } catch (preparationError) {
      if (
        stagedSfu?.generation === generation &&
        stagedSfu.session === session
      ) {
        stagedSfu = null;
        if (
          getSfu() === session &&
          (previousSfu !== session || getActiveProvider() !== "sfu")
        )
          try {
            await closeSfuSafely();
          } catch {}
      }
      throw preparationError;
    }
  }

  async function cleanupStagedSfu(
    generation: number,
    session: TopologySfuSession | null,
  ) {
    if (
      !session ||
      stagedSfu?.generation !== generation ||
      stagedSfu.session !== session ||
      getSfu() !== session ||
      getActiveProvider() === "sfu"
    )
      return;
    stagedSfu = null;
    try {
      await closeSfuSafely();
    } catch {}
  }

  function sendTopologyReady(data: TopologyData, session: TopologySfuSession) {
    const identity = resolveMediaProviderIdentity(data, true);
    const provider = identity.provider || session.provider || null;
    if (!provider) throw new Error("SFU provider identity is unavailable");
    const providerId = identity.providerId || session.providerId || null;
    const sourceRevision = Number.isFinite(Number(data.sourceRevision))
      ? Number(data.sourceRevision)
      : Number(topologyState.value.sourceRevision) || 0;
    if (
      send({
        type: "topology-ready",
        data: {
          provider,
          ...(providerId ? { providerId } : {}),
          epoch: Number(data.epoch),
          target: "sfu",
          sourceRevision,
        },
      }) === false
    )
      throw new Error("Media control signaling unavailable");
  }

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
    const currentTransport =
      previousProvider === "p2p" || previousProvider === "sfu"
        ? previousProvider
        : null;

    const incomingMode = (data.mode || "idle") as
      "idle" | "probing" | "switching" | "p2p" | "sfu";
    let canonicalMode: "idle" | "probing" | "switching" | "p2p" | "sfu" =
      incomingMode;
    let activeTransport: "p2p" | "sfu" | null = currentTransport;
    let targetTransport: "p2p" | "sfu" | null = null;

    if (incomingMode === "switching") {
      canonicalMode = "switching";
      targetTransport = data.target === "sfu" ? "sfu" : "p2p";
      activeTransport = currentTransport;
    } else if (incomingMode === "probing") {
      canonicalMode = "probing";
      targetTransport = "p2p";
      activeTransport = currentTransport;
    } else if (incomingMode === "p2p" || incomingMode === "sfu") {
      canonicalMode = incomingMode;
      activeTransport = currentTransport;
      targetTransport = currentTransport === incomingMode ? null : incomingMode;
    } else {
      canonicalMode = "idle";
      activeTransport = null;
      targetTransport = null;
    }

    topologyState.value = {
      mode: incomingMode,
      canonicalMode,
      activeTransport,
      targetTransport,
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
      startConvergence(data, generation, signal);
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
      void ensureQualificationFallback(data, generation)
        .then(async () => {
          mediaGeneration.assert(generation);
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
          if (signal?.aborted) return;
          transportReady.value = getActiveProvider() !== null;
          iceConnectedBoth.value = false;
          mediaConnectionState.value = "topology-probing";
          refreshTopologyGraph();
          startConvergence(data, generation, signal);
        })
        .catch((err) => {
          if (signal?.aborted) return;
          handleTopologyFailure(data, err);
        });
      return;
    }
    startTopologyTransition(data, generation, signal);
  }

  function startConvergence(
    data: TopologyData,
    generation: number,
    signal?: AbortSignal,
  ) {
    const abort = new AbortController();
    const convergenceSignal = signal
      ? AbortSignal.any([signal, abort.signal])
      : abort.signal;
    mediaGeneration.assert(generation);
    const provider = getActiveProvider() === "sfu" ? "sfu" : "p2p";
    waitForRemoteTracks(provider, data, convergenceSignal)
      .then(() => {
        if (convergenceSignal.aborted) return;
        const activeIsSfu = getActiveProvider() === "sfu";
        const readiness = activeIsSfu
          ? getSfu()?.connectionState()
          : { ready: true };
        transportReady.value = readiness?.ready === true;
        iceConnectedBoth.value = activeIsSfu
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
      })
      .catch((err) => {
        if (convergenceSignal.aborted) return;
        handleTopologyFailure(data, err);
      });
  }

  function startTopologyTransition(
    data: TopologyData,
    generation: number,
    signal?: AbortSignal,
  ) {
    const abort = new AbortController();
    const transitionSignal = signal
      ? AbortSignal.any([signal, abort.signal])
      : abort.signal;
    mediaGeneration.assert(generation);
    let preparedSession: TopologySfuSession | null = null;
    const transitionPromise = (async () => {
      const targetMode =
        data.mode === "sfu" ? "sfu" : data.target === "sfu" ? "sfu" : "p2p";
      if (data.mode === "switching") {
        const currentProvider = getActiveProvider();
        if (targetMode === "sfu") {
          const session = await prepareSfu(data, generation, transitionSignal);
          preparedSession = session;
          await waitForRemoteTracks("sfu", data, transitionSignal);
          mediaGeneration.assert(generation);
          sendTopologyReady(data, session);
        } else if (targetMode === "p2p" && currentProvider !== "p2p") {
          const mesh = ensureP2p();
          if (mesh) {
            await mesh.applyTopology({
              ...data,
              localPeerId: getLocalPeerId(),
            });
            await publishLocalSources(mesh);
          }
        }
        mediaGeneration.assert(generation);
        topologyState.value = {
          ...topologyState.value,
          activeTransport:
            currentProvider === "p2p" || currentProvider === "sfu"
              ? currentProvider
              : null,
          targetTransport: targetMode,
        };
        refreshPublicMaps();
        refreshTopologyGraph();
        return;
      }
      if (data.mode === "p2p") {
        const currentProvider = getActiveProvider();
        if (currentProvider === "p2p") {
          // Already on P2P, just update topology and converge
          const mesh = ensureP2p();
          if (mesh) {
            await mesh.applyTopology({
              ...data,
              localPeerId: getLocalPeerId(),
            });
            await publishLocalSources(mesh);
          }
        } else if (currentProvider === "sfu") {
          // Switching from SFU to P2P - retire SFU, promote prepared P2P if available
          await closeSfuSafely();
          handoff.retire("sfu");
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
        } else {
          // No current provider, establish P2P
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
        }
      } else if (data.mode === "sfu") {
        const currentProvider = getActiveProvider();
        preparedSession = await prepareSfu(data, generation, transitionSignal);
        if (currentProvider === "p2p") {
          await closeP2pSafely();
          handoff.retire("p2p");
        }
        handoff.bind("sfu");
        setActiveProvider("sfu");
        if (
          stagedSfu?.generation === generation &&
          stagedSfu.session === preparedSession
        )
          stagedSfu = null;
      }
      mediaGeneration.assert(generation);
      setActiveProvider(targetMode);
      topologyState.value = {
        ...topologyState.value,
        activeTransport: targetMode,
        targetTransport: null,
      };
      transportReady.value = getActiveProvider() !== null;
      iceConnectedBoth.value = false;
      mediaConnectionState.value = "topology-connecting";
      setConnectionPhase("media-connecting", {
        topologyEpoch: Number(data.epoch),
        topologyMode: data.mode,
      });
      startConvergence(data, generation, transitionSignal);
    })();
    transitionPromise.catch(async (err) => {
      await cleanupStagedSfu(generation, preparedSession);
      if (transitionSignal.aborted) return;
      handleTopologyFailure(data, err);
    });
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
          isRecord(metric) && Number.isFinite(Number(metric.rttMs)),
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
    handleProviderRecovering,
    handleProviderTicket,
    queueTopology,
    reportSfuFailure,
    reset,
  };
}
