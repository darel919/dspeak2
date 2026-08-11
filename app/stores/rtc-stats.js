import { defineStore } from "pinia";
import { useVoiceStore } from "./voice";
import { getRtcSignalMetrics } from "../shared/voice-transport";
import { calculateTransportBitrateBps } from "../shared/rtc-media-stats";
import { normalizeConnectionMetricValue } from "../shared/connection-quality";

const HISTORY_LIMIT = 30;
const SUMMARY_INTERVAL_MS = 5000;
const HIDDEN_INTERVAL_MS = 15000;
const DETAILED_INTERVAL_MS = 1000;

export const useRtcStatsStore = defineStore("rtc-stats", () => {
  const voiceStore = useVoiceStore();
  const snapshot = ref(null);
  const outbound = ref([]);
  const inbound = ref([]);
  const incomingBitrate = ref(null);
  const outgoingBitrate = ref(null);
  const history = reactive({
    rtt: [],
    availableOutgoingBitrate: [],
    outgoingBitrate: [],
    incomingAvailableBitrate: [],
    incomingBitrate: [],
    jitter: [],
    loss: [],
  });
  const polling = ref(false);
  const detailedPolling = ref(false);
  const lastError = ref("");
  let pollTimer = null;
  let pollBusy = false;
  let previousTrafficSample = null;
  let detailedConsumers = 0;

  function sumFinite(pairs, field) {
    const values = pairs
      .map((pair) => Number(pair?.[field]))
      .filter(Number.isFinite);
    return values.length
      ? values.reduce((total, value) => total + value, 0)
      : null;
  }

  function measuredTrafficBitrates(pairs, timestamp, updatePrevious = false) {
    const bytesSent = sumFinite(pairs, "bytesSent");
    const bytesReceived = sumFinite(pairs, "bytesReceived");
    const previous = previousTrafficSample;
    const outgoing = calculateTransportBitrateBps(
      bytesSent,
      timestamp,
      previous && { bytes: previous.bytesSent, timestamp: previous.timestamp },
    );
    const incoming = calculateTransportBitrateBps(
      bytesReceived,
      timestamp,
      previous && {
        bytes: previous.bytesReceived,
        timestamp: previous.timestamp,
      },
    );
    if (updatePrevious)
      previousTrafficSample = { bytesSent, bytesReceived, timestamp };
    return { outgoing, incoming };
  }

  const metrics = computed(() => {
    const result = getRtcSignalMetrics(snapshot.value?.transports);
    const pairs =
      snapshot.value?.transports
        ?.map((item) => item.candidatePair)
        .filter(Boolean) || [];
    return {
      ...result,
      lossPercent: result.loss == null ? null : result.loss * 100,
      availableOutgoingBitrate: sumFinite(pairs, "availableOutgoingBitrate"),
      outgoingBitrate: outgoingBitrate.value,
      incomingAvailableBitrate: sumFinite(pairs, "availableIncomingBitrate"),
      incomingBitrate: incomingBitrate.value,
    };
  });

  const report = computed(() => ({
    generatedAt: new Date().toISOString(),
    snapshot: snapshot.value,
    outbound: outbound.value,
    inbound: inbound.value,
  }));

  async function createDiagnosticReport() {
    if (!voiceStore.connected)
      throw new Error("There is no active RTC session to report.");
    const session = voiceStore.sfuComposable;
    if (!session?.getWebRTCStatsSnapshot)
      throw new Error("RTC diagnostics are unavailable for this session.");
    const diagnosticErrors = [];
    const collectOptional = async (label, operation) => {
      if (typeof operation !== "function") return [];
      try {
        return (await operation()) || [];
      } catch (error) {
        diagnosticErrors.push({
          label,
          message: error?.message || String(error),
        });
        return [];
      }
    };
    const [currentSnapshot, currentOutbound, currentInbound, peerConnections] =
      await Promise.all([
        session.getWebRTCStatsSnapshot(),
        collectOptional("outbound-rtp", () => session.getOutboundRtpStats?.()),
        collectOptional("inbound-rtp", () => session.getInboundRtpStats?.()),
        collectOptional("peer-connections", () =>
          session.getWebRTCDiagnosticStats?.(),
        ),
      ]);
    return {
      generatedAt: new Date().toISOString(),
      environment: {
        userAgent: navigator.userAgent,
        platform:
          navigator.userAgentData?.platform || navigator.platform || null,
        hardwareConcurrency: navigator.hardwareConcurrency || null,
        deviceMemory: navigator.deviceMemory || null,
        online: navigator.onLine,
      },
      protocol: currentSnapshot.protocol || null,
      lifecycle: currentSnapshot.lifecycle || [],
      readiness: currentSnapshot.readiness || null,
      snapshot: currentSnapshot,
      outbound: currentOutbound,
      inbound: currentInbound,
      history: Object.fromEntries(
        Object.entries(history).map(([key, samples]) => [key, [...samples]]),
      ),
      peerConnections,
      diagnosticErrors,
    };
  }

  function appendHistory(target, value, timestamp) {
    target.push({
      value: normalizeConnectionMetricValue(value),
      timestamp,
    });
    if (target.length > HISTORY_LIMIT)
      target.splice(0, target.length - HISTORY_LIMIT);
  }

  function reset() {
    snapshot.value = null;
    outbound.value = [];
    inbound.value = [];
    incomingBitrate.value = null;
    outgoingBitrate.value = null;
    history.rtt.splice(0);
    history.availableOutgoingBitrate.splice(0);
    history.outgoingBitrate.splice(0);
    history.incomingAvailableBitrate.splice(0);
    history.incomingBitrate.splice(0);
    history.jitter.splice(0);
    history.loss.splice(0);
    previousTrafficSample = null;
    lastError.value = "";
  }

  async function update({ detailed = detailedPolling.value } = {}) {
    if (pollBusy || !polling.value || !voiceStore.connected) return;
    const session = voiceStore.sfuComposable;
    if (!session?.getWebRTCStatsSnapshot) return;
    pollBusy = true;
    try {
      const next = await session.getWebRTCStatsSnapshot();
      const nextMetrics = getRtcSignalMetrics(next?.transports);
      const pairs =
        next?.transports?.map((item) => item.candidatePair).filter(Boolean) ||
        [];
      const availableOutgoingBitrate = sumFinite(
        pairs,
        "availableOutgoingBitrate",
      );
      const incomingAvailableBitrate = sumFinite(
        pairs,
        "availableIncomingBitrate",
      );
      const measured = measuredTrafficBitrates(pairs, next.timestamp, true);
      outgoingBitrate.value = measured.outgoing;
      incomingBitrate.value = measured.incoming;
      snapshot.value = next;
      if (detailed) {
        outbound.value = session.getOutboundRtpStats
          ? await session.getOutboundRtpStats()
          : [];
        inbound.value = session.getInboundRtpStats
          ? await session.getInboundRtpStats()
          : [];
      }
      appendHistory(history.rtt, nextMetrics.rttMs, next.timestamp);
      appendHistory(history.jitter, nextMetrics.jitterMs, next.timestamp);
      appendHistory(
        history.loss,
        nextMetrics.loss == null ? null : nextMetrics.loss * 100,
        next.timestamp,
      );
      appendHistory(
        history.availableOutgoingBitrate,
        availableOutgoingBitrate,
        next.timestamp,
      );
      appendHistory(history.outgoingBitrate, measured.outgoing, next.timestamp);
      appendHistory(
        history.incomingAvailableBitrate,
        incomingAvailableBitrate,
        next.timestamp,
      );
      appendHistory(history.incomingBitrate, measured.incoming, next.timestamp);
      lastError.value = "";
    } catch (error) {
      lastError.value =
        error?.message || "RTC statistics could not be collected.";
    } finally {
      pollBusy = false;
    }
  }

  function nextPollDelay() {
    if (document.hidden) return HIDDEN_INTERVAL_MS;
    return detailedPolling.value ? DETAILED_INTERVAL_MS : SUMMARY_INTERVAL_MS;
  }

  function scheduleNextPoll(delay = nextPollDelay()) {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      pollTimer = null;
      await update();
      if (polling.value && voiceStore.connected) scheduleNextPoll();
    }, delay);
  }

  function start() {
    if (!import.meta.client) return;
    polling.value = true;
    void update();
    scheduleNextPoll();
  }

  function stop() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    polling.value = false;
  }

  function startDetailed() {
    detailedConsumers += 1;
    detailedPolling.value = true;
    start();
    scheduleNextPoll(0);
  }

  function stopDetailed() {
    detailedConsumers = Math.max(0, detailedConsumers - 1);
    detailedPolling.value = detailedConsumers > 0;
    if (polling.value && voiceStore.connected) scheduleNextPoll();
  }

  function togglePolling() {
    polling.value = !polling.value;
    if (polling.value) {
      void update();
      scheduleNextPoll();
    } else if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function handleVisibilityChange() {
    if (!polling.value || !voiceStore.connected) return;
    scheduleNextPoll(document.hidden ? HIDDEN_INTERVAL_MS : 0);
  }

  watch(
    () => voiceStore.connected,
    (connected) => {
      if (connected) {
        start();
      } else {
        stop();
        reset();
      }
    },
    { immediate: true },
  );

  if (import.meta.client) {
    document.addEventListener("visibilitychange", handleVisibilityChange);
    onScopeDispose(() => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    });
  }

  return {
    snapshot,
    outbound,
    inbound,
    history,
    polling,
    detailedPolling,
    lastError,
    metrics,
    report,
    createDiagnosticReport,
    update,
    start,
    startDetailed,
    stop,
    stopDetailed,
    reset,
    togglePolling,
  };
});
