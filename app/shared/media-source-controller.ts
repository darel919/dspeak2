import {
  adaptiveTrackConstraints,
  createAdaptiveVideoController,
} from "./adaptive-video-controller.ts";
import { mediaDebug } from "./media-debug.ts";
import { isFailureSourceScoped } from "./types/media-failure.ts";
import { resolveMediaProviderIdentity } from "./media-provider-identity.ts";
import type { MediaCaptureStartOptions } from "./types/media-capture.ts";
import type {
  MediaSourceControllerContext,
  SourceProvider,
} from "./types/media-source-controller.ts";
import type { AdaptiveVideoEntry } from "./types/adaptive-media.ts";
import type { TopologySourceEntry } from "./types/topology-controller.ts";

export function createMediaSourceController({
  capture,
  connected,
  createSharedAudioSource,
  error,
  getActiveProvider,
  getConnectionEpoch,
  getIntentionalClose,
  getLastAppliedRoomRevision,
  getP2pMesh,
  getSfu,
  getVideoReport = async () => null,
  getVideoSettings = () => ({
    frameRate: 30,
    qualityPriority: "framerate",
    resolution: "original",
  }),
  localSources,
  localVideoFeeds,
  onSharedAudioStopped,
  producerFacade,
  refreshMediaPolicy = () => Promise.resolve(),
  refreshPublicMaps,
  reportSfuFailure,
  send,
  startLocalVoiceDetection,
  startSharedAudioMeter,
  stopLocalVoiceDetection,
  stopSharedAudioMeter,
  topologyState,
  voiceStore,
}: MediaSourceControllerContext) {
  const asProvider = (value: unknown): SourceProvider | null =>
    value && typeof value === "object" ? (value as SourceProvider) : null;
  type SourceFsmPhase =
    | "idle"
    | "starting"
    | "live"
    | "stopping"
    | "failed"
    | "reconciling"
    | "recovering";
  interface SourceFsmState {
    phase: SourceFsmPhase;
    generation: number;
    desiredState: "active" | "inactive";
    provider: string | null;
    failedAt: number | null;
  }
  const sourceFsms = new Map<string, SourceFsmState>();
  function bumpSourceGeneration(source: string) {
    const current = sourceFsms.get(source);
    sourceFsms.set(source, {
      phase: current?.phase || "idle",
      generation: (current?.generation || 0) + 1,
      desiredState: current?.desiredState || "inactive",
      provider: current?.provider || null,
      failedAt: current?.failedAt || null,
    });
  }
  function setSourcePhase(
    source: string,
    phase: SourceFsmPhase,
    provider: string | null = null,
  ) {
    const current = sourceFsms.get(source) || {
      phase: "idle",
      generation: 0,
      desiredState: "inactive",
      provider: null,
      failedAt: null,
    };
    sourceFsms.set(source, {
      ...current,
      phase,
      generation:
        phase === "starting" || phase === "stopping"
          ? current.generation + 1
          : current.generation,
      desiredState:
        phase === "starting"
          ? "active"
          : phase === "stopping"
            ? "inactive"
            : current.desiredState,
      provider: provider ?? current.provider,
      failedAt: phase === "failed" ? Date.now() : null,
    });
  }
  function sourceFsmDigest() {
    return [...sourceFsms.entries()].reduce<Record<string, unknown>>(
      (digest, [source, state]) => {
        digest[source] = {
          phase: state.phase,
          generation: state.generation,
          desiredState: state.desiredState,
          provider: state.provider,
        };
        return digest;
      },
      {},
    );
  }

  // Commit source intent to server (media-sources) and wait for ACK.
  // This must happen BEFORE provider publication so the server has the
  // canonical sourceStates entry when the provider announces.
  async function commitSourceIntent(
    source: string,
    options: { isVideo?: boolean; ownerSource?: string } = {},
  ) {
    const operationId = nextOperationId();
    const currentState = sourceFsms.get(source);
    const generation = (currentState?.generation || 0) + 1;
    const desiredState = "active";

    // Bump generation and set desiredState optimistically
    sourceFsms.set(source, {
      phase: "starting",
      generation,
      desiredState,
      provider: getActiveProvider(),
      failedAt: null,
    });

    const sourcesArray = [...localSources.keys()];
    if (!sourcesArray.includes(source)) sourcesArray.push(source);

    const promise = awaitOperationAck(operationId);
    send({
      type: "media-sources",
      data: {
        sources: sourcesArray,
        operationId,
        requestId: operationId,
        connectionEpoch: getConnectionEpoch(),
        sourceStates: sourceFsmDigest(),
      },
    });

    try {
      await promise;
    } catch (error) {
      // On failure, rollback optimistic state
      if (currentState) {
        sourceFsms.set(source, currentState);
      } else {
        sourceFsms.delete(source);
      }
      throw error;
    }
    return generation;
  }

  const adaptiveVideo = createAdaptiveVideoController({
    apply: async (entry, state, settings) => {
      const mediaEntry = entry as AdaptiveVideoEntry;
      await mediaEntry.track.applyConstraints(
        adaptiveTrackConstraints(mediaEntry, state, settings),
      );
      await refreshMediaPolicy();
    },
    getReport: getVideoReport || (async () => null),
    getSettings:
      getVideoSettings ||
      (() => ({
        frameRate: 30,
        qualityPriority: "framerate",
        resolution: "original",
      })),
    onError: (adaptationError: unknown) =>
      console.warn(
        `[Media] Video adaptation failed: ${adaptationError instanceof Error ? adaptationError.message : String(adaptationError)}`,
      ),
  });
  function removeSfuSource(source: string) {
    const reportError = (sourceError: unknown) => {
      const details =
        sourceError && typeof sourceError === "object"
          ? (sourceError as { code?: string; message?: string })
          : {};
      if (details.code === "MEDIA_SESSION_CLOSED") return;
      error.value = details.message || `Unable to stop ${source} publication`;
      if (
        details.code === "MEDIA_SOURCE_TRANSPORT_FAILED" ||
        details.code === "MEDIA_PROVIDER_DEAD"
      )
        reportSfuFailure(
          `source-${source}-remove-failed-${details.message || "unknown"}`,
        );
    };
    try {
      return Promise.resolve(asProvider(getSfu())?.removeSource(source)).catch(
        (sourceError: unknown) => {
          reportError(sourceError);
          if (
            sourceError &&
            typeof sourceError === "object" &&
            "code" in sourceError &&
            sourceError.code === "MEDIA_SESSION_CLOSED"
          )
            return false;
          throw sourceError;
        },
      );
    } catch (sourceError: unknown) {
      reportError(sourceError);
      if (
        sourceError &&
        typeof sourceError === "object" &&
        "code" in sourceError &&
        sourceError.code === "MEDIA_SESSION_CLOSED"
      )
        return Promise.resolve(false);
      return Promise.reject(sourceError);
    }
  }
  async function publishSource(sourceEntry: TopologySourceEntry) {
    const entry =
      sourceEntry.source === "screen-audio"
        ? await createSharedAudioSource(sourceEntry)
        : sourceEntry;

    // Commit source intent FIRST (media-sources with generation) and wait for ACK.
    // This ensures server has canonical sourceStates before provider announces.
    const committedGeneration = await commitSourceIntent(entry.source, {
      isVideo: entry.source === "camera" || entry.source === "screen",
      ownerSource: entry.ownerSource ?? undefined,
    });
    entry.generation = committedGeneration;

    if (entry.source === "audio" && voiceStore.micMuted)
      entry.track.enabled = false;

    const previous = localSources.get(entry.source);
    const isVideo = entry.source === "camera" || entry.source === "screen";
    const previousVideoFeed = isVideo
      ? localVideoFeeds.value.get(entry.source)
      : null;
    if (isVideo) {
      localVideoFeeds.value.set(entry.source, {
        source: entry.source,
        stream: entry.stream,
        producerId: `local:${entry.track.id}`,
      });
      localVideoFeeds.value = new Map(localVideoFeeds.value);
    }
    const activeProvider = getActiveProvider();
    const p2pRequired =
      activeProvider === "p2p" ||
      topologyState.value.mode === "p2p" ||
      topologyState.value.mode === "probing" ||
      topologyState.value.target === "p2p";
    const sfuRequired =
      activeProvider === "sfu" ||
      topologyState.value.mode === "sfu" ||
      topologyState.value.target === "sfu";
    const p2pMesh = asProvider(getP2pMesh());
    const sfu = asProvider(getSfu());
    try {
      if (p2pRequired && !p2pMesh)
        throw new Error("The active P2P transport is unavailable");
      if (sfuRequired && !sfu)
        throw new Error("The active SFU transport is unavailable");
      const publications = await Promise.allSettled([
        p2pRequired
          ? p2pMesh!.publishSource(
              entry.source,
              entry.track,
              entry.stream,
              entry,
            )
          : Promise.resolve(),
        sfuRequired ? sfu!.addSource(entry) : Promise.resolve(),
      ]);
      const rejected = publications.find(
        (publication) => publication.status === "rejected",
      );
      if (rejected) throw rejected.reason;
      const captureTrack =
        (entry.captureTrack as MediaStreamTrack | undefined) || entry.track;
      if (
        captureTrack.readyState === "ended" ||
        entry.track.readyState === "ended"
      )
        throw new Error(`The ${entry.source} track ended during publication`);
      // If the source changed generation while publishing, fence this
      // publication: tear down the stale side and keep the newer generation.
      if (sourceFsms.get(entry.source)?.generation !== entry.generation) {
        await Promise.allSettled([
          p2pRequired
            ? asProvider(getP2pMesh())?.unpublishSource(entry.source)
            : null,
          sfuRequired ? asProvider(getSfu())?.removeSource(entry.source) : null,
        ]);
        return;
      }
    } catch (sourceError: unknown) {
      setSourcePhase(entry.source, "failed", getActiveProvider());
      const reason = `source-${entry.source}-failed-${sourceError instanceof Error ? sourceError.message : String(sourceError)}`;
      // Send compensating media-sources mutation to retire the canonical source
      // that was committed before provider publication failed.
      // Use the full canonical desired-state builder (sendSourceState pattern)
      // to avoid partial mutations and generation 0.
      const currentSourceFsm = new Map(sourceFsms);
      // The failed source's generation was already committed by commitSourceIntent; bump it for retirement/recovery
      const fsm = currentSourceFsm.get(entry.source);
      const isReplacement = !!previous;
      let recoveryGeneration = fsm ? fsm.generation + 1 : 1;
      if (fsm) {
        if (isReplacement) {
          // Replacement failure: recovery generation is ACTIVE, keep source in sources[]
          // Update the REAL FSM with recovery generation
          sourceFsms.set(entry.source, {
            ...fsm,
            generation: recoveryGeneration,
            desiredState: "active",
            phase: "recovering",
            failedAt: Date.now(),
          });
          currentSourceFsm.set(entry.source, {
            ...fsm,
            generation: recoveryGeneration,
            desiredState: "active",
            phase: "recovering",
            failedAt: Date.now(),
          });
        } else {
          // Brand-new source failure: retirement generation is INACTIVE, omit from sources[]
          sourceFsms.set(entry.source, {
            ...fsm,
            generation: recoveryGeneration,
            desiredState: "inactive",
            phase: "failed",
            failedAt: Date.now(),
          });
          currentSourceFsm.set(entry.source, {
            ...fsm,
            generation: recoveryGeneration,
            desiredState: "inactive",
            phase: "failed",
            failedAt: Date.now(),
          });
        }
      }
      // Send compensation mutation and wait for ACK
      await sendMediaSourcesMutation(
        entry.source,
        isReplacement ? "active" : "inactive",
        currentSourceFsm,
        previous,
      );
      // Compensation ACK succeeded - persist recovery generation into canonical localSources
      const previousEntry: TopologySourceEntry | undefined = localSources.get(
        entry.source,
      );
      if (previousEntry) {
        // Update localSources with the recovery generation so future topology transitions use it
        const recoveredEntry = {
          ...previousEntry,
          generation: recoveryGeneration,
        } as TopologySourceEntry;
        localSources.set(entry.source, recoveredEntry);
        // Re-announce previous with the recovery generation on required transports
        const p2pResult = p2pRequired
          ? asProvider(getP2pMesh())?.publishSource(
              recoveredEntry.source,
              recoveredEntry.track,
              recoveredEntry.stream,
              recoveredEntry,
            )
          : Promise.resolve();
        const sfuResult = sfuRequired
          ? asProvider(getSfu())?.addSource(recoveredEntry)
          : Promise.resolve();
        const results = await Promise.allSettled([p2pResult, sfuResult]);
        // Check if required transports succeeded
        const requiredResults = [
          p2pRequired ? results[0] : { status: "fulfilled" as const },
          sfuRequired ? results[1] : { status: "fulfilled" as const },
        ];
        const failedRequired = requiredResults.find(
          (r): r is PromiseRejectedResult => r.status === "rejected",
        );
        if (failedRequired) {
          // Required transport failed - don't leave source as active
          mediaDebug("recovery.provider-restore-failed", {
            source: entry.source,
            error:
              failedRequired.reason instanceof Error
                ? failedRequired.reason.message
                : String(failedRequired.reason),
          });
          // Clean up the failed source from providers
          await Promise.allSettled([
            p2pRequired
              ? asProvider(getP2pMesh())?.unpublishSource(entry.source)
              : null,
            sfuRequired ? removeSfuSource(entry.source) : null,
          ]);
          if (entry.source === "screen-audio") stopSharedAudioMeter();
          // Remove from localSources since recovery failed
          localSources.delete(entry.source);
          setSourcePhase(entry.source, "idle", getActiveProvider());
          throw failedRequired.reason;
        }
      } else {
        // Brand-new source that failed - clean up any partial provider state
        await Promise.allSettled([
          asProvider(getP2pMesh())?.unpublishSource(entry.source),
          removeSfuSource(entry.source),
        ]);
        if (entry.source === "screen-audio") stopSharedAudioMeter();
        setSourcePhase(entry.source, "idle", getActiveProvider());
      }
      if (
        isVideo &&
        (
          localVideoFeeds.value.get(entry.source) as
            { stream?: MediaStream } | undefined
        )?.stream === entry.stream
      ) {
        if (previousVideoFeed)
          localVideoFeeds.value.set(entry.source, previousVideoFeed);
        else localVideoFeeds.value.delete(entry.source);
        localVideoFeeds.value = new Map(localVideoFeeds.value);
      }
      if (
        sourceError &&
        typeof sourceError === "object" &&
        "code" in sourceError &&
        (sourceError.code === "MEDIA_PROVIDER_DEAD" ||
          sourceError.code === "MEDIA_SESSION_CLOSED" ||
          sourceError.code === "MEDIA_SOURCE_TRANSPORT_FAILED")
      ) {
        if (topologyState.value.mode === "sfu")
          reportSfuFailure(`source-${entry.source}-failed-${sourceError.code}`);
        else if (topologyState.value.target === "sfu") {
          const { provider, providerId } = resolveMediaProviderIdentity(
            topologyState.value,
            true,
          );
          send({
            type: "topology-failed",
            data: {
              provider,
              ...(providerId ? { providerId } : {}),
              epoch: topologyState.value.epoch,
              target: "sfu",
              sourceRevision: topologyState.value.sourceRevision,
              reason,
            },
          });
        }
        throw sourceError;
      }
      // Only provider-session-scoped failures escalate to provider failover.
      // Ordinary source errors (tracks-new, sender config, renegotiation)
      // stay source-scoped; Cloudflare operations throw plain Error objects,
      // so the fallback must not promote them to a provider fault.
      const errorCode =
        sourceError &&
        typeof sourceError === "object" &&
        "code" in sourceError &&
        typeof (sourceError as { code?: unknown }).code === "string"
          ? (sourceError as { code: string }).code
          : null;
      const escalationScope = errorCode
        ? isFailureSourceScoped(errorCode)
          ? "source-scoped"
          : "provider-session"
        : "source-scoped";
      if (escalationScope === "provider-session") {
        if (topologyState.value.mode === "sfu")
          reportSfuFailure(`source-${entry.source}-failed-${reason}`);
        else if (topologyState.value.target === "sfu") {
          const { provider, providerId } = resolveMediaProviderIdentity(
            topologyState.value,
            true,
          );
          send({
            type: "topology-failed",
            data: {
              provider,
              ...(providerId ? { providerId } : {}),
              epoch: topologyState.value.epoch,
              target: "sfu",
              sourceRevision: topologyState.value.sourceRevision,
              reason,
            },
          });
        }
      }
      setSourcePhase(entry.source, "idle", getActiveProvider());
      throw sourceError;
    }
    localSources.set(entry.source, entry);
    if (sourceFsms.get(entry.source)?.generation !== entry.generation) {
      if (localSources.get(entry.source)?.track === entry.track)
        localSources.delete(entry.source);
      return;
    }
    setSourcePhase(entry.source, "live", getActiveProvider());
    if (entry.source === "screen-audio" && entry.ownerSource === "screen")
      voiceStore.systemAudioSharing = true;
    if (entry.captureTrack && entry.track !== entry.captureTrack)
      entry.track.addEventListener(
        "ended",
        () => {
          if (localSources.get(entry.source)?.track === entry.track)
            capture.stop(entry.source);
        },
        { once: true },
      );
    if (entry.source === "audio") startLocalVoiceDetection(entry);
    if (entry.source === "screen-audio") startSharedAudioMeter(entry.source);
    if (isVideo) {
      localVideoFeeds.value.set(entry.source, {
        source: entry.source,
        stream: entry.stream,
        producerId: `${getActiveProvider() || "local"}:${entry.track.id}`,
      });
      localVideoFeeds.value = new Map(localVideoFeeds.value);
      if (entry.source === "screen")
        adaptiveVideo.start(entry as AdaptiveVideoEntry);
    }
    sendSourceState();
    refreshPublicMaps();
    return entry;
  }

  function removeSource(
    entry: TopologySourceEntry,
    { unexpected = false }: { unexpected?: boolean } = {},
  ) {
    const publishedEntry = localSources.get(entry.source);
    if (
      publishedEntry?.track !== entry.track &&
      publishedEntry?.captureTrack !== entry.track
    )
      return Promise.resolve(false);
    // Only bump generation once - setSourcePhase with "stopping" will handle it
    setSourcePhase(entry.source, "stopping", getActiveProvider());
    const pairedScreenAudio =
      entry.source === "screen" ? localSources.get("screen-audio") : null;
    localSources.delete(entry.source);
    if (entry.source === "audio" && unexpected) {
      voiceStore.micMuted = true;
      void sendParticipantVoiceState({ muted: true }).catch(
        (error: unknown) => {
          mediaDebug("source-state.voice-ack-failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        },
      );
    }
    if (entry.source === "screen") {
      voiceStore.screenSharing = false;
      if (pairedScreenAudio?.ownerSource === "screen")
        voiceStore.systemAudioSharing = false;
    }
    if (entry.source === "screen-audio" && entry.ownerSource === "system-audio")
      voiceStore.systemAudioSharing = false;
    if (entry.source === "audio") stopLocalVoiceDetection();
    const p2pRemoval = asProvider(getP2pMesh())?.unpublishSource(entry.source);
    const trackedP2pRemoval = p2pRemoval
      ? Promise.resolve(p2pRemoval).catch((sourceError: unknown) => {
          error.value =
            sourceError instanceof Error
              ? sourceError.message
              : `Unable to stop ${entry.source} publication`;
          throw sourceError;
        })
      : Promise.resolve();
    const sfuRemoval = removeSfuSource(entry.source);
    localVideoFeeds.value.delete(entry.source);
    localVideoFeeds.value = new Map(localVideoFeeds.value);
    if (entry.source === "screen") adaptiveVideo.stop();
    if (entry.source === "screen-audio") {
      stopSharedAudioMeter();
      onSharedAudioStopped?.();
    }
    sendSourceState();
    refreshPublicMaps();
    if (
      unexpected &&
      entry.source === "audio" &&
      connected.value &&
      !getIntentionalClose()
    )
      error.value = "Microphone capture ended. Click unmute to restore it.";
    return Promise.allSettled([trackedP2pRemoval, sfuRemoval]).then(
      (results) => {
        const rejected = results.find((result) => result.status === "rejected");
        if (rejected) throw rejected.reason;
        return true;
      },
    );
  }

  let operationSequence = 0;
  function nextOperationId() {
    return crypto.randomUUID();
  }
  const pendingAcks = new Map<
    string,
    { resolve: () => void; reject: (error: unknown) => void }
  >();
  function awaitOperationAck(
    operationId: string,
    timeoutMs = 5000,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingAcks.delete(operationId);
        reject(new Error("MEDIA_OPERATION_ACK_TIMEOUT"));
      }, timeoutMs);
      pendingAcks.set(operationId, {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }
  function resolveOperationAck(operationId: string) {
    pendingAcks.get(operationId)?.resolve();
    pendingAcks.delete(operationId);
  }
  function rejectOperationAck(operationId: string, error: unknown) {
    pendingAcks.get(operationId)?.reject(error);
    pendingAcks.delete(operationId);
  }

  function sendSourceState() {
    const operationId = nextOperationId();
    send({
      type: "media-sources",
      data: {
        sources: [...localSources.keys()],
        operationId,
        requestId: operationId,
        connectionEpoch: getConnectionEpoch(),
        sourceStates: sourceFsmDigest(),
      },
    });
    void awaitOperationAck(operationId).catch((error: unknown) => {
      mediaDebug("source-state.ack-failed", {
        operationId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  function sendParticipantVoiceState(
    state: { muted?: boolean; deafened?: boolean } = {},
  ) {
    const operationId = nextOperationId();
    send({
      type: "participant-voice-state",
      data: {
        muted:
          typeof state.muted === "boolean"
            ? state.muted
            : Boolean(voiceStore.micMuted),
        deafened:
          typeof state.deafened === "boolean"
            ? state.deafened
            : Boolean(voiceStore.deafened),
        operationId,
        requestId: operationId,
        connectionEpoch: getConnectionEpoch(),
      },
    });
    return awaitOperationAck(operationId);
  }

  async function sendMediaSourcesMutation(
    source: string,
    desiredState: "active" | "inactive",
    currentSourceFsm: Map<string, SourceFsmState> = new Map(),
    previousSource?: TopologySourceEntry | null,
  ) {
    const operationId = nextOperationId();
    // Build full canonical desired state from source FSMs
    // This matches sendSourceState() structure: full source set + complete digest
    const sourceStates: Record<
      string,
      { generation: number; desiredState: "active" | "inactive" }
    > = {};
    // sources[] = active local sources (membership)
    const activeSources = new Set(localSources.keys());
    const isNewFailure = !previousSource;
    const sourcesToSend = isNewFailure
      ? [...activeSources].filter((s) => s !== source)
      : [...activeSources];
    // sourceStates = ALL FSM entries with their generations (including tombstones)
    // This ensures failed brand-new sources send their retirement generation
    for (const [src, fsm] of currentSourceFsm) {
      sourceStates[src] = {
        generation: fsm.generation,
        desiredState: src === source ? desiredState : fsm.desiredState,
      };
    }
    send({
      type: "media-sources",
      data: {
        sources: sourcesToSend,
        operationId,
        requestId: operationId,
        connectionEpoch: getConnectionEpoch(),
        sourceStates,
      },
    });
    return awaitOperationAck(operationId).catch((error: unknown) => {
      mediaDebug("media-sources-mutation.ack-failed", {
        source,
        operationId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Re-throw to let caller handle compensation ACK failure
      throw error;
    });
  }

  async function startAudioProduction() {
    await Promise.all(
      [
        asProvider(getP2pMesh())?.setSourceTransmission?.("audio", true),
        asProvider(getSfu())?.setSourceTransmission?.("audio", true),
      ].filter(Boolean),
    );
    const entry = await capture.startMicrophone();
    return producerFacade(entry);
  }

  function restartAudioProduction() {
    return capture
      .restartMicrophone()
      .then((entry) => (entry ? producerFacade(entry) : null));
  }

  function startVideoProduction(
    source: "camera" | "screen",
    options: MediaCaptureStartOptions = {},
  ) {
    return capture
      .startVideo(source, options)
      .then((entry) => (entry ? producerFacade(entry) : null));
  }

  function startSystemAudioProduction(options: MediaCaptureStartOptions = {}) {
    return capture
      .startSystemAudio(options)
      .then((entry) => (entry ? producerFacade(entry) : null));
  }

  function queueTargetedReconciliation(operationId: string, data: unknown) {
    const payload =
      data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const source = String(payload.source || "");
    if (!source || !localSources.has(source)) return Promise.resolve(false);
    const entry = localSources.get(source);
    if (!entry) return Promise.resolve(false);
    // Adopt the canonical generation before re-announcing so the retry is
    // fenced against the server's current incarnation of this source.
    const expectedGeneration = Number(payload.expectedGeneration);
    if (
      payload.code === "STALE_SOURCE_GENERATION" &&
      Number.isSafeInteger(expectedGeneration) &&
      expectedGeneration > 0 &&
      expectedGeneration !== Number(entry.generation)
    ) {
      entry.generation = expectedGeneration;
      // Also adopt the generation into sourceFsms so commitSourceIntent uses the correct generation
      const fsm = sourceFsms.get(source);
      if (fsm) {
        sourceFsms.set(source, {
          ...fsm,
          generation: expectedGeneration,
        });
      }
    }
    mediaDebug("source-state.reconcile", {
      operationId,
      source,
      generation: entry.generation,
      retryable: payload.retryable,
    });
    publishSource(entry).catch((sourceError: unknown) => {
      mediaDebug("source-state.reconcile-failed", {
        operationId,
        source,
        error:
          sourceError instanceof Error
            ? sourceError.message
            : String(sourceError),
      });
      return false;
    });
    return Promise.resolve(true);
  }

  async function leave() {
    const operationId = nextOperationId();
    send({
      type: "leave",
      data: {
        operationId,
        requestId: operationId,
        connectionEpoch: getConnectionEpoch(),
      },
    });
    return awaitOperationAck(operationId);
  }

  function handleProviderRecovering(data: Record<string, unknown> = {}) {
    const retryAt = Number(data.retryAt);
    mediaDebug("source-state.provider-recovering", {
      retryAt: Number.isSafeInteger(retryAt) ? retryAt : null,
      reason: data.reason || "provider-recovering",
    });
    // Informational only. Actual re-publication happens as part of the
    // committed provider convergence path (a later topology event), so a
    // provider recovery never invents a new logical source incarnation.
    return Promise.resolve(true);
  }

  return {
    publishSource,
    removeSource,
    restartAudioProduction,
    sendParticipantVoiceState,
    sendSourceState,
    sendMediaSourcesMutation,
    startAudioProduction,
    startSystemAudioProduction,
    startVideoProduction,
    stopAudioProduction: () => capture.stop("audio"),
    stopSystemAudioProduction: () => {
      const entry = localSources.get("screen-audio");
      if (entry?.ownerSource === "system-audio") capture.stop("screen-audio");
    },
    stopVideoProduction: (source: "camera" | "screen") => capture.stop(source),
    resolveOperationAck,
    rejectOperationAck,
    leave,
    queueTargetedReconciliation,
    handleProviderRecovering,
    getSourceFsmDigest: sourceFsmDigest,
    getLocalSources: () => localSources,
  };
}
