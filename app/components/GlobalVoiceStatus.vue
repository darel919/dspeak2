<template>
  <Teleport to="body">
    <aside v-if="visible && voiceStore.connected && route.path !== '/rtc-debug'" class="fixed bottom-4 right-4 z-50 w-[calc(100vw-2rem)] max-w-sm rounded-2xl border border-base-content/15 bg-base-200 p-4 shadow-2xl">
      <div class="flex items-center justify-between">
        <div>
          <div class="flex items-center gap-2 font-semibold text-primary"><Icon name="lucide:wifi" /> Connection</div>
          <div class="mt-1 text-xs text-base-content/55">{{ channelName }} · {{ participantLabel }}</div>
        </div>
        <div class="flex items-center gap-2">
          <span :class="['badge badge-sm', healthBadge]">{{ healthLabel }}</span>
          <button class="btn btn-ghost btn-xs btn-circle" title="Close connection summary" aria-label="Close connection summary" @click="visible = false"><Icon name="lucide:x" /></button>
        </div>
      </div>

      <div class="mt-3 border-t border-base-content/10 pt-3">
        <div class="mb-1 flex items-center justify-between text-xs"><strong>Round-trip latency</strong><span class="text-base-content/55">milliseconds</span></div>
        <RtcMetricChart label="Round-trip latency" unit="ms" :suggested-max="50" :samples="rtcStats.history.rtt" />
      </div>

      <div class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <span class="text-base-content/55">Route</span><strong>{{ routeLabel }}</strong>
        <span class="text-base-content/55">Average ping</span><strong>{{ averagePing }}</strong>
        <span class="text-base-content/55">Last ping</span><strong>{{ lastPing }}</strong>
        <span class="text-base-content/55">Packet loss</span><strong>{{ packetLoss }}</strong>
      </div>

      <p class="mt-3 text-xs leading-relaxed text-base-content/55">
        Audio may be delayed above 250 ms or sound robotic when packet loss exceeds 10%.
      </p>

      <div class="mt-3 border-t border-base-content/10 pt-3">
        <button class="btn btn-neutral btn-sm w-full" @click="openDebug"><Icon name="lucide:bug" /> Debug</button>
      </div>

      <div class="mt-3 flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-xs font-medium text-success">
        <Icon name="lucide:lock-keyhole" /> Media transport encrypted
      </div>
    </aside>
  </Teleport>
</template>

<script setup>
import { useVoiceStore } from '~/stores/voice'
import { useChannelsStore } from '~/stores/channels'
import { useRtcStatsStore } from '~/stores/rtc-stats'

const voiceStore = useVoiceStore()
const channelsStore = useChannelsStore()
const rtcStats = useRtcStatsStore()
const router = useRouter()
const route = useRoute()
const visible = useState('rtc-summary-visible', () => false)

const channelName = computed(() => channelsStore.getChannelById(voiceStore.currentChannelId)?.name || 'Voice channel')
const participantLabel = computed(() => {
  const count = voiceStore.getDisplayUsersArray().length
  return `${count} participant${count === 1 ? '' : 's'}`
})
const healthLabel = computed(() => rtcStats.metrics.connected ? rtcStats.metrics.label : 'Connecting')
const healthBadge = computed(() => rtcStats.metrics.score >= 4 ? 'badge-success' : rtcStats.metrics.score >= 2 ? 'badge-warning' : 'badge-error')
const routeLabel = computed(() => ({ 'p2p-direct': 'Direct P2P', 'p2p-mesh': 'Mesh P2P', sfu: 'SFU', 'sfu-ipv4': 'SFU IPv4' })[rtcStats.snapshot?.topology?.mode] || 'Connecting')
const lastPing = computed(() => formatMs(rtcStats.metrics.rttMs))
const packetLoss = computed(() => Number.isFinite(rtcStats.metrics.lossPercent) ? `${rtcStats.metrics.lossPercent.toFixed(1)}%` : '—')
const averagePing = computed(() => {
  const samples = rtcStats.history.rtt.map(sample => sample.value).filter(Number.isFinite)
  return formatMs(samples.length ? samples.reduce((total, value) => total + value, 0) / samples.length : null)
})

function formatMs(value) { return Number.isFinite(Number(value)) ? `${Math.round(Number(value))} ms` : '—' }
function openDebug() {
  visible.value = false
  router.push('/rtc-debug')
}

onMounted(rtcStats.start)
watch(() => voiceStore.connected, connected => {
  if (!connected) visible.value = false
})
watch(() => route.path, () => {
  visible.value = false
})
</script>
