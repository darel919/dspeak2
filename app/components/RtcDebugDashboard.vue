<template>
  <div class="rtc-debug-shell">
    <aside class="rtc-sidebar">
      <NuxtLink :to="returnPath" class="rtc-back"
        ><Icon name="lucide:arrow-left" /> Back to dSpeak</NuxtLink
      >
      <div class="rtc-identity">
        <div class="rtc-avatar"><Icon name="lucide:radio-tower" /></div>
        <div>
          <strong>{{ channelName }}</strong
          ><span>{{
            voiceStore.connected ? "Connected" : "Disconnected"
          }}</span>
        </div>
      </div>
      <p class="rtc-nav-label">RTC DEBUG</p>
      <button
        v-for="item in navigation"
        :key="item.id"
        class="rtc-nav-item"
        :class="{ active: section === item.id }"
        @click="section = item.id"
      >
        <Icon :name="item.icon" /> {{ item.label }}
      </button>
      <div class="rtc-sidebar-footer">
        <span
          :class="['rtc-live-dot', { active: polling && voiceStore.connected }]"
        />
        {{ polling ? "Live sampling" : "Sampling paused" }}
      </div>
    </aside>

    <main class="rtc-content">
      <header class="rtc-header">
        <div>
          <p>REAL-TIME CONNECTION DIAGNOSTICS</p>
          <h1>{{ activeSection.label }}</h1>
        </div>
        <div class="rtc-actions">
          <span class="rtc-updated">{{ updatedLabel }}</span>
          <button class="rtc-button" @click="togglePolling">
            <Icon :name="polling ? 'lucide:pause' : 'lucide:play'" />{{
              polling ? "Pause" : "Resume"
            }}
          </button>
          <button class="rtc-button primary" @click="copyReport">
            <Icon name="lucide:clipboard" />{{
              copied ? "Copied" : "Copy report"
            }}
          </button>
        </div>
      </header>

      <div v-if="lastError || copyError" class="rtc-alert">
        <Icon name="lucide:triangle-alert" /> {{ copyError || lastError }}
      </div>
      <div v-if="!voiceStore.connected" class="rtc-empty-state">
        <div class="rtc-empty-icon"><Icon name="lucide:radio-tower" /></div>
        <h2>No active RTC session</h2>
        <p>
          Join a voice channel to inspect transport, audio, video, and route
          statistics in real time.
        </p>
        <NuxtLink to="/" class="rtc-button primary"
          >Find a voice channel</NuxtLink
        >
      </div>

      <template v-else-if="snapshot">
        <section class="rtc-summary-grid">
          <article
            v-for="metric in summaryMetrics"
            :key="metric.label"
            class="rtc-summary-card"
          >
            <div class="rtc-summary-top">
              <span>{{ metric.label }}</span
              ><Icon :name="metric.icon" />
            </div>
            <strong>{{ metric.value }}</strong
            ><small>{{ metric.hint }}</small>
          </article>
        </section>

        <section v-if="section === 'latency'" class="rtc-panel">
          <div class="rtc-panel-heading">
            <div>
              <h2>Web latency tuning</h2>
              <p>Requested vs effective profile and live capability</p>
            </div>
            <span :class="['rtc-health', warningActive ? 'fair' : 'good']">{{
              warningActive ? "High RTT" : "Nominal"
            }}</span>
          </div>
          <div class="rtc-metric-table">
            <div class="rtc-metric-row">
              <span>Requested profile</span
              ><strong>{{
                requestedProfile === "ultra-low" ? "Ultra low" : "Standard"
              }}</strong>
            </div>
            <div class="rtc-metric-row">
              <span>Effective tier</span
              ><strong>{{
                latencyTier === "latency-tuned-webrtc"
                  ? "Latency-tuned WebRTC"
                  : "Standard WebRTC"
              }}</strong>
            </div>
            <div class="rtc-metric-row">
              <span>Effective level</span><strong>{{ effectiveLevel }}</strong>
            </div>
          </div>
        </section>

        <section v-if="section === 'latency'" class="rtc-panel">
          <div class="rtc-panel-heading">
            <div>
              <h2>Capability report</h2>
              <p>Browser environment probe for latency controls</p>
            </div>
          </div>
          <div class="rtc-metric-table">
            <div
              v-for="[label, state] in capabilityRows"
              :key="label"
              class="rtc-metric-row"
            >
              <span>{{ label }}</span
              ><strong>{{ state }}</strong>
            </div>
          </div>
        </section>

        <section
          v-if="section === 'latency' && recentLatencyEvents.length"
          class="rtc-panel"
        >
          <div class="rtc-panel-heading">
            <div>
              <h2>Recent tuning events</h2>
              <p>Receiver and sender policy outcomes this session</p>
            </div>
          </div>
          <ul class="rtc-event-list">
            <li v-for="(event, index) in recentLatencyEvents" :key="index">
              {{ event.kind }}
            </li>
          </ul>
        </section>

        <section v-if="section === 'overview'" class="rtc-panel">
          <div class="rtc-panel-heading">
            <div>
              <h2>Connection health</h2>
              <p>Last 60 seconds</p>
            </div>
            <span :class="['rtc-health', healthTone]">{{ healthLabel }}</span>
          </div>
          <div class="rtc-chart-grid">
            <div>
              <div class="rtc-chart-title">
                <strong>Round-trip time</strong
                ><span>{{ formatMs(metrics.rttMs) }}</span>
              </div>
              <RtcMetricChart
                label="Round-trip time"
                unit="ms"
                :suggested-max="50"
                :samples="history.rtt"
              />
            </div>
            <div>
              <div class="rtc-chart-title">
                <strong>Measured outgoing bitrate</strong
                ><span>{{ formatBitrate(metrics.outgoingBitrate) }}</span>
              </div>
              <RtcMetricChart
                label="Measured outgoing bitrate"
                unit="bps"
                :samples="history.outgoingBitrate"
              />
            </div>
            <div>
              <div class="rtc-chart-title">
                <strong>Available outgoing capacity</strong
                ><span>{{
                  formatBitrate(metrics.availableOutgoingBitrate)
                }}</span>
              </div>
              <RtcMetricChart
                label="Available outgoing capacity"
                unit="bps"
                :samples="history.availableOutgoingBitrate"
              />
            </div>
            <div>
              <div class="rtc-chart-title">
                <strong>Available incoming bitrate</strong
                ><span>{{
                  formatBitrate(metrics.incomingAvailableBitrate)
                }}</span>
              </div>
              <RtcMetricChart
                label="Available incoming bitrate"
                unit="bps"
                :samples="history.incomingAvailableBitrate"
              />
            </div>
            <div>
              <div class="rtc-chart-title">
                <strong>Measured incoming bitrate</strong
                ><span>{{ formatBitrate(metrics.incomingBitrate) }}</span>
              </div>
              <RtcMetricChart
                label="Measured incoming bitrate"
                unit="bps"
                :samples="history.incomingBitrate"
              />
            </div>
            <div>
              <div class="rtc-chart-title">
                <strong>Jitter</strong
                ><span>{{ formatMs(metrics.jitterMs) }}</span>
              </div>
              <RtcMetricChart
                label="Jitter"
                unit="ms"
                :suggested-max="30"
                :samples="history.jitter"
              />
            </div>
            <div>
              <div class="rtc-chart-title">
                <strong>Packet loss</strong
                ><span>{{ formatPercent(metrics.lossPercent) }}</span>
              </div>
              <RtcMetricChart
                label="Packet loss"
                unit="%"
                :suggested-max="10"
                :samples="history.loss"
              />
            </div>
          </div>
          <div class="rtc-topology">
            <div class="rtc-chart-title">
              <strong>Active media route</strong
              ><span>{{ formatRoute(snapshot.topology?.mode) }}</span>
            </div>
            <RtcTopologyMap
              class="rtc-topology-map"
              :topology="snapshot.topology"
              :nodes="snapshot.nodes"
              :edges="snapshot.edges"
            />
          </div>
        </section>

        <section v-if="section === 'transport'" class="rtc-panel">
          <div class="rtc-panel-heading">
            <div>
              <h2>Transport</h2>
              <p>{{ snapshot.topology?.mode || "RTC route" }}</p>
            </div>
          </div>
          <div
            v-for="transport in snapshot.transports"
            :key="transport.kind"
            class="rtc-transport"
          >
            <div class="rtc-transport-title">
              <strong>{{ transport.kind }}</strong
              ><span
                >{{ transport.pcStates?.connectionState || "—" }} /
                {{ transport.pcStates?.iceConnectionState || "—" }}</span
              >
            </div>
            <div class="rtc-detail-grid">
              <div>
                <span>Local candidate</span
                ><strong>{{
                  formatCandidate(transport.candidatePair?.local)
                }}</strong>
              </div>
              <div>
                <span>Remote candidate</span
                ><strong>{{
                  formatCandidate(transport.candidatePair?.remote)
                }}</strong>
              </div>
              <div>
                <span>Packets sent</span
                ><strong>{{
                  formatNumber(transport.candidatePair?.packetsSent)
                }}</strong>
              </div>
              <div>
                <span>Packets received</span
                ><strong>{{
                  formatNumber(transport.candidatePair?.packetsReceived)
                }}</strong>
              </div>
              <div>
                <span>Bytes sent</span
                ><strong>{{
                  formatBytes(transport.candidatePair?.bytesSent)
                }}</strong>
              </div>
              <div>
                <span>Bytes received</span
                ><strong>{{
                  formatBytes(transport.candidatePair?.bytesReceived)
                }}</strong>
              </div>
              <div>
                <span>Round-trip time</span
                ><strong>{{
                  formatSecondsMs(transport.candidatePair?.currentRoundTripTime)
                }}</strong>
              </div>
              <div>
                <span>Available outgoing capacity</span
                ><strong>{{
                  formatBitrate(
                    transport.candidatePair?.availableOutgoingBitrate,
                  )
                }}</strong>
              </div>
              <div>
                <span>Available incoming bitrate</span
                ><strong>{{
                  formatBitrate(
                    transport.candidatePair?.availableIncomingBitrate,
                  )
                }}</strong>
              </div>
              <div>
                <span>Requests sent</span
                ><strong>{{
                  formatNumber(transport.candidatePair?.requestsSent)
                }}</strong>
              </div>
              <div>
                <span>Responses received</span
                ><strong>{{
                  formatNumber(transport.candidatePair?.responsesReceived)
                }}</strong>
              </div>
              <div>
                <span>Consent requests</span
                ><strong>{{
                  formatNumber(transport.candidatePair?.consentRequestsSent)
                }}</strong>
              </div>
            </div>
            <div
              v-if="transport.outboundAudio || transport.inboundAudio"
              class="rtc-audio-grid"
            >
              <div v-if="transport.outboundAudio">
                <h3>Outbound audio</h3>
                <div class="rtc-detail-grid">
                  <div>
                    <span>Packets sent</span
                    ><strong>{{
                      formatNumber(transport.outboundAudio.packetsSent)
                    }}</strong>
                  </div>
                  <div>
                    <span>Bytes sent</span
                    ><strong>{{
                      formatBytes(transport.outboundAudio.bytesSent)
                    }}</strong>
                  </div>
                  <div>
                    <span>Target bitrate</span
                    ><strong>{{
                      formatBitrate(transport.outboundAudio.targetBitrate)
                    }}</strong>
                  </div>
                </div>
              </div>
              <div v-if="transport.inboundAudio">
                <h3>Inbound audio</h3>
                <div class="rtc-detail-grid">
                  <div>
                    <span>Packets received</span
                    ><strong>{{
                      formatNumber(transport.inboundAudio.packetsReceived)
                    }}</strong>
                  </div>
                  <div>
                    <span>Packets lost</span
                    ><strong>{{
                      formatNumber(transport.inboundAudio.packetsLost)
                    }}</strong>
                  </div>
                  <div>
                    <span>Jitter</span
                    ><strong>{{
                      formatSecondsMs(transport.inboundAudio.jitter)
                    }}</strong>
                  </div>
                  <div>
                    <span>Jitter buffer</span
                    ><strong>{{
                      formatMs(
                        transport.inboundAudio.averageJitterBufferDelayMs,
                      )
                    }}</strong>
                  </div>
                  <div>
                    <span>Target buffer</span
                    ><strong>{{
                      formatMs(
                        transport.inboundAudio.averageJitterBufferTargetDelayMs,
                      )
                    }}</strong>
                  </div>
                  <div>
                    <span>Min buffer</span
                    ><strong>{{
                      formatMs(
                        transport.inboundAudio
                          .averageJitterBufferMinimumDelayMs,
                      )
                    }}</strong>
                  </div>
                  <div>
                    <span>Bytes received</span
                    ><strong>{{
                      formatBytes(transport.inboundAudio.bytesReceived)
                    }}</strong>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section
          v-if="section === 'outbound' || section === 'inbound'"
          class="rtc-panel"
        >
          <div class="rtc-panel-heading">
            <div>
              <h2>{{ activeSection.label }}</h2>
              <p>Audio and video RTP streams</p>
            </div>
          </div>
          <div v-if="activeStreams.length" class="rtc-stream-list">
            <article
              v-for="(stream, index) in activeStreams"
              :key="stream.source || stream.consumerId || index"
              class="rtc-stream"
            >
              <div class="rtc-transport-title">
                <strong>{{
                  stream.source ||
                  `Remote ${stream.kind || "media"} ${index + 1}`
                }}</strong
                ><span
                  >{{ stream.kind || "Media" }} ·
                  {{ stream.codec || "Codec unreported" }}</span
                >
              </div>
              <div class="rtc-detail-grid">
                <div v-if="stream.kind === 'video'">
                  <span>Resolution</span
                  ><strong>{{
                    stream.width && stream.height
                      ? `${stream.width} × ${stream.height}`
                      : "—"
                  }}</strong>
                </div>
                <div v-if="stream.kind === 'video'">
                  <span>Frame rate</span
                  ><strong>{{ formatFps(stream.fps) }}</strong>
                </div>
                <div>
                  <span>Bitrate</span
                  ><strong>{{
                    formatBitrate((stream.bitrateKbps || 0) * 1000)
                  }}</strong>
                </div>
                <div>
                  <span>Packets</span
                  ><strong>{{
                    formatNumber(stream.packetsSent ?? stream.packetsReceived)
                  }}</strong>
                </div>
                <div>
                  <span>Bytes</span
                  ><strong>{{
                    formatBytes(stream.bytesSent ?? stream.bytesReceived)
                  }}</strong>
                </div>
                <div v-if="stream.kind === 'video'">
                  <span>Quality limit</span
                  ><strong>{{
                    stream.qualityLimitationReason || "none"
                  }}</strong>
                </div>
                <div>
                  <span>SSRC</span
                  ><strong>{{ formatNumber(stream.ssrc) }}</strong>
                </div>
                <div v-if="stream.kind === 'video'">
                  <span>{{
                    section === "outbound" ? "Frames encoded" : "Frames decoded"
                  }}</span
                  ><strong>{{
                    formatNumber(stream.framesEncoded ?? stream.framesDecoded)
                  }}</strong>
                </div>
                <div v-if="stream.kind === 'video'">
                  <span>Frames dropped</span
                  ><strong>{{ formatNumber(stream.framesDropped) }}</strong>
                </div>
                <div v-if="stream.kind === 'video'">
                  <span>Key frames</span
                  ><strong>{{
                    formatNumber(
                      stream.keyFramesEncoded ?? stream.keyFramesDecoded,
                    )
                  }}</strong>
                </div>
                <div v-if="stream.kind === 'video'">
                  <span>NACK / PLI / FIR</span
                  ><strong>{{ formatCounts(stream) }}</strong>
                </div>
                <div v-if="stream.kind === 'video'">
                  <span>{{
                    section === "outbound" ? "Encode time" : "Decode time"
                  }}</span
                  ><strong>{{
                    formatMs(stream.frameTimeMs ?? stream.decodeTimeMs)
                  }}</strong>
                </div>
                <div v-if="stream.kind === 'video'">
                  <span>Implementation</span
                  ><strong>{{
                    stream.encoderImplementation ||
                    stream.decoderImplementation ||
                    "—"
                  }}</strong>
                </div>
                <div v-if="stream.kind === 'video'">
                  <span>Power efficient</span
                  ><strong>{{
                    formatBoolean(
                      stream.powerEfficientEncoder ??
                        stream.powerEfficientDecoder,
                    )
                  }}</strong>
                </div>
                <div v-if="section === 'inbound' && stream.kind === 'video'">
                  <span>Freezes</span
                  ><strong>{{ formatNumber(stream.freezeCount) }}</strong>
                </div>
                <div v-if="stream.kind === 'audio'">
                  <span>Audio level</span
                  ><strong>{{ formatAudioLevel(stream.audioLevel) }}</strong>
                </div>
                <div v-if="section === 'inbound' && stream.kind === 'audio'">
                  <span>Jitter</span
                  ><strong>{{ formatSecondsMs(stream.jitter) }}</strong>
                </div>
                <div v-if="section === 'inbound' && stream.kind === 'audio'">
                  <span>Samples received</span
                  ><strong>{{
                    formatNumber(stream.totalSamplesReceived)
                  }}</strong>
                </div>
                <div v-if="section === 'inbound' && stream.kind === 'audio'">
                  <span>Concealed samples</span
                  ><strong>{{ formatNumber(stream.concealedSamples) }}</strong>
                </div>
              </div>
            </article>
          </div>
          <div v-else class="rtc-no-streams">
            No {{ section }} RTP streams are active.
          </div>
        </section>
      </template>
      <div v-else-if="voiceStore.connected" class="rtc-loading">
        <span class="metro-spinner" /> Collecting the first RTC sample…
      </div>
    </main>
  </div>
