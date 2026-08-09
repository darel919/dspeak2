import { computed, ref } from "vue";
import {
  resolveMediaAttenuation,
  summarizeMediaAttenuation,
} from "./media-attenuation-reporter.js";

export function createHybridMediaAudioState({
  attenuationReports,
  getRoomAttenuation,
  getStreamAttenuation,
  getPeers,
  getLocalPeerId,
  mediaConnectionState,
  playbackState,
}) {
  const getAttenuation = () =>
    resolveMediaAttenuation(getRoomAttenuation(), getStreamAttenuation());
  const sharedAudioAttenuation = computed(() =>
    summarizeMediaAttenuation(
      attenuationReports.value,
      getPeers(),
      getLocalPeerId(),
    ),
  );
  const sharedAudioDucking = ref({ active: false, effectivePercent: 100 });
  const setRouteConnectionState = (state) => {
    mediaConnectionState.value =
      playbackState.value === "blocked" ||
      playbackState.value === "output-blocked"
        ? "playback-blocked"
        : state;
  };
  return {
    getAttenuation,
    sharedAudioAttenuation,
    sharedAudioDucking,
    setRouteConnectionState,
  };
}
