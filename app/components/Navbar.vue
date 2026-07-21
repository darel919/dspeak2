
<script setup lang="ts">
import { useAuthStore } from '../stores/auth'
import { useVoiceStore } from '../stores/voice'
import { useChannelsStore } from '../stores/channels'
import { useSettingsStore } from '../stores/settings'
import { isScreenShareFpsBelowTarget } from '../shared/video-settings'
import { getRtcSignalMetrics } from '../shared/voice-transport'
import { getConnectionQualityBars, getConnectionQualityLabel } from '../shared/connection-quality'

import RoomList from './RoomList.vue'


const authStore = useAuthStore();
const voiceStore = useVoiceStore();
const channelsStore = useChannelsStore();
const settingsStore = useSettingsStore();
const broadcastMode = computed(() => settingsStore.broadcastMode)
function toggleBroadcastMode() {
    settingsStore.setBroadcastMode(!settingsStore.broadcastMode)
}
const profile = computed(() => authStore.getUserData());
const route = useRoute();
const router = useRouter();

const currentRoomId = computed(() => {
    if (route.path.startsWith('/room/')) {
        return route.params.roomId as string;
    }
    return null;
});



const presenceStatus = inject('presenceStatus', ref(null)) as Ref<string|null>


const avatarStatusClass = computed(() => {
    if (voiceStore.error && !voiceStore.connected) return 'avatar-offline ring-2 ring-error ring-offset-2';
    if (!presenceStatus?.value) return ''
    if (presenceStatus.value === 'connected') return 'avatar-online'
    if (presenceStatus.value === 'permanently-disconnected') return 'avatar-offline'
    return 'avatar-offline'
})

const isDisconnected = computed(() => {
    return presenceStatus?.value === 'permanently-disconnected'
})


const currentVoiceChannel = computed(() => {
    if (!voiceStore.currentChannelId) return null
    return channelsStore.getChannelById(voiceStore.currentChannelId) as any
})

const connectedUsers = computed(() => voiceStore.getDisplayUsersArray())


function navigateToVoiceChannel() {
    if (voiceStore.currentChannelId && voiceStore.currentRoomId) {
        router.push(`/room/${voiceStore.currentRoomId}/${voiceStore.currentChannelId}`)
    }
}

function handleProfileClick(e: MouseEvent) {

    if (voiceStore.connected) {

        const avatarEl = document.querySelector('.avatar.select-none.relative .w-12.rounded-full');
        if (avatarEl && avatarEl.contains(e.target as Node)) {
            router.push('/settings');
            return;
        }

        navigateToVoiceChannel();
        return;
    }

    router.push('/settings');
}


const statsVisible = useState<boolean>('webrtc-stats-visible', () => false)


const lastRttMs = ref<number|null>(null)
const lastJitterMs = ref<number|null>(null)
const lastLoss = ref<number|null>(null)
const signalLevel = ref(0)
const outboundVideoStats = ref<any[]>([])
let signalTimer: any = null
let lowScreenFpsSamples = 0
const screenShareFpsLow = ref(false)
const SCREEN_FPS_WARNING_SAMPLES = 3


const elapsedText = ref('')
let elapsedTimer: any = null

function formatElapsed(ms: number) {
    if (ms <= 0 || !isFinite(ms)) return ''
    const totalSec = Math.floor(ms / 1000)
    const h = Math.floor(totalSec / 3600)
    const m = Math.floor((totalSec % 3600) / 60)
    const s = totalSec % 60
    const pad = (n: number) => n.toString().padStart(2, '0')
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

function startElapsedTimer() {
    if (elapsedTimer) return
    const tick = () => {
        if (voiceStore.connected && (voiceStore as any).connectedAt) {
            const ms = Date.now() - (voiceStore as any).connectedAt
            elapsedText.value = formatElapsed(ms)
        } else {
            elapsedText.value = ''
        }
    }
    tick()
    elapsedTimer = setInterval(tick, 1000)
}

watch(() => voiceStore.connected, (c) => {
    if (c) startElapsedTimer()
    else {
        if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null }
        elapsedText.value = ''
    }
}, { immediate: true })

