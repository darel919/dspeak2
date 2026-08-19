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
  getLastAppliedPublicationRevision,
  setLastAppliedPublicationRevision,
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
    // Treat missing required provider as explicit failure BEFORE attempting publication
    if (p2pRequired && !p2pMesh) {
      throw new Error("The active P2P transport is unavailable");
    }
    if (sfuRequired && !sfu) {
      throw new Error("The active SFU transport is unavailable");
    }
    try {
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
        // Re-announce previous with the recovery generation on required transports.
        // Missing required transports must fail loudly, not report fulfilled.
        const recoveryP2pMesh = asProvider(getP2pMesh());
        const recoverySfu = asProvider(getSfu());
        const p2pResult = !p2pRequired
          ? Promise.resolve()
          : recoveryP2pMesh
            ? Promise.resolve(
                recoveryP2pMesh.publishSource(
                  recoveredEntry.source,
                  recoveredEntry.track,
                  recoveredEntry.stream,
                  recoveredEntry,
                ),
              )
            : Promise.reject(new Error("Required P2P transport unavailable"));
        const sfuResult = !sfuRequired
          ? Promise.resolve()
          : recoverySfu
            ? Promise.resolve(recoverySfu.addSource(recoveredEntry))
            : Promise.reject(new Error("Required SFU transport unavailable"));
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
          // Required transport failed - must send second mutation to retire
          // the N+2 ACTIVE source that was committed during compensation
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
          // Send second control-plane mutation: N+3 INACTIVE to retire the N+2 ACTIVE
          const retirementFsm = new Map(sourceFsms);
          const recoveryFsm = retirementFsm.get(entry.source);
          if (recoveryFsm) {
            const retirementGeneration = recoveryFsm.generation + 1;
            const retiredState = {
              ...recoveryFsm,
              generation: retirementGeneration,
              desiredState: "inactive" as const,
              phase: "failed" as const,
              failedAt: Date.now(),
            };
            retirementFsm.set(entry.source, retiredState);
            await sendMediaSourcesMutation(
              entry.source,
              "inactive",
              retirementFsm,
              undefined,
            );
            // ACK succeeded - commit N+3 inactive to REAL sourceFsms
            sourceFsms.set(entry.source, {
              ...retiredState,
              phase: "idle" as const,
              failedAt: null,
            });
          }
          setSourcePhase(entry.source, "idle", getActiveProvider());
          throw failedRequired.reason;
        } else {
          // Successful replacement recovery - required transports restored
          // Set FSM phase to "live" (not "idle") since the previous source remains active
          const successFsm = new Map(sourceFsms);
          const recoveryFsm = successFsm.get(entry.source);
          if (recoveryFsm) {
            sourceFsms.set(entry.source, {
              ...recoveryFsm,
              phase: "live",
              failedAt: null,
            });
          }
          setSourcePhase(entry.source, "live", getActiveProvider());
          // Return the recovered entry with the recovery generation
          return recoveredEntry;
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
    Promise.allSettled([trackedP2pRemoval, sfuRemoval]).then((results) => {
      const p2pResult = results[0];
      const sfuResult = results[1];
      if (
        p2pResult.status === "rejected" &&
        (p2pResult.reason as Error)?.message?.includes("MEDIA_SESSION_CLOSED")
      ) {
        // Ignore session-closed during cleanup
      } else if (p2pResult.status === "rejected") {
        error.value = `Failed to remove ${entry.source} from P2P: ${p2pResult.reason}`;
      }
      if (
        sfuResult.status === "rejected" &&
        (sfuResult.reason as Error)?.message?.includes("MEDIA_SESSION_CLOSED")
      ) {
        // Ignore session-closed during cleanup
      } else if (sfuResult.status === "rejected") {
        error.value = `Failed to remove ${entry.source} from SFU: ${sfuResult.reason}`;
      }
      if (
        unexpected &&
        entry.source === "audio" &&
        connected.value &&
        !getIntentionalClose()
      )
        error.value = "Microphone capture ended. Click unmute to restore it.";
      sendSourceState();
      refreshPublicMaps();
    });
    return Promise.resolve(true);
  }

  function sendSourceState() {
    const operationId = nextOperationId();
    const sourcesArray = [...localSources.keys()];
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
    return promise.catch((error: unknown) => {
      mediaDebug("media-sources-mutation.ack-failed", {
        operationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    });
  }

  async function sendMediaSourcesMutation(
    source: string,
    desiredState: "active" | "inactive",
    fsms: Map<string, SourceFsmState>,
    _previous?: TopologySourceEntry,
  ) {
    const sourcesArray = [...localSources.keys()];
    if (desiredState === "active" && !sourcesArray.includes(source))
      sourcesArray.push(source);
    if (desiredState === "inactive") {
      const idx = sourcesArray.indexOf(source);
      if (idx >= 0) sourcesArray.splice(idx, 1);
    }
    const operationId = nextOperationId();
    const promise = awaitOperationAck(operationId);
    send({
      type: "media-sources",
      data: {
        sources: sourcesArray,
        operationId,
        requestId: operationId,
        connectionEpoch: getConnectionEpoch(),
        sourceStates: [...fsms.entries()].reduce<Record<string, unknown>>(
          (digest, [src, state]) => {
            digest[src] = {
              phase: state.phase,
              generation: state.generation,
              desiredState: state.desiredState,
              provider: state.provider,
            };
            return digest;
          },
          {},
        ),
      },
    });
    try {
      await promise;
    } catch (error) {
      throw error;
    }
  }

  let operationIdCounter = 0;
  const operationWaiters = new Map<
    string,
    { resolve: (value?: unknown) => void; reject: (error: unknown) => void }
  >();

  function nextOperationId() {
    operationIdCounter++;
    return `op-${operationIdCounter}-${Date.now()}`;
  }

  function awaitOperationAck(operationId: string) {
    return new Promise<unknown>((resolve, reject) => {
      operationWaiters.set(operationId, { resolve, reject });
      setTimeout(() => {
        if (operationWaiters.has(operationId)) {
          operationWaiters.delete(operationId);
          reject(new Error(`Operation ${operationId} timed out`));
        }
      }, 15000);
    });
  }

  function resolveOperationAck(operationId: string) {
    const waiter = operationWaiters.get(operationId);
    if (waiter) {
      operationWaiters.delete(operationId);
      waiter.resolve(undefined);
    }
  }

  function rejectOperationAck(operationId: string, error: unknown) {
    const waiter = operationWaiters.get(operationId);
    if (waiter) {
      operationWaiters.delete(operationId);
      waiter.reject(error);
    }
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

  function stopAudioProduction() {
    return capture.stop("audio");
  }

  function stopSystemAudioProduction() {
    const entry = localSources.get("screen-audio");
    if (entry?.ownerSource === "system-audio") capture.stop("screen-audio");
  }

  function stopVideoProduction(source: "camera" | "screen") {
    return capture.stop(source);
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

  function getLocalSources() {
    return localSources;
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

  return {
    publishSource,
    removeSource,
    sendSourceState,
    sendMediaSourcesMutation,
    resolveOperationAck,
    rejectOperationAck,
    sourceFsms,
    setSourcePhase,
    getSourceFsmDigest: sourceFsmDigest,
    // Properties expected by consumers (hybrid-media-session-api.ts)
    restartAudioProduction,
    startAudioProduction,
    stopAudioProduction,
    startVideoProduction,
    stopVideoProduction,
    startSystemAudioProduction,
    stopSystemAudioProduction,
    sendParticipantVoiceState,
    queueTargetedReconciliation,
    leave,
    handleProviderRecovering,
    getLocalSources,
  };
}
