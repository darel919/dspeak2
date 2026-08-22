import { computed, ref, watch } from "vue";
import { useVoiceStore } from "~/stores/voice";
import { useRtcStatsStore } from "~/stores/rtc-stats";
import { useWebLatencyStatus } from "~/composables/useWebLatencyStatus";
import {
  getWebRtcLatencyEvents,
  type WebRtcLatencyDiagnosticEvent,
} from "~/shared/web-rtc-latency-diagnostics.ts";
import {
  probeWebRtcEnvironment,
  buildInitialCapabilityReport,
} from "~/shared/web-rtc-latency-capabilities.ts";

export function useRtcLatencyDebugPanel(section: { value: string }) {
  const voiceStore = useVoiceStore();
  const rtcStats = useRtcStatsStore();
  const { requestedProfile, tier, effectiveLevel, warningActive } =
    useWebLatencyStatus(() => voiceStore.sfuComposable, rtcStats);

  const environmentProbe = probeWebRtcEnvironment();
  const capabilityRows = computed<ReadonlyArray<readonly [string, string]>>(
    () => {
      const report = buildInitialCapabilityReport(environmentProbe);
      return [
        ["Receiver jitterBufferTarget", report.receiverJitterBufferTarget],
        ["Receiver targetLatency", report.receiverTargetLatency],
        [
          "Sender setParameters",
          report.senderSetParameters === "unknown"
            ? "verified live during capture"
            : report.senderSetParameters,
        ],
        [
          "Stats selected-candidate-pair RTT",
          report.rtcStats.selectedCandidatePairRtt,
        ],
        ["Stats inbound jitter", report.rtcStats.inboundJitter],
        ["Stats jitterBufferDelay", report.rtcStats.jitterBufferDelay],
      ];
    },
  );

  const recentLatencyEvents = ref<readonly WebRtcLatencyDiagnosticEvent[]>([]);
  function refreshLatencyEvents() {
    recentLatencyEvents.value = [...getWebRtcLatencyEvents()]
      .slice(-24)
      .reverse();
  }
  watch(
    () => section.value === "latency",
    (active) => {
      if (!active) return;
      refreshLatencyEvents();
    },
    { immediate: true },
  );

  return {
    requestedProfile,
    latencyTier: tier,
    effectiveLevel,
    warningActive,
    capabilityRows,
    recentLatencyEvents,
  };
}
