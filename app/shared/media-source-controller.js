export function createMediaSourceController({
  capture,
  connected,
  createSharedAudioSource,
  error,
  getActiveProvider,
  getIntentionalClose,
  getP2pMesh,
  getSfu,
  localSources,
  localVideoFeeds,
  onSharedAudioStopped,
  producerFacade,
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
  async function publishSource(sourceEntry) {
    const entry =
      sourceEntry.source === "screen-audio"
        ? await createSharedAudioSource(sourceEntry)
        : sourceEntry;
    const previous = localSources.get(entry.source);
    const p2pRequired =
      topologyState.value.mode === "p2p" ||
      topologyState.value.mode === "probing" ||
      topologyState.value.target === "p2p";
    const sfuRequired =
      topologyState.value.mode === "sfu" ||
      topologyState.value.target === "sfu";
    try {
      if (p2pRequired)
        await getP2pMesh()?.publishSource(
          entry.source,
          entry.track,
          entry.stream,
        );
      if (sfuRequired) await getSfu()?.addSource(entry);
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
              )
            : null,
          sfuRequired ? getSfu()?.addSource(previous) : null,
        ]);
      } else {
        await Promise.allSettled([getP2pMesh()?.unpublishSource(entry.source)]);
        getSfu()?.removeSource(entry.source);
        if (entry.source === "screen-audio") stopSharedAudioMeter();
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
    if (entry.source === "camera" || entry.source === "screen") {
      localVideoFeeds.value.set(entry.source, {
        source: entry.source,
        stream: entry.stream,
        producerId: `${getActiveProvider() || "local"}:${entry.track.id}`,
      });
      localVideoFeeds.value = new Map(localVideoFeeds.value);
    }
    if (entry.source === "screen-audio") startSharedAudioMeter(entry.track);
    sendSourceState();
    refreshPublicMaps();
    return entry;
  }

  function removeSource(entry, { unexpected = false } = {}) {
    const publishedEntry = localSources.get(entry.source);
    if (
      publishedEntry?.track !== entry.track &&
      publishedEntry?.captureTrack !== entry.track
    )
      return;
    localSources.delete(entry.source);
    if (entry.source === "audio") stopLocalVoiceDetection();
    getP2pMesh()
      ?.unpublishSource(entry.source)
      .catch((sourceError) => {
        error.value =
          sourceError?.message || `Unable to stop ${entry.source} publication`;
      });
    getSfu()?.removeSource(entry.source);
    localVideoFeeds.value.delete(entry.source);
    localVideoFeeds.value = new Map(localVideoFeeds.value);
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
    ) {
      startAudioProduction().catch((captureError) => {
        error.value =
          captureError?.message || "Unable to restore microphone capture";
      });
    }
  }

  function sendSourceState() {
    send({
      type: "media-sources",
      data: { sources: [...localSources.keys()] },
    });
  }

  function sendParticipantVoiceState() {
    return send({
      type: "participant-voice-state",
      data: {
        muted: voiceStore.micMuted,
        deafened: voiceStore.deafened,
      },
    });
  }

  function startAudioProduction() {
    return capture.startMicrophone().then((entry) => producerFacade(entry));
  }

  function restartAudioProduction() {
    return capture.restartMicrophone().then((entry) => producerFacade(entry));
  }

  function startVideoProduction(source) {
    return capture.startVideo(source).then((entry) => producerFacade(entry));
  }

  function startSystemAudioProduction() {
    return capture.startSystemAudio().then((entry) => producerFacade(entry));
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
