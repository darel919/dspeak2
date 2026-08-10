import { RemoteMediaRegistry } from "./remote-media-registry.js";

export function createHybridMediaRegistry({
  audioFeeds,
  videoFeeds,
  getAttenuation,
  voiceStore,
  settingsStore,
  getActiveProvider,
  getSfu,
  getP2pMesh,
  error,
  playbackState,
  mediaConnectionState,
  iceConnectedBoth,
  setConnectionPhase,
  getAttenuationReporter,
}) {
  return new RemoteMediaRegistry({
    audioFeeds,
    videoFeeds,
    getVolume: (userId, source) => voiceStore.getTrackVolume(userId, source),
    getOutputDevice: () => settingsStore.outputDeviceId,
    isDeafened: () => voiceStore.deafened,
    isBroadcastMode: () => settingsStore.broadcastMode,
    isAnyoneSpeaking: () =>
      [...voiceStore.connectedUsers.values()].some(
        (participant) => participant.speaking === true,
      ),
    onSpeaking: (userId, speaking) =>
      voiceStore.updateUserSpeaking(userId, speaking),
    getAttenuation,
    onVideoReceivingChange: (entry, receiving) => {
      if (entry.provider === "sfu")
        getSfu()
          ?.setRemoteReceiving(entry.userId, entry.source, receiving)
          .catch((receivingError) => {
            error.value =
              receivingError.message || "Remote media state change failed";
          });
      if (entry.provider === "p2p")
        getP2pMesh()?.setRemoteReceiving(entry.peerId, entry.source, receiving);
    },
    onPlaybackState: ({ state }) => {
      playbackState.value = state;
      if (state === "blocked" || state === "output-blocked") {
        mediaConnectionState.value = "playback-blocked";
        setConnectionPhase("playback-blocked", { reason: state });
        iceConnectedBoth.value = false;
      } else if (
        state === "ready" &&
        mediaConnectionState.value === "playback-blocked"
      ) {
        const provider = getActiveProvider();
        const readiness =
          provider === "p2p"
            ? { ready: getP2pMesh()?.isMediaReady?.() === true }
            : provider === "sfu"
              ? getSfu()?.connectionState()
              : null;
        const ready = readiness?.ready === true;
        iceConnectedBoth.value = ready;
        mediaConnectionState.value = ready
          ? "media-flowing"
          : "transport-connecting";
      }
    },
    onEffectiveGain: (state) => getAttenuationReporter()?.report(state),
  });
}
