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
  producerFacade,
  refreshPublicMaps,
  reportSfuFailure,
  send,
  setMicrophoneTransmission,
  startLocalVoiceDetection,
  startSharedAudioMeter,
  stopLocalVoiceDetection,
  stopSharedAudioMeter,
  topologyState,
  voiceStore,
}) {
  function publishSource(sourceEntry) {
    const entry =
      sourceEntry.source === "screen-audio"
        ? createSharedAudioSource(sourceEntry)
        : sourceEntry;
    localSources.set(entry.source, entry);
    if (entry.source === "audio") startLocalVoiceDetection(entry);
    if (entry.source === "camera" || entry.source === "screen") {
      localVideoFeeds.value.set(entry.source, {
        source: entry.source,
        stream: entry.stream,
        producerId: `${getActiveProvider() || "local"}:${entry.track.id}`,
      });
      localVideoFeeds.value = new Map(localVideoFeeds.value);
    }
    if (
      topologyState.value.mode === "p2p" ||
      topologyState.value.mode === "probing" ||
      topologyState.value.target === "p2p"
    )
      getP2pMesh()?.publishSource(entry.source, entry.track, entry.stream);
    if (
      topologyState.value.mode === "sfu" ||
      topologyState.value.target === "sfu"
    )
      getSfu()
        ?.addSource(entry)
        .catch((sourceError) => {
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
    if (entry.source === "audio")
      queueMicrotask(() => setMicrophoneTransmission(false));
    if (entry.source === "screen-audio") startSharedAudioMeter(entry.track);
    sendSourceState();
    refreshPublicMaps();
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
    getP2pMesh()?.unpublishSource(entry.source);
    getSfu()?.removeSource(entry.source);
    localVideoFeeds.value.delete(entry.source);
    localVideoFeeds.value = new Map(localVideoFeeds.value);
    if (entry.source === "screen-audio") stopSharedAudioMeter();
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

  function startVideoProduction(source) {
    return capture.startVideo(source).then((entry) => producerFacade(entry));
  }

  function startSystemAudioProduction() {
    return capture.startSystemAudio().then((entry) => producerFacade(entry));
  }

  return {
    publishSource,
    removeSource,
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
