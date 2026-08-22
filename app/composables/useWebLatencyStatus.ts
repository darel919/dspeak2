import { ref, computed, watch } from "vue";
import { unref } from "vue";
import {
  advanceRttWarningTracker,
  createRttWarningTrackerState,
  effectiveLatencyLevelFromTier,
} from "~/shared/web-rtc-latency-status.ts";
import type { VoiceMediaSessionLike } from "~/shared/types/voice-media-actions.ts";
import type { useRtcStatsStore } from "~/stores/rtc-stats";
import { isExternalNumber } from "~/shared/types/boundary.ts";

type RtcStatsStore = ReturnType<typeof useRtcStatsStore>;

export function useWebLatencyStatus(
  session: () => VoiceMediaSessionLike | null | undefined,
  rtcStats: RtcStatsStore,
) {
  const warningActive = ref(false);
  let tracker = createRttWarningTrackerState();

  const requestedProfile = computed(() => {
    const value = session()?.requestedLatencyProfile;
    return unref(value) ?? "standard";
  });
  const tier = computed(() => {
    const value = session()?.webMediaLatencyTier;
    return unref(value) ?? "standard-webrtc";
  });
  const effectiveLevel = computed(() =>
    effectiveLatencyLevelFromTier(tier.value, rtcStats.metrics.connected),
  );

  watch(
    () => rtcStats.history.rtt.length,
    () => {
      const latest =
        rtcStats.history.rtt[rtcStats.history.rtt.length - 1]?.value ?? null;
      const rttMs = isExternalNumber(latest) ? latest : null;
      tracker = advanceRttWarningTracker(tracker, rttMs);
      warningActive.value = tracker.active;
    },
  );

  return { requestedProfile, tier, effectiveLevel, warningActive };
}
