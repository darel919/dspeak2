import { computed, ref } from "vue";
import type { Ref } from "vue";
import {
  resolveMediaAttenuation,
  summarizeMediaAttenuation,
} from "./media-attenuation-reporter.ts";

export function createHybridMediaAudioState({
  attenuationReports,
  getRoomAttenuation,
  getStreamAttenuation,
  getPeers,
  getLocalPeerId,
  mediaConnectionState,
  playbackState,
}: {
  attenuationReports: Ref<Map<string, unknown>>;
  getRoomAttenuation: () => Record<string, unknown> | null | undefined;
  getStreamAttenuation: () => { mode?: string; reductionPercent?: number };
  getPeers: () => Array<{ peerId?: string | number | null }>;
  getLocalPeerId: () => string | number | null;
  mediaConnectionState: Ref<string>;
  playbackState: Ref<string>;
}) {
  const getAttenuation = () =>
    resolveMediaAttenuation(getRoomAttenuation(), getStreamAttenuation());
  const sharedAudioAttenuation = computed(() =>
    summarizeMediaAttenuation(
      attenuationReports.value as Map<
        string,
        { active: boolean; effectivePercent: number }
      >,
      getPeers(),
      getLocalPeerId(),
    ),
  );
  const sharedAudioDucking = ref({ active: false, effectivePercent: 100 });
  const setRouteConnectionState = (state: string) => {
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