function barClass(n: number) { return signalLevel.value >= n ? '' : 'opacity-25' }
const barColorClass = computed(() => {
    if (signalLevel.value >= 4) return 'bg-success'
    if (signalLevel.value === 3) return 'bg-success'
    if (signalLevel.value === 2) return 'bg-warning'
    if (signalLevel.value === 1) return 'bg-error'
    return 'bg-base-content/40'
})
const signalTooltip = computed(() => {
    const label = getConnectionQualityLabel(signalLevel.value)
    const parts: string[] = [label]
    if (lastRttMs.value != null) parts.push(`RTT ${Math.round(lastRttMs.value)} ms`)
    if (lastJitterMs.value != null) parts.push(`Jitter ${Math.round(lastJitterMs.value)} ms`)
    if (lastLoss.value != null) parts.push(`Loss ${(lastLoss.value*100).toFixed(1)}%`)
    return parts.join(' • ')
})

function formatVideoQuality(stat: any) {
    if (!stat?.width || !stat?.height) return ''
    const resolution = Math.min(stat.width, stat.height)
    const fps = stat.fps ? Math.round(stat.fps) : null
    return `${resolution}p${fps ? `@${fps}fps` : ''}`
}

function monitorScreenShareFps(stats: any[]) {
    const screen = stats.find((stat) => stat.source === 'screen')
    if (!voiceStore.screenSharing || !screen || !isScreenShareFpsBelowTarget(screen.fps, screen.targetFps)) {
        lowScreenFpsSamples = 0
        screenShareFpsLow.value = false
        return
    }
    lowScreenFpsSamples += 1
    screenShareFpsLow.value = lowScreenFpsSamples >= SCREEN_FPS_WARNING_SAMPLES
}

const outboundVideoLabels = computed(() => outboundVideoStats.value
    .map((stat) => ({
        source: stat.source,
        text: formatVideoQuality(stat)
    }))
    .filter((item) => item.text))

async function pollSignal() {
    try {

        const sfu: any = (voiceStore as any).sfuComposable
        if (!voiceStore.connected || !sfu || !sfu.getWebRTCStatsSnapshot) {
            signalLevel.value = 0
            outboundVideoStats.value = []
            lowScreenFpsSamples = 0
            screenShareFpsLow.value = false
            return
        }
        if (sfu.ensureAudioElements) sfu.ensureAudioElements()
        const snap = await sfu.getWebRTCStatsSnapshot()
        outboundVideoStats.value = sfu.getOutboundVideoStats ? await sfu.getOutboundVideoStats() : []
        monitorScreenShareFps(outboundVideoStats.value)
        const metrics = getRtcSignalMetrics(snap?.transports)
        if (!metrics.connected) {
            signalLevel.value = 1
            return
        }
        lastRttMs.value = metrics.rttMs
        lastJitterMs.value = metrics.jitterMs
        lastLoss.value = metrics.loss
        signalLevel.value = getConnectionQualityBars(metrics.rttMs)
    } catch {
        outboundVideoStats.value = []
        lowScreenFpsSamples = 0
        screenShareFpsLow.value = false
    }
}

onMounted(() => { signalTimer = setInterval(pollSignal, 1000); startElapsedTimer() })
onBeforeUnmount(() => { if (signalTimer) { clearInterval(signalTimer); signalTimer = null } })
</script>


