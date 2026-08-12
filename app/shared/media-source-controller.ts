import {
  adaptiveTrackConstraints,
  createAdaptiveVideoController,
} from "./adaptive-video-controller.ts";
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
  getIntentionalClose,
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
      if (getActiveProvider() === "sfu" || topologyState.value.mode === "sfu")
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
    } catch (sourceError: unknown) {
      const reason = `source-${entry.source}-failed-${sourceError instanceof Error ? sourceError.message : String(sourceError)}`;
      if (previous) {
        await Promise.allSettled([
          p2pRequired
            ? asProvider(getP2pMesh())?.publishSource(
                previous.source,
                previous.track,
                previous.stream,
                previous,
              )
            : null,
          sfuRequired ? asProvider(getSfu())?.addSource(previous) : null,
        ]);
      } else {
        await Promise.allSettled([
          asProvider(getP2pMesh())?.unpublishSource(entry.source),
          removeSfuSource(entry.source),
        ]);
        if (entry.source === "screen-audio") stopSharedAudioMeter();
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
      if (topologyState.value.mode === "sfu") reportSfuFailure(reason);
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
    localSources.set(entry.source, entry);
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
      if (entry.source === "screen") adaptiveVideo.start(entry);
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
    const pairedScreenAudio =
      entry.source === "screen" ? localSources.get("screen-audio") : null;
    localSources.delete(entry.source);
    if (entry.source === "audio" && unexpected) {
      voiceStore.micMuted = true;
      sendParticipantVoiceState({ muted: true });
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

  function sendSourceState() {
    send({
      type: "media-sources",
      data: { sources: [...localSources.keys()] },
    });
  }

  function sendParticipantVoiceState(
    state: { muted?: boolean; deafened?: boolean } = {},
  ) {
    return send({
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
      },
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

  return {
    publishSource,
    removeSource,
    restartAudioProduction,
    sendParticipantVoiceState,
    sendSourceState,
    startAudioProduction,
    startSystemAudioProduction,
    startVideoProduction,
    stopAudioProduction: () => capture.stop("audio"),
    stopSystemAudioProduction: () => {
      const entry = localSources.get("screen-audio");
      if (entry?.ownerSource === "system-audio") capture.stop("screen-audio");
    },
    stopVideoProduction: (source: "camera" | "screen") => capture.stop(source),
  };
}
