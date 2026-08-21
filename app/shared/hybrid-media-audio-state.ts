import { computed, ref } from "vue";
import type { Ref } from "vue";
import {
  isExternalBoolean,
  isExternalNumber,
  isExternalRecord,
} from "./types/boundary.ts";
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
  const parseAttenuationReports = () => {
    const parsed = new Map<
      string,
      { active: boolean; effectivePercent: number }
    >();
    for (const [peerId, report] of attenuationReports.value) {
      if (!isExternalRecord(report)) continue;
      if (!isExternalBoolean(report.active)) continue;
      if (!isExternalNumber(report.effectivePercent)) continue;
      parsed.set(peerId, {
        active: report.active,
        effectivePercent: report.effectivePercent,
      });
    }
    return parsed;
  };
  const sharedAudioAttenuation = computed(() =>
    summarizeMediaAttenuation(
      parseAttenuationReports(),
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
