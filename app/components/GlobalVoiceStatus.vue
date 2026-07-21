<template>
  <Teleport to="body">
    <div
      v-if="voiceStore.connected"
      class="fixed bottom-4 left-4 z-50 bg-base-300 border border-base-content/20 rounded-lg shadow-lg p-3 min-w-[280px]"
    >
      <!-- Header -->
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2">
          <Icon name="lucide:mic" class="w-4 h-4 text-success" />
          <span class="text-sm font-medium">Voice Connected</span>
          <div class="w-2 h-2 bg-success rounded-full animate-pulse"></div>
        </div>
        <div class="flex items-center gap-2">
          <!-- Signal Strength Indicator (click to open WebRTC Stats) -->
          <button
            v-if="voiceStore.connected"
            @click="openStats"
            class="btn btn-ghost btn-xs px-2 h-6 min-h-0"
            :title="signalTooltip"
          >
            <div class="flex items-end gap-0.5">
              <span
                class="w-1.5 rounded-sm"
                :class="[barClass(1), barColorClass]"
                style="height: 6px"
              ></span>
              <span
                class="w-1.5 rounded-sm"
                :class="[barClass(2), barColorClass]"
                style="height: 9px"
              ></span>
              <span
                class="w-1.5 rounded-sm"
                :class="[barClass(3), barColorClass]"
                style="height: 12px"
              ></span>
              <span
                class="w-1.5 rounded-sm"
                :class="[barClass(4), barColorClass]"
                style="height: 15px"
              ></span>
            </div>
          </button>


        <button
          @click="voiceStore.leaveVoiceChannel"
          class="btn btn-ghost btn-xs btn-circle"
          title="Disconnect"
        >
          <Icon name="lucide:x" class="w-3 h-3" />
        </button>
        </div>
      </div>

      <!-- Channel Info -->
      <div class="text-xs text-base-content/60 mb-3">
        {{ currentChannelName }} • {{ connectedUsers.length }} participant{{ connectedUsers.length !== 1 ? 's' : '' }}
      </div>
      <!-- Mini Network Status -->
      <div v-if="voiceStore.connected" class="text-[11px] text-base-content/50 mb-2">
        <span class="mr-2">Net:</span>
        <span class="mr-2">RTT {{ lastRttMs != null ? Math.round(lastRttMs) + 'ms' : '-' }}</span>
        <span class="mr-2">Jitter {{ lastJitterMs != null ? Math.round(lastJitterMs) + 'ms' : '-' }}</span>
        <span>Loss {{ lastLoss != null ? (lastLoss*100).toFixed(1) + '%' : '-' }}</span>
      </div>

      <!-- Connected Users (Mini List) -->
      <div v-if="connectedUsers.length > 0" class="space-y-1 mb-3 max-h-24 overflow-y-auto">
        <div
          v-for="user in connectedUsers.slice(0, 4)"
          :key="user.id"
          class="flex items-center gap-2 text-xs"
        >
          <div class="avatar placeholder">
            <div class="w-5 h-5 rounded-full bg-neutral text-neutral-content text-xs">
              {{ getUserInitials(user) }}
            </div>
          </div>
          <span class="truncate flex-1">{{ getUserDisplayName(user) }}</span>

          <!-- Speaking Indicator -->
          <div v-if="user.speaking" class="w-1.5 h-1.5 bg-success rounded-full animate-pulse"></div>

          <!-- Muted Indicator -->
          <Icon name="lucide:mic-off" v-if="user.muted" class="w-3 h-3 text-error" />
        </div>

        <div v-if="connectedUsers.length > 4" class="text-xs text-base-content/40 text-center">
          +{{ connectedUsers.length - 4 }} more...
        </div>
      </div>

      <!-- Voice Controls -->
      <div class="flex items-center justify-center gap-2">
        <!-- Microphone Control -->
        <button
          @click="voiceStore.toggleMic"
          :disabled="!voiceStore.connected || (voiceStore.sfuComposable && !voiceStore.sfuComposable.transportReady)"
          :class="[
            'btn btn-circle btn-sm',
            voiceStore.micMuted ? 'btn-error' : 'btn-outline'
          ]"
          :title="getMicButtonTitle()"
        >
          <Icon name="lucide:mic" v-if="!voiceStore.micMuted" class="w-4 h-4 text-current" />
          <Icon name="lucide:mic-off" v-else class="w-4 h-4 text-white" />
        </button>

        <!-- Deafen Control -->
        <button
          @click="voiceStore.toggleDeafen"
          :class="[
            'btn btn-circle btn-sm',
            voiceStore.deafened ? 'btn-error' : 'btn-outline'
          ]"
          :title="voiceStore.deafened ? 'Undeafen' : 'Deafen'"
        >
          <Icon name="lucide:volume-2" v-if="!voiceStore.deafened" class="w-4 h-4" />
          <Icon name="lucide:volume-x" v-else class="w-4 h-4" />
        </button>

        <!-- Settings/Options -->
        <button
          @click="navigateToVoiceChannel"
          class="btn btn-ghost btn-sm btn-circle"
          title="Go to voice channel"
        >
          <Icon name="lucide:circle-arrow-right" class="w-4 h-4" />
        </button>
      </div>

      <!-- Connection Status -->
      <div class="text-center mt-2">
        <div v-if="!voiceStore.sfuComposable?.transportReady" class="flex items-center justify-center gap-1 text-warning">
          <span class="loading loading-spinner loading-xs"></span>
          <span class="text-xs">Setting up...</span>
        </div>
        <div v-else class="flex items-center justify-center gap-1 text-success">
          <div class="w-1.5 h-1.5 bg-success rounded-full"></div>
          <span class="text-xs">Ready</span>
        </div>
      </div>
    </div>

  <!-- Audio elements are managed in a global hidden container to persist across navigation -->
  </Teleport>
