<template>
  <Teleport to="body">
    <div v-if="visible && voiceStore.connected" class="fixed bottom-4 right-4 z-[60] w-[calc(100vw-2rem)] max-w-[440px]">
      <div class="bg-base-200 border border-base-content/20 rounded-lg shadow-xl overflow-hidden">
        <div class="flex items-center justify-between px-3 py-2 bg-base-300 border-b border-base-content/10">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full" :class="statusDotClass"></span>
            <span class="text-sm font-medium">RTC Statistics</span>
          </div>
          <div class="flex items-center gap-1">
            <button class="btn btn-ghost btn-xs" @click="togglePolling">
              {{ polling ? 'Pause' : 'Start' }}
            </button>
            <button class="btn btn-ghost btn-xs" @click="copyDebug">
              {{ copied ? 'Copied' : 'Copy' }}
            </button>
            <button class="btn btn-ghost btn-xs" @click="showDebug = !showDebug" title="RTC Debug">
              RTC
            </button>
            <button class="btn btn-ghost btn-xs btn-circle" @click="visible = false" title="Close">
              <Icon name="lucide:x" class="size-3" />
            </button>
          </div>
        </div>
        <div class="p-3 text-xs max-h-[55vh] overflow-y-auto">
          <div v-if="lastError" class="alert alert-warning text-xs mb-2">{{ lastError }}</div>
          <div v-if="!snapshot" class="text-base-content/60">No stats yet.</div>
          <template v-else>
            <div class="text-base-content/60 mb-2">Updated: {{ new Date(snapshot.timestamp).toLocaleTimeString() }}</div>
            <RtcTopologyMap class="mb-3" :topology="snapshot.topology" :nodes="snapshot.nodes" :edges="snapshot.edges" />
            <div v-if="snapshot.peerRoundTripTime != null" class="mb-3 rounded-lg border border-base-content/20 p-2">
              <span class="text-base-content/60">Peer RTT</span>
              <span class="ml-2 font-mono">
                {{ `${Math.round(snapshot.peerRoundTripTime)} ms` }}
              </span>
            </div>
            <div v-if="screenShareStats" class="mb-3 rounded-lg border border-primary/30 bg-primary/5 p-2">
              <div class="mb-2 flex items-center justify-between">
                <div class="font-semibold">Screen share</div>
                <span class="badge badge-sm" :class="screenShareFpsLow ? 'badge-warning' : 'badge-success'">
                  {{ screenShareFpsLow ? 'Below target' : 'Healthy' }}
                </span>
              </div>
              <div class="grid grid-cols-2 gap-x-3 gap-y-1">
                <div class="text-base-content/60">Send / target FPS</div>
                <div>{{ formatFps(screenShareStats.fps) }} / {{ formatFps(screenShareStats.targetFps) }}</div>
                <div class="text-base-content/60">Browser target bitrate</div>
                <div>{{ formatKbps(screenShareStats.targetBitrateKbps) }}</div>
                <div class="text-base-content/60">Configured ceiling</div>
                <div>{{ formatKbps(screenShareStats.configuredMaxBitrateKbps) }}</div>
                <div class="text-base-content/60">Degradation policy</div>
                <div>{{ screenShareStats.degradationPreference || '-' }}</div>
                <div class="text-base-content/60">Capture track FPS</div>
                <div>{{ formatFps(screenShareStats.captureFps) }}</div>
                <template v-if="screenShareStats.backgroundFps != null">
                  <div class="text-base-content/60">Last background FPS</div>
                  <div>{{ formatFps(screenShareStats.backgroundFps) }}</div>
                </template>
                <div class="text-base-content/60">Encode time / frame</div>
                <div>{{ formatFrameTime(screenShareStats.frameTimeMs) }}</div>
                <div class="text-base-content/60">Encoder</div>
                <div>{{ formatCodecEngine(screenShareStats, 'encoder') }}</div>
                <div class="text-base-content/60">Codec</div>
                <div>{{ screenShareStats.codec || '-' }}</div>
                <div class="text-base-content/60">Send resolution</div>
                <div>{{ formatResolution(screenShareStats) }}</div>
                <div class="text-base-content/60">Adaptive scale</div>
                <div>{{ screenShareStats.resolutionScale > 1 ? `${screenShareStats.resolutionScale}× downscale` : 'Full resolution' }}</div>
                <div class="text-base-content/60">Frames encoded</div>
                <div>{{ screenShareStats.framesEncoded ?? '-' }}</div>
                <div class="text-base-content/60">Quality limitation</div>
                <div>{{ screenShareStats.qualityLimitationReason || 'none' }}</div>
              </div>
              <div v-if="screenShareStats.codecCapabilities?.length" class="mt-3 border-t border-base-content/10 pt-2">
                <div class="mb-1 font-semibold">Brave codec capability report</div>
                <div
                  v-for="codec in screenShareStats.codecCapabilities"
                  :key="codec.contentType"
                  class="mb-1 rounded bg-base-300/50 px-2 py-1 font-mono text-[11px]"
                  :title="codec.contentType"
                >
                  <div>{{ codec.mimeType }}</div>
                  <div v-if="codec.error" class="text-warning">query error: {{ codec.error }}</div>
                  <div v-else class="text-base-content/70">
                    supported {{ formatCapability(codec.supported) }} · smooth {{ formatCapability(codec.smooth) }} · power {{ formatCapability(codec.powerEfficient) }}
                  </div>
                  <div class="truncate text-base-content/50">{{ codec.contentType }}</div>
                </div>
              </div>
              <div v-if="screenShareStats.h264ProfileCapabilities?.length" class="mt-3 border-t border-base-content/10 pt-2">
                <div class="mb-1 font-semibold">H.264 profile probes</div>
                <div
                  v-for="profile in screenShareStats.h264ProfileCapabilities"
                  :key="profile.profileLevelId"
                  class="mb-1 grid grid-cols-[4.5rem_1fr] gap-2 rounded bg-base-300/50 px-2 py-1 font-mono text-[11px]"
                  :title="profile.contentType"
                >
                  <div>{{ profile.profileLevelId }}</div>
                  <div v-if="profile.error" class="text-warning">query error: {{ profile.error }}</div>
                  <div v-else>
                    supported {{ formatCapability(profile.supported) }} · smooth {{ formatCapability(profile.smooth) }} · power {{ formatCapability(profile.powerEfficient) }}
                  </div>
                </div>
              </div>
            </div>
            <div v-for="(video, index) in inboundVideoStats" :key="video.consumerId || index" class="mb-3 rounded-lg border border-base-content/20 p-2">
              <div class="mb-2 font-semibold">Received video {{ inboundVideoStats.length > 1 ? index + 1 : '' }}</div>
              <div class="grid grid-cols-2 gap-x-3 gap-y-1">
                <div class="text-base-content/60">Resolution</div><div>{{ formatResolution(video) }}</div>
                <div class="text-base-content/60">Received / decoded FPS</div><div>{{ formatFps(video.receivedFps ?? video.fps) }} / {{ formatFps(video.decodedFps ?? video.fps) }}</div>
                <div class="text-base-content/60">Browser-reported FPS</div><div>{{ formatFps(video.fps) }}</div>
                <div class="text-base-content/60">Video bitrate</div><div>{{ formatKbps(video.bitrateKbps) }}</div>
                <div class="text-base-content/60">Decode time / frame</div><div>{{ formatFrameTime(video.decodeTimeMs) }}</div>
                <div class="text-base-content/60">Decoder</div><div>{{ formatCodecEngine(video, 'decoder') }}</div>
                <div class="text-base-content/60">Codec</div><div>{{ video.codec || '-' }}</div>
                <div class="text-base-content/60">Frames recv / decoded / dropped</div><div>{{ formatCount(video.framesReceived) }} / {{ formatCount(video.framesDecoded) }} / {{ formatCount(video.framesDropped) }}</div>
                <div class="text-base-content/60">Packets recv / lost</div><div>{{ formatCount(video.packetsReceived) }} / {{ formatCount(video.packetsLost) }}</div>
                <div class="text-base-content/60">Jitter</div><div>{{ formatSecondsAsMs(video.jitter) }}</div>
                <div class="text-base-content/60">Freezes</div><div>{{ formatCount(video.freezeCount) }} · {{ formatSeconds(video.totalFreezesDuration) }}</div>
                <div class="text-base-content/60">PLI / FIR / NACK</div><div>{{ formatCount(video.pliCount) }} / {{ formatCount(video.firCount) }} / {{ formatCount(video.nackCount) }}</div>
              </div>
            </div>
            <div class="mb-3 rounded-lg border border-base-content/20 p-2">
              <div class="mb-1 font-semibold">Media pipeline occupancy</div>
              <div class="mb-2 text-[11px] text-base-content/50">Estimated from codec processing time, not system CPU/GPU utilization.</div>
              <div class="grid grid-cols-2 gap-x-3 gap-y-1">
                <div class="text-base-content/60">Software codecs</div><div>{{ formatPercent(deviceUtilization.cpu) }}</div>
                <div class="text-base-content/60">Hardware codecs</div><div>{{ formatPercent(deviceUtilization.gpu) }}</div>
              </div>
            </div>
            <div v-for="t in snapshot.transports" :key="t.kind" class="mb-3">
              <div class="font-semibold mb-1 capitalize">{{ t.kind }} transport</div>
              <div class="grid grid-cols-2 gap-x-3 gap-y-1">
                <div class="text-base-content/60">Conn</div>
                <div>{{ t.pcStates.connectionState }}/{{ t.pcStates.iceConnectionState }}</div>
                <div class="text-base-content/60">Signaling</div>
                <div>{{ t.pcStates.signalingState }}</div>

                <template v-if="t.candidatePair">
                  <div class="text-base-content/60">{{ t.kind.startsWith('p2p:') ? 'Peer RTT' : 'Client–SFU RTT' }}</div>
                  <div>{{ formatMs(t.candidatePair.currentRoundTripTime) }}</div>
                  <template v-if="t.outboundAudio">
                    <div class="text-base-content/60">Bitrate (target/observed)</div>
                    <div>{{ formatBitrate(t.outboundAudio?.targetBitrate ?? t.candidatePair.availableOutgoingBitrate) }} / {{ formatBitrate((t.observedKbpsOut ?? 0) * 1000) }}</div>
                  </template>
                  <template v-else>
                    <div class="text-base-content/60">Bitrate (observed)</div>
                    <div>{{ formatBitrate((t.observedKbpsIn ?? 0) * 1000) }}</div>
                  </template>
                  <div class="text-base-content/60">Pkts</div>
                  <div>{{ t.candidatePair.packetsSent ?? 0 }} / {{ t.candidatePair.packetsReceived ?? 0 }}</div>
                  <div class="text-base-content/60">Bytes</div>
                  <div>{{ formatBytes(t.candidatePair.bytesSent) }} / {{ formatBytes(t.candidatePair.bytesReceived) }}</div>
                  <div class="text-base-content/60">Local</div>
                  <div>{{ summarizeCand(t.candidatePair.local) }}</div>
                  <div class="text-base-content/60">Remote</div>
                  <div>{{ summarizeCand(t.candidatePair.remote) }}</div>
                </template>

                <template v-if="t.inboundAudio">
                  <div class="text-base-content/60">Inbound</div>
                  <div>pkts {{ t.inboundAudio.packetsReceived }} lost {{ t.inboundAudio.packetsLost }} jitt {{ formatMs(t.inboundAudio.jitter) }}</div>
                  <div class="text-base-content/60">Recent playout buffer</div>
                  <div>{{ t.inboundAudio.averageJitterBufferDelayMs != null ? `${t.inboundAudio.averageJitterBufferDelayMs.toFixed(1)} ms` : '-' }}</div>
                </template>
                <template v-if="t.outboundAudio">
                  <div class="text-base-content/60">Outbound</div>
                  <div>pkts {{ t.outboundAudio.packetsSent }} rate {{ formatBitrate(t.outboundAudio.targetBitrate) }}</div>
                </template>
                <template v-if="t.remoteInboundAudio">
                  <div class="text-base-content/60">Remote In</div>
                  <div>rtt {{ formatMs(t.remoteInboundAudio.roundTripTime) }} loss {{ t.remoteInboundAudio.fractionLost }}</div>
                </template>
              </div>
            </div>
          </template>
          <div v-if="showDebug" class="mt-3 border-t pt-3">
            <div class="flex items-center justify-between mb-2">
              <div class="text-sm font-medium">RTC Debug</div>
              <div class="flex items-center gap-2">
                <button class="btn btn-ghost btn-xs" @click="refreshDebug">Refresh</button>
                <button class="btn btn-ghost btn-xs" @click="copyDebug">Copy</button>
              </div>
            </div>
            <div class="mb-2">
              <div class="text-base-content/60">Last sent client RTP capabilities</div>
              <pre class="whitespace-pre-wrap text-[11px] bg-base-200 p-2 rounded max-h-36 overflow-auto">{{ sentJson }}</pre>
            </div>
            <div class="mb-2">
              <div class="text-base-content/60">Last received consumer params</div>
              <pre class="whitespace-pre-wrap text-[11px] bg-base-200 p-2 rounded max-h-36 overflow-auto">{{ receivedJson }}</pre>
            </div>
            <div class="mb-2">
              <div class="text-base-content/60">Producers</div>
              <div class="text-xs bg-base-200 p-2 rounded max-h-32 overflow-auto">
                <div v-if="producersList.length === 0" class="text-base-content/60">(no producers)</div>
                <div v-for="p in producersList" :key="p.id" class="mb-1">
                  <div class="font-medium">{{ p.id }}</div>
                  <div class="text-[11px] text-base-content/70">{{ JSON.stringify(p.entry, null, 2) }}</div>
                </div>
              </div>
            </div>
            <div class="mb-2">
              <div class="text-base-content/60">Consumers</div>
              <div class="text-xs bg-base-200 p-2 rounded max-h-32 overflow-auto">
                <div v-if="consumersList.length === 0" class="text-base-content/60">(no consumers)</div>
                <div v-for="c in consumersList" :key="c.id" class="mb-1">
                  <div class="font-medium">{{ c.id }}</div>
                  <div class="text-[11px] text-base-content/70">{{ JSON.stringify(c.entry, null, 2) }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { useVoiceStore } from '~/stores/voice'
import { calculateMediaEngineUtilization, classifyCodecImplementation, isScreenShareFpsBelowTarget } from '~/shared/video-settings'

const voiceStore = useVoiceStore()
const visible = useState('webrtc-stats-visible', () => false)
const polling = ref(true)
const snapshot = ref(null)
const outboundVideoStats = ref([])
const inboundVideoStats = ref([])
const lastError = ref('')
const copied = ref(false)
let intervalId = null
let copiedResetTimer = null
let pollInProgress = false
const showDebug = ref(false)
const sfu = computed(() => voiceStore.sfuComposable)
const screenShareStats = computed(() => outboundVideoStats.value.find(stat => stat.source === 'screen') || null)
const screenShareFpsLow = computed(() => isScreenShareFpsBelowTarget(screenShareStats.value?.fps, screenShareStats.value?.targetFps))
const deviceUtilization = computed(() => {
  const totals = { cpu: null, gpu: null }
  const samples = [...outboundVideoStats.value.map(stat => ({ stat, direction: 'encoder', time: stat.frameTimeMs })), ...inboundVideoStats.value.map(stat => ({ stat, direction: 'decoder', time: stat.decodeTimeMs }))]
  for (const sample of samples) {
    const value = calculateMediaEngineUtilization(sample.time, sample.stat.fps)
    if (value == null) continue
    const efficient = sample.stat[sample.direction === 'encoder' ? 'powerEfficientEncoder' : 'powerEfficientDecoder']
    const type = classifyCodecImplementation(sample.stat[`${sample.direction}Implementation`]).type
    const engine = type === 'hardware' || efficient === true
      ? 'gpu'
      : type === 'software' || efficient === false
        ? 'cpu'
        : null
    if (!engine) continue
    totals[engine] = (totals[engine] ?? 0) + value
  }
  return {
    cpu: totals.cpu == null ? null : Math.min(100, totals.cpu),
    gpu: totals.gpu == null ? null : Math.min(100, totals.gpu)
  }
})
const unwrap = (v) => {
  try {
    if (!v) return null
    if (v && typeof v === 'object' && v.__v_isRef) return v.value
    return v
  } catch (_) { return v }
}

const sentJson = computed(() => {
  try { return JSON.stringify(unwrap(sfu.value?.lastSentClientRtpCapabilities) || null, null, 2) } catch (_) { return 'null' }
})
const receivedJson = computed(() => {
  try { return JSON.stringify(unwrap(sfu.value?.lastReceivedConsumerParams) || null, null, 2) } catch (_) { return 'null' }
})

const producersList = computed(() => {
  try {
    const active = sfu.value
    const m = active?.producers?.value || active?.producers || []
    if (m && typeof m === 'object' && m instanceof Map) {
      return Array.from(m.entries()).map(([id, entry]) => ({ id, entry }))
    }
    return Array.isArray(m) ? m : Array.from(Object.entries(m || {})).map(([id, entry]) => ({ id, entry }))
  } catch (_) { return [] }
})

const consumersList = computed(() => {
  try {
    const active = sfu.value
    const m = active?.consumers?.value || active?.consumers || []
    if (m && typeof m === 'object' && m instanceof Map) {
      return Array.from(m.entries()).map(([id, entry]) => ({ id, entry }))
    }
    return Array.isArray(m) ? m : Array.from(Object.entries(m || {})).map(([id, entry]) => ({ id, entry }))
  } catch (_) { return [] }
})

function refreshDebug() {
  pollOnce()
}

async function copyDebug() {
  try {
  const prod = JSON.stringify(producersList.value, null, 2)
  const cons = JSON.stringify(consumersList.value, null, 2)
  const rtcSnapshot = JSON.stringify(snapshot.value, null, 2)
  const outbound = JSON.stringify(outboundVideoStats.value, null, 2)
  const inbound = JSON.stringify(inboundVideoStats.value, null, 2)
  const text = `RTC Snapshot:\n${rtcSnapshot}\n\nOutbound Video:\n${outbound}\n\nInbound Video:\n${inbound}\n\nSent RTP Capabilities:\n${sentJson.value}\n\nReceived Consumer Parameters:\n${receivedJson.value}\n\nProducers:\n${prod}\n\nConsumers:\n${cons}`
    await navigator.clipboard.writeText(text)
    copied.value = true
    if (copiedResetTimer) clearTimeout(copiedResetTimer)
    copiedResetTimer = setTimeout(() => {
      copied.value = false
      copiedResetTimer = null
    }, 1500)
  } catch (e) { console.warn('[SFU] Copy debug failed', e) }
}

const statusDotClass = computed(() => {
  if (!snapshot.value) return 'bg-base-content/30'
  if (snapshot.value.topology?.mode === 'p2p-direct' || snapshot.value.topology?.mode === 'p2p-mesh') return 'bg-success'
  if (!snapshot.value.transports?.length) return 'bg-base-content/30'
  const states = snapshot.value.transports.map(transport => transport.pcStates.iceConnectionState)
  if (states.some(state => ['failed', 'disconnected', 'closed'].includes(state))) return 'bg-warning'
  return states.some(state => ['connected', 'completed'].includes(state)) ? 'bg-success' : 'bg-base-content/30'
})

function formatMs(v) {
  if (v == null) return '-'
  const ms = typeof v === 'number' && v < 10 ? v * 1000 : v
  return `${ms.toFixed(0)} ms`
}
function formatBytes(v) {
  if (!v && v !== 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB']
  let n = Number(v), i = 0
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(1)} ${units[i]}`
}
function formatBitrate(v) {
  if (!v && v !== 0) return '-'
  let bps = Number(v)
  const units = ['bps', 'Kbps', 'Mbps', 'Gbps']
  let i = 0
  while (bps >= 1000 && i < units.length - 1) { bps /= 1000; i++ }
  return `${bps.toFixed(1)} ${units[i]}`
}
function formatKbps(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)} Kbps` : '-'
}
function formatCount(value) {
  return Number.isFinite(Number(value)) ? String(Number(value)) : '-'
}
function formatSeconds(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)} s` : '-'
}
function formatSecondsAsMs(value) {
  return Number.isFinite(Number(value)) ? `${(Number(value) * 1000).toFixed(1)} ms` : '-'
}
function formatFps(v) {
  return Number.isFinite(Number(v)) ? `${Number(v).toFixed(1)} fps` : '-'
}
function formatFrameTime(v) {
  return Number.isFinite(Number(v)) ? `${Number(v).toFixed(1)} ms` : '-'
}
function formatPercent(v) {
  return Number.isFinite(Number(v)) ? `${Number(v).toFixed(1)}%` : '-'
}
function formatCapability(value) {
  if (value === true) return 'yes'
  if (value === false) return 'no'
  return 'not reported'
}
function formatCodecEngine(stat, direction) {
  const efficient = stat?.[direction === 'encoder' ? 'powerEfficientEncoder' : 'powerEfficientDecoder']
  const implementation = stat?.[`${direction}Implementation`]
  const classified = classifyCodecImplementation(implementation)
  if (classified.type !== 'unknown') return classified.label
  if (efficient === true) return `Likely hardware${implementation ? ` (${implementation})` : ''}`
  if (efficient === false) return `Likely software${implementation ? ` (${implementation})` : ''}`
  return classified.label
}
function formatResolution(stat) {
  return stat?.width && stat?.height ? `${stat.width} × ${stat.height}` : '-'
}
function summarizeCand(c) {
  if (!c) return '-'
  const addr = c.address ? `${c.address}:${c.port}` : ''
  return `${c.candidateType || ''} ${c.protocol || ''} ${addr}`.trim()
}

async function pollOnce() {
  if (pollInProgress) return
  pollInProgress = true
  lastError.value = ''
  try {
    const sfu = voiceStore.sfuComposable
    if (!sfu || !sfu.getWebRTCStatsSnapshot || !voiceStore.connected) {
      snapshot.value = null
      return
    }
    const snap = await sfu.getWebRTCStatsSnapshot()
    outboundVideoStats.value = sfu.getOutboundVideoStats ? await sfu.getOutboundVideoStats() : []
    inboundVideoStats.value = sfu.getInboundVideoStats ? await sfu.getInboundVideoStats() : []

    try {
      const now = performance.now()
      snap.transports?.forEach(t => {
        if (!pollOnce._last) pollOnce._last = {}

        const ob = t.outboundAudio
        if (ob && typeof ob.bytesSent === 'number') {
          const key = (t.kind || 'send') + '-out'
          const prev = pollOnce._last[key]
          const dt = prev ? (now - prev.t) / 1000 : null
          const db = prev ? (ob.bytesSent - prev.b) : null
          const kbps = (dt && db && db > 0) ? (db * 8 / 1000) / dt : 0
          t.observedKbpsOut = kbps
          pollOnce._last[key] = { t: now, b: ob.bytesSent }
        }

        const ia = t.inboundAudio

        const rxBytes = (ia && typeof ia.bytesReceived === 'number') ? ia.bytesReceived
                      : (t.candidatePair && typeof t.candidatePair.bytesReceived === 'number') ? t.candidatePair.bytesReceived
                      : null
        if (rxBytes != null) {
          const keyIn = (t.kind || 'recv') + '-in'
          const prevIn = pollOnce._last[keyIn]
          const dtIn = prevIn ? (now - prevIn.t) / 1000 : null
          const dbIn = prevIn ? (rxBytes - prevIn.b) : null
          const kbpsIn = (dtIn && dbIn && dbIn > 0) ? (dbIn * 8 / 1000) / dtIn : 0
          t.observedKbpsIn = kbpsIn
          pollOnce._last[keyIn] = { t: now, b: rxBytes }
        }
      })
    } catch (_) {}
    snapshot.value = snap
  } catch (e) {
    lastError.value = e?.message || String(e)
    outboundVideoStats.value = []
    inboundVideoStats.value = []
  } finally {
    pollInProgress = false
  }
}

function startPolling() {
  if (intervalId) return
  pollOnce()
  intervalId = setInterval(() => { if (polling.value) pollOnce() }, 1000)
}
function stopPolling() {
  if (intervalId) { clearInterval(intervalId); intervalId = null }
  if (copiedResetTimer) { clearTimeout(copiedResetTimer); copiedResetTimer = null }
}
function togglePolling() { polling.value = !polling.value }

onMounted(startPolling)
onBeforeUnmount(stopPolling)




</script>
