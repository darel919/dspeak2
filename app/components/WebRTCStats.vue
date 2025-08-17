<template>
  <Teleport to="body">
    <div v-if="visible && voiceStore.connected" class="fixed bottom-4 right-4 z-[60] max-w-[380px] w-[90vw] md:w-[360px]">
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
            <button class="btn btn-ghost btn-xs" @click="showDebug = !showDebug" title="SFU Debug">
              SFU
            </button>
            <button class="btn btn-ghost btn-xs btn-circle" @click="visible = false" title="Close">
              ✕
            </button>
          </div>
        </div>
        <div class="p-3 text-xs max-h-[55vh] overflow-y-auto">
          <div v-if="lastError" class="alert alert-warning text-xs mb-2">{{ lastError }}</div>
          <div v-if="!snapshot" class="text-base-content/60">No stats yet.</div>
          <template v-else>
            <div class="text-base-content/60 mb-2">Updated: {{ new Date(snapshot.timestamp).toLocaleTimeString() }}</div>
            <div v-for="t in snapshot.transports" :key="t.kind" class="mb-3">
              <div class="font-semibold mb-1 capitalize">{{ t.kind }} transport</div>
              <div class="grid grid-cols-2 gap-x-3 gap-y-1">
                <div class="text-base-content/60">Conn</div>
                <div>{{ t.pcStates.connectionState }}/{{ t.pcStates.iceConnectionState }}</div>
                <div class="text-base-content/60">Signaling</div>
                <div>{{ t.pcStates.signalingState }}</div>

                <template v-if="t.candidatePair">
                  <div class="text-base-content/60">RTT</div>
                  <div>{{ formatMs(t.candidatePair.currentRoundTripTime) }}</div>
                  <template v-if="t.kind === 'send'">
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
              <div class="text-sm font-medium">SFU Debug</div>
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
            <div class="mb-2">
              <div class="text-base-content/60">Producer → User mappings</div>
              <div class="text-xs bg-base-200 p-2 rounded max-h-24 overflow-auto">
                <div v-if="mappings.length === 0" class="text-base-content/60">(no mappings)</div>
                <div v-for="m in mappings" :key="m[0] || m.id" class="mb-1 text-[11px]">{{ m[0] }} → {{ m[1] }}</div>
              </div>
            </div>
            <div>
              <div class="text-base-content/60">Failed consumers</div>
              <pre class="whitespace-pre-wrap text-[11px] bg-base-200 p-2 rounded max-h-20 overflow-auto">{{ JSON.stringify(failedList, null, 2) }}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { useVoiceStore } from '~/stores/voice'
import { useMediasoupSfu } from '~/composables/useMediasoupSfu'

const voiceStore = useVoiceStore()
const visible = useState('webrtc-stats-visible', () => false)
const polling = ref(true)
const snapshot = ref(null)
const lastError = ref('')
let intervalId = null
const showDebug = ref(false)
const sfu = useMediasoupSfu()
const unwrap = (v) => {
  try {
    if (!v) return null
    if (v && typeof v === 'object' && v.__v_isRef) return v.value
    return v
  } catch (_) { return v }
}

const sentJson = computed(() => {
  try { const obj = unwrap(sfu.lastSentClientRtpCapabilities) || unwrap(window?.sfuDebug?.lastSentClientRtpCapabilities); return JSON.stringify(obj || null, null, 2) } catch (_) { return 'null' }
})
const receivedJson = computed(() => {
  try { const obj = unwrap(sfu.lastReceivedConsumerParams) || unwrap(window?.sfuDebug?.lastReceivedConsumerParams); return JSON.stringify(obj || null, null, 2) } catch (_) { return 'null' }
})

const producersList = computed(() => {
  try {
    const m = sfu.producers && sfu.producers.value ? sfu.producers.value : (window?.sfuDebug?.producers || [])
    if (m && typeof m === 'object' && m instanceof Map) {
      return Array.from(m.entries()).map(([id, entry]) => ({ id, entry }))
    }
    return Array.isArray(m) ? m : Array.from(Object.entries(m || {})).map(([id, entry]) => ({ id, entry }))
  } catch (_) { return [] }
})

