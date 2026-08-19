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
  getLocalPeerId = () => null,
  getLocalParticipantKey = () => null,
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

  // Track pending retirements that need provider cleanup after canonical confirmation.
  // Keyed by source, value contains the generation and operationId for idempotent completion.
  interface PendingRetirement {
    source: string;
    generation: number;
    operationId: string;
    cleanupRequired: boolean;
  }
  const pendingRetirements = new Map<string, PendingRetirement>();
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

    const previous = localSources.get(entry.source);
    const isVideo = entry.source === "camera" || entry.source === "screen";
    const previousVideoFeed = isVideo
      ? localVideoFeeds.value.get(entry.source)
      : null;
    // Preflight required providers BEFORE committing source intent to the
    // server. A missing transport must reject with no canonical mutation, no
    // optimistic FSM bump, and no provisional preview, so the server never
    // holds an active source the client cannot publish.
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
    if (p2pRequired && !p2pMesh) {
      throw new Error("The active P2P transport is unavailable");
    }
    if (sfuRequired && !sfu) {
      throw new Error("The active SFU transport is unavailable");
    }

    // Commit source intent NEXT (media-sources with generation) and wait for ACK.
    // This ensures server has canonical sourceStates before provider announces.
    const committedGeneration = await commitSourceIntent(entry.source, {
      isVideo,
      ownerSource: entry.ownerSource ?? undefined,
    });
    entry.generation = committedGeneration;

    if (entry.source === "audio" && voiceStore.micMuted)
      entry.track.enabled = false;

    if (isVideo) {
      localVideoFeeds.value.set(entry.source, {
        source: entry.source,
        stream: entry.stream,
        producerId: `local:${entry.track.id}`,
      });
      localVideoFeeds.value = new Map(localVideoFeeds.value);
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
          // Restore the previous video preview before returning: the failed
          // replacement's provisional feed must never survive a rollback.
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
    void sendSourceState().catch(() => {});
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
    // INTENT-FIRST: bump FSM to N+1 inactive and remove the local source
    // before any provider I/O. The control-plane mutation (media-sources with
    // the FSM digest) retires the canonical publication immediately; provider
    // transport cleanup follows asynchronously. Provider cleanup failure must
    // not keep the logical source active on the server.
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
    localVideoFeeds.value.delete(entry.source);
    localVideoFeeds.value = new Map(localVideoFeeds.value);
    if (entry.source === "screen") adaptiveVideo.stop();
    if (entry.source === "screen-audio") {
      stopSharedAudioMeter();
      onSharedAudioStopped?.();
    }
    // Await the canonical retirement ACK before provider cleanup. Bounded by
    // the 15s operation ACK timeout. If the control plane is unreachable the
    // canonical state stays N (active server-side), so the source is NOT
    // removed from the server; the FSM tombstone (N+1 inactive) is preserved
    // and phase becomes "reconciling" so a later heartbeat/NACK convergence
    // adopts the canonical outcome instead of pretending the stop settled.
    // The retirement uses a STABLE operationId: if the ACK is lost after the
    // server committed (or the request never arrived), retrying the SAME
    // operationId is safe - the server replays its cached result for a
    // committed operation, or applies the mutation fresh for a lost request.
    // A brand-new operationId would be rejected as a stale generation replay.
    const retirementOperationId = nextOperationId();
    // Capture the generation this operation was sent with, so a stale timeout
    // can't overwrite a newer convergent FSM state.
    const retirementGeneration = sourceFsms.get(entry.source)?.generation ?? 0;
    // Track this retirement for reconnect/snapshot convergence
    pendingRetirements.set(entry.source, {
      source: entry.source,
      generation: retirementGeneration,
      operationId: retirementOperationId,
      cleanupRequired: true,
    });
    const retirement = sendSourceState(retirementOperationId)
      .then(() => {
        // Canonical retirement committed: the FSM settles idle and the
        // provider transport cleanup may proceed. Failures are reported but
        // never resurrect the canonical source.
        // Verify this retirement's generation is still current before settling.
        const fsm = sourceFsms.get(entry.source);
        if (
          !fsm ||
          fsm.generation !== retirementGeneration ||
          fsm.desiredState !== "inactive"
        ) {
          mediaDebug("source-state.retire-success-stale", {
            source: entry.source,
            expectedGeneration: retirementGeneration,
            actualGeneration: fsm?.generation,
            desiredState: fsm?.desiredState,
            reason: "newer incarnation or state changed",
          });
          return false;
        }
        setSourcePhase(entry.source, "idle", getActiveProvider());
        completeSourceRemoval(entry.source, { unexpected });
        // Mark cleanup as done (but keep entry for idempotent reconnect handling)
        const pending = pendingRetirements.get(entry.source);
        if (pending) {
          pending.cleanupRequired = false;
        }
        return true;
      })
      .catch((sourceError: unknown) => {
        // ACK timed out or was rejected: canonical outcome UNKNOWN. Keep the
        // N+1 inactive tombstone and mark the phase reconciling so the next
        // server snapshot converges it. Do not settle idle.
        // Only update if the FSM still reflects THIS operation's generation
        // AND the phase is not already "idle" (meaning a newer convergent
        // operation has already settled the tombstone). If a NACK convergence
        // has adopted a newer generation, the FSM generation will be >
        // retirementGeneration, so we don't overwrite. If phase is "idle",
        // the retirement has already been committed.
        const fsm = sourceFsms.get(entry.source);
        mediaDebug("source-state.retire-ack-failed-check", {
          source: entry.source,
          expectedGeneration: retirementGeneration,
          actualGeneration: fsm?.generation,
          desiredState: fsm?.desiredState,
          phase: fsm?.phase,
        });
        if (
          fsm &&
          fsm.generation === retirementGeneration &&
          fsm.phase !== "idle"
        ) {
          mediaDebug("source-state.retire-ack-failed", {
            source: entry.source,
            error:
              sourceError instanceof Error
                ? sourceError.message
                : String(sourceError),
          });
          setSourcePhase(entry.source, "reconciling", getActiveProvider());
        } else if (fsm) {
          mediaDebug("source-state.retire-ack-failed-stale", {
            source: entry.source,
            expectedGeneration: retirementGeneration,
            actualGeneration: fsm.generation,
            reason:
              fsm.phase === "idle" ? "already-idle" : "generation-mismatch",
          });
        }
        // Retry the SAME operationId: the server's operation-result cache
        // makes the replay idempotent whether the original request was
        // committed (cached ACK) or lost (fresh apply). Bounded retries keep
        // the tombstone converging after transient control-plane failures.
        void retryRetirementMutation(
          retirementOperationId,
          entry.source,
          { unexpected },
          1,
          retirementGeneration,
        ).catch(() => {});
        throw sourceError;
      });
    refreshPublicMaps();
    return retirement;
  }

  function completeSourceRemoval(
    source: string,
    { unexpected = false }: { unexpected?: boolean } = {},
  ) {
    const p2pRemoval = asProvider(getP2pMesh())?.unpublishSource(source);
    const trackedP2pRemoval = p2pRemoval
      ? Promise.resolve(p2pRemoval).catch((sourceError: unknown) => {
          error.value =
            sourceError instanceof Error
              ? sourceError.message
              : `Unable to stop ${source} publication`;
          throw sourceError;
        })
      : Promise.resolve();
    const sfuRemoval = removeSfuSource(source);
    void Promise.allSettled([trackedP2pRemoval, sfuRemoval]).then((results) => {
      const p2pResult = results[0];
      const sfuResult = results[1];
      if (
        p2pResult.status === "rejected" &&
        (p2pResult.reason as Error)?.message?.includes("MEDIA_SESSION_CLOSED")
      ) {
        // Ignore session-closed during cleanup
      } else if (p2pResult.status === "rejected") {
        error.value = `Failed to remove ${source} from P2P: ${p2pResult.reason}`;
      }
      if (
        sfuResult.status === "rejected" &&
        (sfuResult.reason as Error)?.message?.includes("MEDIA_SESSION_CLOSED")
      ) {
        // Ignore session-closed during cleanup
      } else if (sfuResult.status === "rejected") {
        error.value = `Failed to remove ${source} from SFU: ${sfuResult.reason}`;
      }
      if (
        unexpected &&
        source === "audio" &&
        connected.value &&
        !getIntentionalClose()
      )
        error.value = "Microphone capture ended. Click unmute to restore it.";
      refreshPublicMaps();
    });
  }

  function retryRetirementMutation(
    operationId: string,
    source: string,
    options: { unexpected?: boolean } = {},
    attempt: number,
    retirementGeneration: number,
  ) {
    const MAX_RETRIES = 3;
    const delayMs = 500 * attempt;
    return new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        const fsm = sourceFsms.get(source);
        if (!fsm || fsm.desiredState !== "inactive") {
          resolve();
          return;
        }
        sendSourceState(operationId)
          .then(() => {
            // Verify this retirement's generation is still current before settling.
            const fsm = sourceFsms.get(source);
            if (
              !fsm ||
              fsm.generation !== retirementGeneration ||
              fsm.desiredState !== "inactive"
            ) {
              mediaDebug("source-state.retire-retry-success-stale", {
                source,
                expectedGeneration: retirementGeneration,
                actualGeneration: fsm?.generation,
                desiredState: fsm?.desiredState,
                reason: "newer incarnation or state changed",
              });
              resolve();
              return;
            }
            setSourcePhase(source, "idle", getActiveProvider());
            completeSourceRemoval(source, options);
            // Mark cleanup as done
            const pending = pendingRetirements.get(source);
            if (pending) {
              pending.cleanupRequired = false;
            }
            resolve();
          })
          .catch((retryError: unknown) => {
            mediaDebug("source-state.retire-retry-failed", {
              source,
              attempt,
              error:
                retryError instanceof Error
                  ? retryError.message
                  : String(retryError),
            });
            if (attempt < MAX_RETRIES) {
              void retryRetirementMutation(
                operationId,
                source,
                options,
                attempt + 1,
                retirementGeneration,
              ).then(resolve, reject);
            } else {
              // Keep the reconciling tombstone: the reconnect/next snapshot
              // convergence path retires it against canonical state.
              reject(retryError);
            }
          });
      }, delayMs);
    });
  }

  function sendSourceState(operationIdOverride?: string) {
    const operationId = operationIdOverride || nextOperationId();
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
    if (!source) return Promise.resolve(false);
    // INACTIVE TOMBSTONE PATH: a stopped source was already deleted from
    // localSources, so the active-source path below cannot repair it. The
    // server NACKed the retirement with STALE_SOURCE_GENERATION (or the ACK
    // timed out): adopt the canonical generation and re-send the inactive
    // mutation so the tombstone converges to the server's committed outcome.
    const fsm = sourceFsms.get(source);
    if (fsm?.desiredState === "inactive") {
      const expectedGeneration = Number(payload.expectedGeneration);
      const adoptsCanonical = payload.adoptsCanonicalGeneration === true;
      const retryable = payload.retryable === true;
      // Parse canonicalState from the real server topology snapshot:
      // canonicalState contains { participants, sourceStates, ... }
      // We need to find our participant's sourceStates entry for this source.
      let canonicalSourceState:
        { generation: number; desiredState: string } | undefined;
      const canonicalState = payload.canonicalState as
        | {
            participants?: Array<{
              peerId?: string;
              sourceStates?: Record<
                string,
                { generation?: number; desiredState?: string }
              >;
            }>;
            sourceStates?: Record<
              string,
              Record<string, { generation?: number; desiredState?: string }>
            >;
          }
        | undefined;
      if (canonicalState) {
        // The topology snapshot has sourceStates keyed by "userId:deviceId"
        // We need to find the entry for our local peer.
        const localPeerId = getLocalPeerId?.();
        const localParticipantKey = getLocalParticipantKey?.();

        if (canonicalState.participants && localPeerId) {
          for (const participant of canonicalState.participants) {
            if (participant.peerId === localPeerId) {
              const sourceState =
                participant.sourceStates?.[source] ||
                participant.sourceStates?.[`${source}`];
              if (sourceState) {
                canonicalSourceState = {
                  generation: Number(sourceState.generation || 0),
                  desiredState: String(sourceState.desiredState || ""),
                };
                break;
              }
            }
          }
        }
        // Fallback: flat sourceStates by participant key
        if (
          !canonicalSourceState &&
          canonicalState.sourceStates &&
          localParticipantKey
        ) {
          const participantSourceStates =
            canonicalState.sourceStates[localParticipantKey];
          if (participantSourceStates) {
            const sourceState = participantSourceStates[source];
            if (sourceState) {
              canonicalSourceState = {
                generation: Number(sourceState.generation || 0),
                desiredState: String(sourceState.desiredState || ""),
              };
            }
          }
        }
      }
      if (
        (payload.code === "STALE_SOURCE_GENERATION" || adoptsCanonical) &&
        Number.isSafeInteger(expectedGeneration) &&
        expectedGeneration > 0 &&
        expectedGeneration !== fsm.generation
      ) {
        mediaDebug("source-state.tombstone-adopt-generation", {
          operationId,
          source,
          from: fsm.generation,
          to: expectedGeneration,
          adoptsCanonical,
          retryable,
        });
        sourceFsms.set(source, {
          ...fsm,
          generation: expectedGeneration,
          phase: "reconciling",
        });
      }
      // If the server sends canonicalState confirming inactive with this generation
      // AND indicates no retry is needed (retryable: false), we can complete
      // the retirement locally without waiting for another ACK.
      if (
        !retryable &&
        adoptsCanonical &&
        canonicalSourceState &&
        canonicalSourceState.desiredState === "inactive" &&
        canonicalSourceState.generation === expectedGeneration
      ) {
        // Verify this retirement's generation is still current before settling.
        const fsm = sourceFsms.get(source);
        if (
          !fsm ||
          fsm.generation !== expectedGeneration ||
          fsm.desiredState !== "inactive"
        ) {
          mediaDebug("source-state.tombstone-canonical-inactive-stale", {
            source,
            expectedGeneration,
            actualGeneration: fsm?.generation,
            desiredState: fsm?.desiredState,
            reason: "newer incarnation or state changed",
          });
          return Promise.resolve(false);
        }
        mediaDebug("source-state.tombstone-canonical-inactive", {
          operationId,
          source,
          generation: expectedGeneration,
        });
        // The server has already committed inactive for this generation.
        // Complete locally and clean up provider transport.
        setSourcePhase(source, "idle", getActiveProvider());
        completeSourceRemoval(source, {});
        // Mark cleanup as done and delete the pending retirement entry
        const pending = pendingRetirements.get(source);
        if (pending) {
          pending.cleanupRequired = false;
          pendingRetirements.delete(source);
        }
        return Promise.resolve(true);
      }
      // Re-send the retirement with the adopted generation. The NACKed
      // operationId is cached server-side and would replay the NACK, so a
      // fresh operationId carries the adopted generation as a new mutation:
      // the server accepts inactive >= canonical generation and commits.
      const newOperationId = nextOperationId();
      pendingRetirements.set(source, {
        source,
        generation: expectedGeneration,
        operationId: newOperationId,
        cleanupRequired: true,
      });
      return sendSourceState(newOperationId)
        .then(() => {
          // Verify this retirement's generation is still current before settling.
          const fsm = sourceFsms.get(source);
          if (
            !fsm ||
            fsm.generation !== expectedGeneration ||
            fsm.desiredState !== "inactive"
          ) {
            mediaDebug("source-state.tombstone-retry-success-stale", {
              source,
              expectedGeneration,
              actualGeneration: fsm?.generation,
              desiredState: fsm?.desiredState,
              reason: "newer incarnation or state changed",
            });
            return false;
          }
          setSourcePhase(source, "idle", getActiveProvider());
          completeSourceRemoval(source, {});
          // Mark cleanup as done and delete the pending retirement entry
          const pending = pendingRetirements.get(source);
          if (pending) {
            pending.cleanupRequired = false;
            pendingRetirements.delete(source);
          }
          return true;
        })
        .catch((sourceError: unknown) => {
          mediaDebug("source-state.tombstone-reconcile-failed", {
            operationId,
            source,
            error:
              sourceError instanceof Error
                ? sourceError.message
                : String(sourceError),
          });
          return false;
        });
    }
    if (!localSources.has(source)) return Promise.resolve(false);
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

  function processPendingRetirements() {
    // Called on reconnect/hello to complete any pending retirements using
    // the canonical snapshot from the server. The server's topology snapshot
    // in heartbeat-ack or hello contains sourceStates that confirm inactive
    // retirements we sent before disconnect.
    // Do NOT replay old operation IDs across a new connection epoch.
    // Instead, check if the canonical snapshot already confirms inactive for
    // the pending generation. If so, complete locally. Otherwise, send a
    // fresh source state mutation with the current generation.
    for (const [source, pending] of pendingRetirements.entries()) {
      if (!pending.cleanupRequired) continue;
      const fsm = sourceFsms.get(source);
      if (!fsm || fsm.desiredState !== "inactive") continue;

      mediaDebug("source-state.process-pending-retirement", {
        source,
        pendingGeneration: pending.generation,
        currentGeneration: fsm.generation,
        // Don't log old operationId since we won't replay it
      });

      // Check if we already have canonical confirmation from the snapshot
      // that was processed via queueTargetedReconciliation or onServerConnected.
      // The canonical state would have been delivered via heartbeat-ack/hello
      // and processed through queueTargetedReconciliation which would have
      // marked cleanupRequired = false if the server confirmed inactive.
      //
      // If cleanupRequired is still true here, it means either:
      // 1. We haven't received the canonical snapshot yet, OR
      // 2. The canonical snapshot showed the source as still active
      //
      // In either case, we should send a FRESH source state mutation with the
      // CURRENT generation (not the old pending generation) to converge with
      // the server's current state.
      //
      // The server will respond with its canonical state, which will be
      // processed through queueTargetedReconciliation to complete the cleanup.
      const newOperationId = nextOperationId();
      mediaDebug("source-state.pending-retirement-send-fresh", {
        source,
        oldOperationId: pending.operationId,
        newOperationId,
        currentGeneration: fsm.generation,
      });
      void sendSourceState(newOperationId)
        .then(() => {
          // The ACK or subsequent canonical snapshot will trigger
          // queueTargetedReconciliation which will handle completion.
        })
        .catch(() => {
          // Ignore errors - the retirement will be retried on next reconnect
        });
    }
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
    processPendingRetirements,
    pendingRetirements,
  };
}
