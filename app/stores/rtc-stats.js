import { defineStore } from "pinia";
import { useVoiceStore } from "./voice";
import { getRtcSignalMetrics } from "../shared/voice-transport";
import { calculateTransportBitrateBps } from "../shared/rtc-media-stats";

const HISTORY_LIMIT = 60;

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
  const polling = ref(true);
  const lastError = ref("");
  let intervalId = null;
  let pollBusy = false;
  let previousTrafficSample = null;

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
    const [currentSnapshot, currentOutbound, currentInbound, peerConnections] =
      await Promise.all([
        session.getWebRTCStatsSnapshot(),
        session.getOutboundVideoStats ? session.getOutboundVideoStats() : [],
        session.getInboundVideoStats ? session.getInboundVideoStats() : [],
        session.getWebRTCDiagnosticStats
          ? session.getWebRTCDiagnosticStats()
          : [],
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
      snapshot: currentSnapshot,
      outbound: currentOutbound,
      inbound: currentInbound,
      history: Object.fromEntries(
        Object.entries(history).map(([key, samples]) => [key, [...samples]]),
      ),
      peerConnections,
    };
  }

  function appendHistory(target, value, timestamp) {
    target.push({
      value: Number.isFinite(Number(value)) ? Number(value) : null,
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

  async function update() {
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
      outbound.value = session.getOutboundVideoStats
        ? await session.getOutboundVideoStats()
        : [];
      inbound.value = session.getInboundVideoStats
        ? await session.getInboundVideoStats()
        : [];
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

  function start() {
    if (!import.meta.client || intervalId) return;
    update();
    intervalId = setInterval(update, 1000);
  }

  function stop() {
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
  }

  function togglePolling() {
    polling.value = !polling.value;
    if (polling.value) update();
  }

  watch(
    () => voiceStore.connected,
    (connected) => {
      if (connected) {
        start();
        update();
      } else {
        reset();
      }
    },
  );

  return {
    snapshot,
    outbound,
    inbound,
    history,
    polling,
    lastError,
    metrics,
    report,
    createDiagnosticReport,
    update,
    start,
    stop,
    reset,
    togglePolling,
  };
});