const consumersList = computed(() => {
  try {
    const m = sfu.consumers && sfu.consumers.value ? sfu.consumers.value : (window?.sfuDebug?.consumers || [])
    if (m && typeof m === 'object' && m instanceof Map) {
      return Array.from(m.entries()).map(([id, entry]) => ({ id, entry }))
    }
    return Array.isArray(m) ? m : Array.from(Object.entries(m || {})).map(([id, entry]) => ({ id, entry }))
  } catch (_) { return [] }
})

const mappings = computed(() => {
  try {
    const po = sfu && sfu.producerOwner ? (sfu.producerOwner.value || sfu.producerOwner) : (window?.sfuDebug?.producerOwner || [])
    if (po && po instanceof Map) return Array.from(po.entries())
    return Array.isArray(po) ? po : Array.from(Object.entries(po || {}))
  } catch (_) { return [] }
})

const failedList = computed(() => {
  try { return window?.sfuDebug?.failedConsumeProducers || [] } catch (_) { return [] }
})

function refreshDebug() {
  // reactive getters will update automatically; this keeps an explicit hook for future enhancements
}

async function copyDebug() {
  try {
  const prod = JSON.stringify(producersList.value, null, 2)
  const cons = JSON.stringify(consumersList.value, null, 2)
  const map = JSON.stringify(mappings.value, null, 2)
  const failed = JSON.stringify(failedList.value, null, 2)
  const text = `Sent:\n${sentJson.value}\n\nReceived:\n${receivedJson.value}\n\nProducers:\n${prod}\n\nConsumers:\n${cons}\n\nMappings:\n${map}\n\nFailedConsumers:\n${failed}`
    await navigator.clipboard.writeText(text)
    // small toast could be used; for now, just console
    console.log('[SFU] Debug copied to clipboard')
  } catch (e) { console.warn('[SFU] Copy debug failed', e) }
}

const statusDotClass = computed(() => {
  if (!snapshot.value || !snapshot.value.transports?.length) return 'bg-base-content/30'
  const anyFailed = snapshot.value.transports.some(t => t.pcStates.iceConnectionState !== 'connected')
  return anyFailed ? 'bg-warning' : 'bg-success'
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
function summarizeCand(c) {
  if (!c) return '-'
  const addr = c.address ? `${c.address}:${c.port}` : ''
  return `${c.candidateType || ''} ${c.protocol || ''} ${addr}`.trim()
}

async function pollOnce() {
  lastError.value = ''
  try {
    const sfu = voiceStore.sfuComposable
    if (!sfu || !sfu.getWebRTCStatsSnapshot || !voiceStore.connected) {
      snapshot.value = null
      return
    }
    const snap = await sfu.getWebRTCStatsSnapshot()
    // Augment with observed bitrate using outbound/inbound RTP deltas
    try {
      const now = performance.now()
      snap.transports?.forEach(t => {
        if (!pollOnce._last) pollOnce._last = {}
        // Outbound observed (send PC)
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
        // Inbound observed (recv PC)
        const ia = t.inboundAudio
        // Prefer inbound-rtp.bytesReceived; fallback to candidatePair.bytesReceived
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
    } catch (_) { /* best effort */ }
    snapshot.value = snap
  } catch (e) {
    lastError.value = e?.message || String(e)
  }
}

function startPolling() {
  if (intervalId) return
  pollOnce()
  intervalId = setInterval(() => { if (polling.value) pollOnce() }, 1000)
}
function stopPolling() {
  if (intervalId) { clearInterval(intervalId); intervalId = null }
}
function togglePolling() { polling.value = !polling.value }

onMounted(startPolling)
onBeforeUnmount(stopPolling)

// Expose a small API for other components to toggle visibility
// We use a shared state key so multiple components can control it

</script>