</template>

<script setup>
import { useVoiceStore } from "~/stores/voice";
import { useChannelsStore } from "~/stores/channels";
import { useRtcStatsStore } from "~/stores/rtc-stats";
import { storeToRefs } from "pinia";
import { getActiveConnectionLabel } from "~/shared/connection-quality";
import { copyTextToClipboard } from "~/shared/copy-to-clipboard";
import { formatTopologyReason } from "~/shared/rtc-topology";
import { useRtcLatencyDebugPanel } from "~/composables/useRtcLatencyDebugPanel";

const voiceStore = useVoiceStore();
const channelsStore = useChannelsStore();
const rtcStats = useRtcStatsStore();
const { snapshot, outbound, inbound, polling, lastError, history, metrics } =
  storeToRefs(rtcStats);
const section = ref("overview");
const {
  requestedProfile,
  latencyTier,
  effectiveLevel,
  warningActive,
  capabilityRows,
  recentLatencyEvents,
} = useRtcLatencyDebugPanel(section);
const copied = ref(false);
const copyError = ref("");
let copiedTimer = null;

const navigation = [
  { id: "overview", label: "Overview", icon: "lucide:layout-dashboard" },
  { id: "latency", label: "Latency", icon: "lucide:zap" },
  { id: "transport", label: "Transport", icon: "lucide:network" },
  { id: "outbound", label: "Outbound", icon: "lucide:arrow-up-right" },
  { id: "inbound", label: "Inbound", icon: "lucide:arrow-down-left" },
];
const activeSection = computed(
  () => navigation.find((item) => item.id === section.value) || navigation[0],
);
const channelName = computed(
  () =>
    channelsStore.getChannelById(voiceStore.currentChannelId)?.name ||
    "RTC session",
);
const returnPath = computed(() =>
  voiceStore.currentRoomId && voiceStore.currentChannelId
    ? `/room/${voiceStore.currentRoomId}/${voiceStore.currentChannelId}`
    : "/",
);
const activeStreams = computed(() =>
  section.value === "outbound" ? outbound.value : inbound.value,
);
const healthLabel = computed(() =>
  getActiveConnectionLabel(
    metrics.value.score,
    voiceStore.sfuComposable?.mediaConnectionState,
    metrics.value.connected,
  ),
);
const healthTone = computed(() => {
  if (
    healthLabel.value === "Connection issue" ||
    healthLabel.value === "Playback blocked"
  )
    return "poor";
  if (
    healthLabel.value === "Reconnecting" ||
    healthLabel.value === "Selecting media route" ||
    healthLabel.value === "Transport connecting"
  )
    return "fair";
  if (!metrics.value.connected) return "good";
  if (metrics.value.score >= 4) return "good";
  if (metrics.value.score >= 2) return "fair";
  return "poor";
});
const updatedLabel = computed(() =>
  snapshot.value
    ? `Updated ${new Date(snapshot.value.timestamp).toLocaleTimeString()}`
    : "Waiting for data",
);
const summaryMetrics = computed(() => [
  {
    label: "Route",
    value: formatRoute(snapshot.value?.topology?.mode),
    hint: formatTopologyReason(snapshot.value?.topology?.reason),
    icon: "lucide:route",
  },
  {
    label: "Ping",
    value: formatMs(metrics.value.rttMs),
    hint: "Round-trip time",
    icon: "lucide:gauge",
  },
  {
    label: "Packet loss",
    value: formatPercent(metrics.value.lossPercent),
    hint: "Worst active transport",
    icon: "lucide:package-x",
  },
  {
    label: "Streams",
    value: String(outbound.value.length + inbound.value.length),
    hint: `${outbound.value.length} out · ${inbound.value.length} in`,
    icon: "lucide:radio",
  },
  {
    label: "Latency tier",
    value: latencyTier.value === "latency-tuned-webrtc" ? "Tuned" : "Standard",
    hint:
      requestedProfile.value === "ultra-low"
        ? "Ultra-low requested"
        : "Standard requested",
    icon: "lucide:zap",
  },
]);