</template>

<script setup>
import { getRtcSignalMetrics } from '../shared/voice-transport'
import { useVoiceStore } from '~/stores/voice'
import { useChannelsStore } from '~/stores/channels'

const voiceStore = useVoiceStore()
const channelsStore = useChannelsStore()
const router = useRouter()

const connectedUsers = computed(() => voiceStore.getDisplayUsersArray())

const currentChannelName = computed(() => {
  if (!voiceStore.currentChannelId) return 'Voice Channel'
  const channel = channelsStore.getChannelById(voiceStore.currentChannelId)
  return channel?.name || 'Voice Channel'
})

function getUserDisplayName(user) {
  try {
    const me = useAuthStore && useAuthStore().getUserData ? useAuthStore().getUserData() : null
    if (me && me.id && String(me.id) === String(user.id)) return 'You'
  } catch (_) { /* noop */ }
  return user.display_name || user.username || user.name || user.email || `User ${user.id}`
}

function getUserInitials(user) {
  const name = getUserDisplayName(user)
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

function getMicButtonTitle() {
  if (!voiceStore.connected) return 'Not connected'
  if (voiceStore.sfuComposable && !voiceStore.sfuComposable.transportReady) return 'Setting up connection...'
  return voiceStore.micMuted ? 'Unmute Microphone' : 'Mute Microphone'
}

function navigateToVoiceChannel() {
  if (voiceStore.currentChannelId && voiceStore.currentRoomId) {
    router.push(`/room/${voiceStore.currentRoomId}/${voiceStore.currentChannelId}`)
  }
}


const statsVisible = useState('webrtc-stats-visible', () => false)
function openStats() { statsVisible.value = true }


const signalLevel = ref(0)
const signalLabel = ref('Disconnected')
const lastRttMs = ref(null)
const lastJitterMs = ref(null)
const lastLoss = ref(null)
let statTimer = null

function barClass(n) {
  return signalLevel.value >= n ? '' : 'opacity-25'
}
const barColorClass = computed(() => {
  if (signalLevel.value >= 4) return 'bg-success'
  if (signalLevel.value === 3) return 'bg-success'
  if (signalLevel.value === 2) return 'bg-warning'
  if (signalLevel.value === 1) return 'bg-error'
  return 'bg-base-content/40'
})
const signalTooltip = computed(() => {
  const parts = [signalLabel.value]
  if (lastRttMs.value != null) parts.push(`RTT ${Math.round(lastRttMs.value)} ms`)
  if (lastJitterMs.value != null) parts.push(`Jitter ${Math.round(lastJitterMs.value)} ms`)
  if (lastLoss.value != null) parts.push(`Loss ${(lastLoss.value*100).toFixed(1)}%`)
  return parts.join(' • ')
})

async function pollSignal() {
  try {
    const sfu = voiceStore.sfuComposable
    if (!voiceStore.connected || !sfu || !sfu.getWebRTCStatsSnapshot) {
      signalLevel.value = 0
      signalLabel.value = 'Disconnected'
      return
    }
    const snap = await sfu.getWebRTCStatsSnapshot()
    const metrics = getRtcSignalMetrics(snap?.transports)
    if (!metrics.connected) {
      signalLevel.value = 1
      signalLabel.value = 'Connecting'
      return
    }
    lastRttMs.value = metrics.rttMs
    lastJitterMs.value = metrics.jitterMs
    lastLoss.value = metrics.loss
    signalLevel.value = metrics.score
    signalLabel.value = metrics.label
  } catch (_) {

  }
}

onMounted(() => {
  statTimer = setInterval(pollSignal, 1000)
})
onBeforeUnmount(() => {
  if (statTimer) { clearInterval(statTimer); statTimer = null }
})
</script>
