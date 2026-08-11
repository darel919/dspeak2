import {
  adaptiveTrackConstraints,
  createAdaptiveVideoController,
} from "./adaptive-video-controller.ts";

export function createMediaSourceController({
  capture,
  connected,
  createSharedAudioSource,
  error,
  getActiveProvider,
  getIntentionalClose,
  getP2pMesh,
  getSfu,
  getVideoReport = () => null,
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
}) {
  const adaptiveVideo = createAdaptiveVideoController({
    apply: async (entry, state, settings) => {
      await entry.track.applyConstraints(
        adaptiveTrackConstraints(entry, state, settings),
      );
      await refreshMediaPolicy();
    },
    getReport: getVideoReport,
    getSettings: getVideoSettings,
    onError: (adaptationError) =>
      console.warn(
        `[Media] Video adaptation failed: ${adaptationError?.message || adaptationError}`,
      ),
  });
  function removeSfuSource(source) {
    const reportError = (sourceError) => {
      if (sourceError?.code === "MEDIA_SESSION_CLOSED") return;
      error.value =
        sourceError?.message || `Unable to stop ${source} publication`;
      if (getActiveProvider() === "sfu" || topologyState.value.mode === "sfu")
        reportSfuFailure(
          `source-${source}-remove-failed-${sourceError?.message || "unknown"}`,
        );
    };
    try {
      return Promise.resolve(getSfu()?.removeSource(source)).catch(
        (sourceError) => {
          reportError(sourceError);
          if (sourceError?.code === "MEDIA_SESSION_CLOSED") return false;
          throw sourceError;
        },
      );
    } catch (sourceError) {
      reportError(sourceError);
      if (sourceError?.code === "MEDIA_SESSION_CLOSED")
        return Promise.resolve(false);
      return Promise.reject(sourceError);
    }
  }
  async function publishSource(sourceEntry) {
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
    const p2pMesh = getP2pMesh();
    const sfu = getSfu();
    try {
      if (p2pRequired && !p2pMesh)
        throw new Error("The active P2P transport is unavailable");
      if (sfuRequired && !sfu)
        throw new Error("The active SFU transport is unavailable");
      const publications = await Promise.allSettled([
        p2pRequired
          ? p2pMesh.publishSource(
              entry.source,
              entry.track,
              entry.stream,
              entry,
            )
          : Promise.resolve(),
        sfuRequired ? sfu.addSource(entry) : Promise.resolve(),
      ]);
      const rejected = publications.find(
        (publication) => publication.status === "rejected",
      );
      if (rejected) throw rejected.reason;
      const captureTrack = entry.captureTrack || entry.track;
      if (
        captureTrack.readyState === "ended" ||
        entry.track.readyState === "ended"
      )
        throw new Error(`The ${entry.source} track ended during publication`);
    } catch (sourceError) {
      const reason = `source-${entry.source}-failed-${sourceError.message}`;
      if (previous) {
        await Promise.allSettled([
          p2pRequired
            ? getP2pMesh()?.publishSource(
                previous.source,
                previous.track,
                previous.stream,
                previous,
              )
            : null,
          sfuRequired ? getSfu()?.addSource(previous) : null,
        ]);
      } else {
        await Promise.allSettled([
          getP2pMesh()?.unpublishSource(entry.source),
          removeSfuSource(entry.source),
        ]);
        if (entry.source === "screen-audio") stopSharedAudioMeter();
      }
      if (
        isVideo &&
        localVideoFeeds.value.get(entry.source)?.stream === entry.stream
      ) {
        if (previousVideoFeed)
          localVideoFeeds.value.set(entry.source, previousVideoFeed);
        else localVideoFeeds.value.delete(entry.source);
        localVideoFeeds.value = new Map(localVideoFeeds.value);
      }
      if (topologyState.value.mode === "sfu") reportSfuFailure(reason);
      else if (topologyState.value.target === "sfu")
        send({
          type: "topology-failed",
          data: {
            epoch: topologyState.value.epoch,
            target: "sfu",
            sourceRevision: topologyState.value.sourceRevision,
            reason,
          },
        });
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

  function removeSource(entry, { unexpected = false } = {} as any) {
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
    const p2pRemoval = getP2pMesh()?.unpublishSource(entry.source);
    const trackedP2pRemoval = p2pRemoval
      ? Promise.resolve(p2pRemoval).catch((sourceError) => {
          error.value =
            sourceError?.message ||
            `Unable to stop ${entry.source} publication`;
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

  function sendParticipantVoiceState(state = {} as any) {
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

  function startAudioProduction() {
    return capture.startMicrophone().then((entry) => producerFacade(entry));
  }

  function restartAudioProduction() {
    return capture.restartMicrophone().then((entry) => producerFacade(entry));
  }

  function startVideoProduction(source, options = {} as any) {
    return capture
      .startVideo(source, options)
      .then((entry) => producerFacade(entry));
  }

  function startSystemAudioProduction(options = {} as any) {
    return capture
      .startSystemAudio(options)
      .then((entry) => producerFacade(entry));
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
    stopVideoProduction: (source) => capture.stop(source),
  };
}