<template>

    <section class="navbar w-full flex justify-between py-2 px-4 bg-accent-4 text-light fixed top-0 left-0 z-50" style="height: var(--navbar-height);">
        <div class="flex items-center gap-4">
            <NuxtLink to="/" class="">
                <img class="w-13 rounded-sm select-none pointer-events-none" src="/assets/logo/logo_96.png"/>
            </NuxtLink>

            <!-- Room Navigation -->
            <div v-if="profile" class="hidden md:flex">
                <RoomList :model-value="currentRoomId || undefined" />
            </div>
        </div>

        <section v-if="profile" class="flex items-center gap-4 ml-4">
            <!-- Settings Link intentionally removed to prevent redirect on voice channel error -->

            <!-- Smart Profile/Voice Control -->
            <div
                @click="handleProfileClick"
                class="flex items-center cursor-pointer group relative"
                :class="[
                    voiceStore.connected ? 'bg-success/20 border border-success/40 rounded-lg px-2 py-1' : '',
                    (!voiceStore.connected && (voiceStore.connecting || voiceStore.error)) ? 'bg-warning/20 border border-warning/40 rounded-lg px-2 py-1' : ''
                ]"
                :title="voiceStore.connected
                    ? `Connected to ${currentVoiceChannel?.name} • Click to go to voice channel`
                    : (voiceStore.connecting
                        ? 'Connecting…'
                        : (voiceStore.error && !voiceStore.connected ? 'Call dropped or unavailable' : 'Your Account'))"
            >
                <!-- Voice Controls (when connected) -->
                <div v-if="voiceStore.connected" class="flex items-center gap-2 mr-3">
                    <!-- Elapsed call time -->
                    <div class="text-sm text-base-content/70 select-none min-w-[3.5rem] text-right" v-if="elapsedText">
                        {{ elapsedText }}
                    </div>
                    <!-- Live RTT and Loss Warning -->
                    <div class="text-sm text-base-content/70 select-none">
                        <span v-if="lastRttMs != null">{{ Math.round(lastRttMs) }}ms</span>
                    </div>
                    <div
                        v-for="quality in outboundVideoLabels"
                        :key="quality.source"
                        class="text-sm text-base-content/70 select-none whitespace-nowrap"
                        :class="quality.source === 'screen' ? 'cursor-pointer hover:text-base-content' : ''"
                        :title="quality.source === 'screen' ? 'Open screen-share debug information' : 'Camera send quality'"
                        @click.stop="quality.source === 'screen' && (statsVisible = true)"
                    >
                        <span v-if="outboundVideoLabels.length > 1">{{ quality.source === 'screen' ? 'Share' : 'Cam' }} </span>{{ quality.text }}
                    </div>
                    <button
                        v-if="screenShareFpsLow"
                        class="btn btn-ghost btn-xs btn-circle text-warning animate-pulse"
                        title="Screen-share send FPS is below target — open debug information"
                        aria-label="Screen-share send FPS is below target"
                        @click.stop="statsVisible = true"
                    >
                        <Icon name="lucide:triangle-alert" class="size-4" />
                    </button>
                    <button
                        v-if="voiceStore.screenSharing"
                        class="btn btn-ghost btn-xs btn-circle"
                        title="View screen-share debug information"
                        @click.stop="statsVisible = true"
                    >
                        <Icon name="lucide:bug" class="size-4" />
                    </button>
                    <div v-if="lastLoss != null && lastLoss > 0.05" class="tooltip" data-tip="Packet loss {{ (lastLoss*100).toFixed(1) }}%">
                        <span class="w-3 h-3 rounded-full bg-warning animate-pulse inline-block"></span>
                    </div>
                    <!-- Signal Strength (click to open WebRTC Stats) -->
                    <button
                        class="btn btn-ghost btn-xs px-2 h-6 min-h-0"
                        :title="signalTooltip"
                        @click.stop="statsVisible = true"
                    >
                        <div class="flex items-end gap-0.5">
                            <span class="w-1.5 rounded-sm" :class="[barClass(1), barColorClass]" style="height:6px"></span>
                            <span class="w-1.5 rounded-sm" :class="[barClass(2), barColorClass]" style="height:9px"></span>
                            <span class="w-1.5 rounded-sm" :class="[barClass(3), barColorClass]" style="height:12px"></span>
                            <span class="w-1.5 rounded-sm" :class="[barClass(4), barColorClass]" style="height:15px"></span>
                            <span class="w-1.5 rounded-sm" :class="[barClass(5), barColorClass]" style="height:18px"></span>
                        </div>
                    </button>

                    <!-- Camera Control -->
                    <button
                        @click.stop="voiceStore.toggleCamera"
                        :class="['btn btn-circle btn-xs', voiceStore.cameraEnabled ? 'btn-primary' : 'btn-outline']"
                        :title="voiceStore.cameraEnabled ? 'Turn camera off' : 'Turn camera on'"
                    >
                        <Icon name="lucide:camera" class="size-4" />
                    </button>

                    <!-- Screen Share Control -->
                    <button
                        @click.stop="voiceStore.toggleScreenShare"
                        :class="['btn btn-circle btn-xs', voiceStore.screenSharing ? 'btn-primary' : 'btn-outline']"
                        :title="voiceStore.screenSharing ? 'Stop screen sharing' : 'Share screen'"
                    >
                        <Icon name="lucide:monitor-up" class="size-4" />
                    </button>

                    <button
                        @click.stop="voiceStore.toggleSystemAudioShare"
                        :class="['btn btn-circle btn-xs', voiceStore.systemAudioSharing ? 'btn-primary' : 'btn-outline']"
                        :title="voiceStore.systemAudioSharing ? 'Stop sharing system audio' : 'Share system audio only'"
                    >
                        <Icon name="lucide:audio-lines" class="size-4" />
                    </button>

                    <div
                        v-if="voiceStore.screenSharing || voiceStore.systemAudioSharing"
                        class="flex items-center gap-1"
                        title="Shared audio volume — what others hear"
                        @click.stop
                    >
                        <Icon name="lucide:volume-2" class="size-3" />
                        <input
                            class="range range-primary range-xs w-20"
                            type="range"
                            min="0"
                            max="100"
                            step="1"
                            :value="voiceStore.sharedAudioVolume"
                            @input="voiceStore.setSharedAudioVolume($event.target.value)"
                        />
                        <span class="w-8 text-right text-[10px] tabular-nums">{{ voiceStore.sharedAudioVolume }}%</span>
                        <progress
                            :class="['progress h-2 w-24', voiceStore.sharedAudioStats.dbfs >= -12 ? 'progress-error' : 'progress-success']"
                            max="1"
                            :value="voiceStore.sharedAudioStats.level"
                            :title="`${voiceStore.sharedAudioStats.dbfs.toFixed(1)} dBFS`"
                        ></progress>
                        <span class="w-12 text-right text-[10px] tabular-nums">{{ voiceStore.sharedAudioStats.kbps.toFixed(1) }}k</span>
                    </div>

                    <!-- Broadcast Mode Toggle -->
                    <button
                      @click.stop="toggleBroadcastMode"
                      :class="['btn btn-xs', broadcastMode ? 'btn-warning' : 'btn-outline']"
                      :title="broadcastMode ? 'Broadcast Mode ON: You only send audio' : 'Broadcast Mode OFF: You can hear others'"
                      v-if="voiceStore.connected"
                    >
                      <Icon name="lucide:radio" v-if="broadcastMode" class="size-5" />
                      <Icon name="lucide:radio" v-else class="size-5" />
                    </button>
                    <!-- Microphone Control -->
                    <button
                        @click.stop="voiceStore.toggleMic"
                        :disabled="!voiceStore.connected || (!!voiceStore.sfuComposable && !(voiceStore.sfuComposable as any)?.transportReady)"
                        :class="[
                            'btn btn-circle btn-xs',
                            voiceStore.micMuted ? 'btn-error' : 'btn-outline'
                        ]"
                        :title="voiceStore.micMuted ? 'Unmute Microphone' : 'Mute Microphone'"
                    >
                        <Icon name="lucide:mic" v-if="!voiceStore.micMuted" class="size-6 text-current" />

                        <Icon name="lucide:mic-off" v-else class="size-6 text-white" />
                    </button>

                    <!-- Deafen Control -->
                    <button
                        @click.stop="voiceStore.toggleDeafen"
                        :class="[
                            'btn btn-circle btn-xs',
                            voiceStore.deafened ? 'btn-error' : 'btn-outline btn-xs'
                        ]"
                        :title="voiceStore.deafened ? 'Undeafen' : 'Deafen'"
                    >
                        <Icon name="lucide:volume-2" v-if="!voiceStore.deafened" class="w-3 h-3" />
                        <Icon name="lucide:volume-x" v-else class="w-3 h-3" />
                    </button>

                    <!-- Disconnect Button -->
                    <button
                        @click.stop="voiceStore.leaveVoiceChannel"
                        class="btn btn-error btn-xs btn-circle"
                        title="Disconnect from voice"
                    >
                        <Icon name="lucide:x" class="w-3 h-3" />
                    </button>
                </div>

                <!-- Profile Info -->
                <div class="flex-col items-end pr-4 hidden md:flex">
                    <p class="text-xs font-bold group-hover:underline">
                        {{ voiceStore.connected ? currentVoiceChannel?.name || 'Voice Channel' : profile?.name }}
                    </p>
                    <p class="text-xs" :class="voiceStore.connected ? 'text-success' : 'text-accent-1'">
                        {{ voiceStore.connected ? `${connectedUsers.length} participant${connectedUsers.length !== 1 ? 's' : ''}` : profile?.email }}
                    </p>
                </div>

                <!-- Avatar with Voice Indicator -->
                <div class="avatar select-none relative" :class="avatarStatusClass">
                    <div
                        class="w-12 rounded-full transition-all duration-200"
                        :class="{
                          'ring-2 ring-success ring-offset-2 ring-offset-base-100': voiceStore.connected,
                          'ring-2 ring-warning ring-offset-2 ring-offset-base-100': !voiceStore.connected && (voiceStore.connecting || voiceStore.error),
                          'ring-2 ring-error ring-offset-2 ring-offset-base-100': voiceStore.error && !voiceStore.connected && !voiceStore.connecting
                        }"
                        @click.stop="router.push('/settings')"
                        style="cursor:pointer"
                    >
                        <img :src="profile?.avatar" alt="User avatar" />
                    </div>
                    <!-- Voice Connection Indicator -->
                    <div
                        v-if="voiceStore.connected"
                        class="absolute -bottom-1 -right-1 w-4 h-4 bg-success rounded-full flex items-center justify-center"
                    >
                        <Icon name="lucide:mic" class="w-2.5 h-2.5 text-white" />
                    </div>
                    <!-- Connecting / Dropped Indicator (Yellow) -->
                    <div v-else-if="!voiceStore.connected && (voiceStore.connecting || voiceStore.error)" class="absolute -bottom-1 -right-1 w-4 h-4 bg-warning rounded-full animate-pulse"></div>
                </div>
        <!-- Voice Error Modal -->
        <div v-if="voiceStore.error && !voiceStore.connected" class="modal modal-open">
            <div class="modal-box">
                <h3 class="font-bold text-lg mb-4 text-error">Call Failed</h3>
                <p class="text-base-content/70 mb-4">{{ voiceStore.error }}</p>
                <div class="modal-action">
                    <button class="btn btn-error" @click="voiceStore.error = null">Close</button>
                </div>
            </div>
            <div class="modal-backdrop" @click="voiceStore.error = null"></div>
        </div>
            </div>

            <div v-if="isDisconnected" class="ml-2 text-red-500 text-xs font-semibold">
                Connection lost.<br> Please refresh the page.
            </div>
        </section>
    </section>


</template>