function togglePolling() {
  rtcStats.togglePolling();
}
async function copyReport() {
  copied.value = false;
  copyError.value = "";
  try {
    const report = await rtcStats.createDiagnosticReport();
    const copiedReport = await copyTextToClipboard(
      JSON.stringify(report, null, 2),
    );
    if (!copiedReport)
      throw new Error(
        "Clipboard access is unavailable. Allow clipboard access and try again.",
      );
    copied.value = true;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
      copied.value = false;
    }, 1600);
  } catch (error) {
    copyError.value = error?.message || "The RTC report could not be copied.";
  }
}
function formatRoute(value) {
  return (
    {
      "p2p-direct": "Direct P2P",
      "p2p-mesh": "Mesh P2P",
      sfu: "SFU",
      "sfu-ipv4": "SFU IPv4",
    }[value] ||
    value ||
    "Unknown"
  );
}
function formatMs(value) {
  return value != null && Number.isFinite(Number(value))
    ? `${Math.round(Number(value))} ms`
    : "—";
}
function formatSecondsMs(value) {
  return value != null && Number.isFinite(Number(value))
    ? `${Math.round(Number(value) * 1000)} ms`
    : "—";
}
function formatAudioLevel(value) {
  return value != null && Number.isFinite(Number(value))
    ? `${Math.round(Number(value) * 100)}%`
    : "—";
}
function formatBoolean(value) {
  return value === true || value === false ? (value ? "Yes" : "No") : "—";
}
function formatCounts(stream) {
  return [stream.nackCount, stream.pliCount, stream.firCount]
    .map((value) =>
      Number.isFinite(Number(value)) ? Number(value).toLocaleString() : "—",
    )
    .join(" / ");
}
function formatPercent(value) {
  return value != null && Number.isFinite(Number(value))
    ? `${Number(value).toFixed(1)}%`
    : "—";
}
function formatFps(value) {
  return Number.isFinite(Number(value))
    ? `${Number(value).toFixed(1)} fps`
    : "—";
}
function formatBitrate(value) {
  if (!Number.isFinite(Number(value))) return "—";
  return Number(value) >= 1000000
    ? `${(Number(value) / 1000000).toFixed(2)} Mbps`
    : `${(Number(value) / 1000).toFixed(1)} Kbps`;
}
function formatBytes(value) {
  if (!Number.isFinite(Number(value))) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let amount = Number(value);
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount.toFixed(1)} ${units[unit]}`;
}
function formatNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString() : "—";
}
function formatCandidate(candidate) {
  if (!candidate) return "Unreported";
  const address = candidate.address
    ? `${candidate.address}:${candidate.port}`
    : "";
  return [candidate.candidateType, candidate.protocol, address]
    .filter(Boolean)
    .join(" · ");
}

onMounted(() => {
  rtcStats.startDetailed();
});
onBeforeUnmount(() => {
  rtcStats.stopDetailed();
  if (copiedTimer) clearTimeout(copiedTimer);
});
</script>

<style scoped>
.rtc-debug-shell {
  --rtc-bg: var(--color-base-100);
  --rtc-panel: var(--color-base-200);
  --rtc-raised: var(--color-base-300);
  --rtc-line: color-mix(in oklab, var(--color-base-content) 16%, transparent);
  --rtc-muted: color-mix(in oklab, var(--color-base-content) 62%, transparent);
  min-height: calc(100dvh - var(--navbar-height));
  display: grid;
  grid-template-columns: 16rem minmax(0, 1fr);
  background: var(--rtc-bg);
  color: var(--color-base-content);
}
.rtc-sidebar {
  position: sticky;
  top: var(--navbar-height);
  height: calc(100dvh - var(--navbar-height));
  padding: 1.5rem 1rem;
  background: color-mix(
    in oklab,
    var(--color-base-200) 82%,
    var(--color-base-100)
  );
  border-right: 1px solid var(--rtc-line);
}
.rtc-back,
.rtc-nav-item {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  width: 100%;
  border-radius: 0.5rem;
  color: var(--rtc-muted);
}
.rtc-back {
  font-size: 0.8rem;
  margin-bottom: 1.75rem;
}
.rtc-back:hover {
  color: var(--color-base-content);
}
.rtc-identity {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  margin-bottom: 1.5rem;
}
.rtc-identity div:last-child {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.rtc-identity strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rtc-identity span {
  color: var(--color-success);
  font-size: 0.75rem;
}
.rtc-avatar {
  display: grid;
  place-items: center;
  flex: 0 0 2.5rem;
  height: 2.5rem;
  border-radius: 50%;
  color: var(--color-primary-content);
  background: var(--color-primary);
}
.rtc-nav-label {
  padding: 0 0.75rem;
  margin-bottom: 0.35rem;
  color: var(--rtc-muted);
  font-size: 0.67rem;
  font-weight: 800;
  letter-spacing: 0.08em;
}
.rtc-nav-item {
  padding: 0.65rem 0.75rem;
  font-size: 0.9rem;
  font-weight: 600;
  text-align: left;
}
.rtc-nav-item:hover {
  color: var(--color-base-content);
  background: color-mix(in oklab, var(--color-base-content) 7%, transparent);
}
.rtc-nav-item.active {
  color: var(--color-base-content);
  background: var(--color-base-300);
}
.rtc-nav-item :deep(svg),
.rtc-back :deep(svg) {
  width: 1rem;
  height: 1rem;
}
.rtc-sidebar-footer {
  position: absolute;
  bottom: 1.4rem;
  left: 1.75rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--rtc-muted);
  font-size: 0.75rem;
}
.rtc-live-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: color-mix(in oklab, var(--color-base-content) 35%, transparent);
}
.rtc-live-dot.active {
  background: var(--color-success);
  box-shadow: 0 0 0 0.25rem
    color-mix(in oklab, var(--color-success) 14%, transparent);
}
.rtc-content {
  min-width: 0;
  padding: 2.5rem clamp(1.25rem, 4vw, 4.5rem) 5rem;
}
.rtc-header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 2rem;
}
.rtc-header p {
  color: var(--rtc-muted);
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.11em;
}
.rtc-header h1 {
  margin-top: 0.25rem;
  font-size: clamp(1.7rem, 3vw, 2.25rem);
  font-weight: 750;
}
.rtc-actions {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.rtc-updated {
  color: var(--rtc-muted);
  font-size: 0.72rem;
  margin-right: 0.25rem;
}
.rtc-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  min-height: 2.35rem;
  padding: 0 0.85rem;
  border: 1px solid var(--rtc-line);
  border-radius: 0.5rem;
  color: var(--color-base-content);
  background: var(--rtc-raised);
  font-size: 0.8rem;
  font-weight: 650;
}
.rtc-button:hover {
  background: color-mix(
    in oklab,
    var(--color-base-300) 80%,
    var(--color-base-content)
  );
}
.rtc-button.primary {
  border-color: var(--color-primary);
  color: var(--color-primary-content);
  background: var(--color-primary);
}
.rtc-button :deep(svg) {
  width: 0.9rem;
}
.rtc-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.8rem;
  margin-bottom: 0.8rem;
}
.rtc-summary-card,
.rtc-panel {
  border: 1px solid var(--rtc-line);
  border-radius: 0.75rem;
  background: var(--rtc-panel);
  box-shadow: 0 12px 35px
    color-mix(in oklab, var(--color-base-content) 9%, transparent);
}
.rtc-summary-card {
  padding: 1rem;
}
.rtc-summary-top {
  display: flex;
  justify-content: space-between;
  color: var(--rtc-muted);
  font-size: 0.75rem;
}
.rtc-summary-top :deep(svg) {
  width: 1rem;
}
.rtc-summary-card > strong {
  display: block;
  margin-top: 0.65rem;
  font-size: 1.45rem;
  line-height: 1.1;
}
.rtc-summary-card small {
  display: block;
  overflow: hidden;
  margin-top: 0.35rem;
  color: var(--rtc-muted);
  font-size: 0.68rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rtc-panel {
  padding: 1.35rem;
}
.rtc-panel-heading,
.rtc-chart-title,
.rtc-transport-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.rtc-panel-heading {
  padding-bottom: 1.15rem;
  border-bottom: 1px solid var(--rtc-line);
}
.rtc-panel-heading h2 {
  font-size: 1rem;
  font-weight: 700;
}
.rtc-panel-heading p {
  color: var(--rtc-muted);
  font-size: 0.72rem;
}
.rtc-health {
  padding: 0.25rem 0.55rem;
  border-radius: 999px;
  font-size: 0.7rem;
  font-weight: 700;
}
.rtc-health.good {
  color: var(--color-success);
  background: color-mix(in oklab, var(--color-success) 14%, transparent);
}
.rtc-health.fair {
  color: var(--color-warning);
  background: color-mix(in oklab, var(--color-warning) 14%, transparent);
}
.rtc-health.poor {
  color: var(--color-error);
  background: color-mix(in oklab, var(--color-error) 14%, transparent);
}
.rtc-chart-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 1.5rem;
}
.rtc-chart-grid > div {
  min-width: 0;
  padding: 1.25rem 0 0.3rem;
}
.rtc-chart-grid > div:nth-child(-n + 2) {
  border-bottom: 1px solid var(--rtc-line);
}
.rtc-chart-title {
  margin-bottom: 0.25rem;
  font-size: 0.78rem;
}
.rtc-chart-title span {
  color: var(--rtc-muted);
  font-variant-numeric: tabular-nums;
}
.rtc-topology {
  padding-top: 1.25rem;
  margin-top: 0.5rem;
  border-top: 1px solid var(--rtc-line);
}
.rtc-topology .rtc-chart-title {
  margin-bottom: 1rem;
}
.rtc-topology-map {
  width: min(100%, 36rem);
  margin-inline: auto;
}
.rtc-transport,
.rtc-stream {
  padding: 1.1rem 0;
  border-bottom: 1px solid var(--rtc-line);
}
.rtc-transport:last-child,
.rtc-stream:last-child {
  border-bottom: 0;
}
.rtc-transport-title {
  margin-bottom: 1rem;
  text-transform: capitalize;
}
.rtc-transport-title span {
  color: var(--rtc-muted);
  font-size: 0.75rem;
  text-transform: none;
}
.rtc-detail-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}
.rtc-audio-grid {
  display: grid;
  gap: 1rem;
  padding-top: 1rem;
}
.rtc-audio-grid h3 {
  margin-bottom: 0.6rem;
  font-size: 0.8rem;
  font-weight: 700;
}
.rtc-detail-grid > div {
  min-width: 0;
  padding: 0.8rem;
  border-radius: 0.5rem;
  background: var(--rtc-raised);
}
.rtc-detail-grid span,
.rtc-detail-grid strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rtc-detail-grid span {
  margin-bottom: 0.35rem;
  color: var(--rtc-muted);
  font-size: 0.68rem;
}
.rtc-detail-grid strong {
  font-size: 0.8rem;
  font-weight: 600;
}
.rtc-alert {
  display: flex;
  gap: 0.5rem;
  padding: 0.8rem 1rem;
  margin-bottom: 0.8rem;
  border: 1px solid color-mix(in oklab, var(--color-warning) 35%, transparent);
  border-radius: 0.6rem;
  color: var(--color-warning);
  background: color-mix(in oklab, var(--color-warning) 9%, transparent);
  font-size: 0.8rem;
}
.rtc-empty-state,
.rtc-loading,
.rtc-no-streams {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  min-height: 25rem;
  padding: 2rem;
  border: 1px solid var(--rtc-line);
  border-radius: 0.75rem;
  color: var(--rtc-muted);
  text-align: center;
  background: var(--rtc-panel);
}
.rtc-empty-state h2 {
  margin-top: 1rem;
  color: var(--color-base-content);
  font-size: 1.2rem;
  font-weight: 700;
}
.rtc-empty-state p {
  max-width: 28rem;
  margin: 0.4rem 0 1.25rem;
  font-size: 0.85rem;
}
.rtc-empty-icon {
  display: grid;
  place-items: center;
  width: 4rem;
  height: 4rem;
  border-radius: 50%;
  color: var(--color-primary-content);
  background: var(--color-primary);
}
.rtc-empty-icon :deep(svg) {
  width: 1.7rem;
  height: 1.7rem;
}
.rtc-no-streams {
  min-height: 12rem;
  margin-top: 1rem;
}
@media (max-width: 900px) {
  .rtc-debug-shell {
    grid-template-columns: 1fr;
  }
  .rtc-sidebar {
    position: static;
    width: 100%;
    height: auto;
    padding: 0.8rem;
    border-right: 0;
    border-bottom: 1px solid var(--rtc-line);
  }
  .rtc-back,
  .rtc-identity,
  .rtc-nav-label,
  .rtc-sidebar-footer {
    display: none;
  }
  .rtc-sidebar {
    display: flex;
    gap: 0.25rem;
    overflow-x: auto;
  }
  .rtc-nav-item {
    width: auto;
    white-space: nowrap;
  }
  .rtc-summary-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 600px) {
  .rtc-content {
    padding: 1.25rem 0.8rem 3rem;
  }
  .rtc-header {
    align-items: flex-start;
    flex-direction: column;
  }
  .rtc-actions {
    width: 100%;
  }
  .rtc-updated {
    display: none;
  }
  .rtc-button {
    flex: 1;
  }
  .rtc-summary-grid,
  .rtc-chart-grid,
  .rtc-detail-grid {
    grid-template-columns: 1fr;
  }
  .rtc-chart-grid > div {
    border-bottom: 1px solid var(--rtc-line);
  }
  .rtc-summary-card > strong {
    font-size: 1.2rem;
  }
}
</style>
