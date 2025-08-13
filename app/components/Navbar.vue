
<script setup lang="ts">
import { useAuthStore } from '../stores/auth'
import { useVoiceStore } from '../stores/voice'
import { useChannelsStore } from '../stores/channels'
// import { useNotifications } from '../composables/useNotifications'
import RoomList from './RoomList.vue'
// import NotificationSettings from './NotificationSettings.vue'

const authStore = useAuthStore();
const voiceStore = useVoiceStore();
const channelsStore = useChannelsStore();
const profile = computed(() => authStore.getUserData());
const route = useRoute();
const router = useRouter();

const currentRoomId = computed(() => {
    if (route.path.startsWith('/room/')) {
        return route.params.roomId as string;
    }
    return null;
});

// useNotifications();

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

// Voice-related computeds
const currentVoiceChannel = computed(() => {
    if (!voiceStore.currentChannelId) return null
    return channelsStore.getChannelById(voiceStore.currentChannelId) as any
})

const connectedUsers = computed(() => voiceStore.getDisplayUsersArray())

// Voice control functions
function navigateToVoiceChannel() {
    if (voiceStore.currentChannelId && voiceStore.currentRoomId) {
        router.push(`/room/${voiceStore.currentRoomId}/${voiceStore.currentChannelId}`)
    }
}

function handleProfileClick(e: MouseEvent) {
    // If connected, distinguish between avatar and background click
    if (voiceStore.connected) {
        // Find if click was inside avatar
        const avatarEl = document.querySelector('.avatar.select-none.relative .w-12.rounded-full');
        if (avatarEl && avatarEl.contains(e.target as Node)) {
            router.push('/settings');
            return;
        }
        // Otherwise, treat as background click
        navigateToVoiceChannel();
        return;
    }
    // Not connected: always go to settings
    router.push('/settings');
}

// Shared state to toggle the WebRTC stats panel
const statsVisible = useState<boolean>('webrtc-stats-visible', () => false)

// Signal strength polling for the top-right voice bubble
const lastRttMs = ref<number|null>(null)
const lastJitterMs = ref<number|null>(null)
const lastLoss = ref<number|null>(null)
const signalLevel = ref(0) // 0-4
let signalTimer: any = null

// Elapsed call time near the signal/ping
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
    const label = signalLevel.value >= 4 ? 'Excellent' : signalLevel.value === 3 ? 'Good' : signalLevel.value === 2 ? 'Fair' : 'Poor'
    const parts: string[] = [label]
    if (lastRttMs.value != null) parts.push(`RTT ${Math.round(lastRttMs.value)} ms`)
    if (lastJitterMs.value != null) parts.push(`Jitter ${Math.round(lastJitterMs.value)} ms`)
    if (lastLoss.value != null) parts.push(`Loss ${(lastLoss.value*100).toFixed(1)}%`)
    return parts.join(' • ')
})

async function pollSignal() {
    try {
        // @ts-ignore - sfuComposable is a runtime prop
        const sfu: any = (voiceStore as any).sfuComposable
        if (!voiceStore.connected || !sfu || !sfu.getWebRTCStatsSnapshot) {
            signalLevel.value = 0
            return
        }
        if (sfu.ensureAudioElements) sfu.ensureAudioElements()
        const snap = await sfu.getWebRTCStatsSnapshot()
        const t = snap?.transports?.find((x: any) => x.kind === 'send') || snap?.transports?.[0]
        if (!t || t.pcStates.iceConnectionState !== 'connected') { signalLevel.value = 1; return }
        const rtt = t.candidatePair?.currentRoundTripTime
        const jitter = t.inboundAudio?.jitter
        const loss = t.remoteInboundAudio?.fractionLost
        lastRttMs.value = rtt != null ? (rtt < 10 ? rtt * 1000 : rtt) : null
        lastJitterMs.value = jitter != null ? jitter * 1000 : null
        lastLoss.value = loss != null ? loss : null
        let score = 4
        if (lastRttMs.value != null) { if (lastRttMs.value > 400) score -= 2; else if (lastRttMs.value > 150) score -= 1 }
        if (lastJitterMs.value != null) { if (lastJitterMs.value > 30) score -= 2; else if (lastJitterMs.value > 15) score -= 1 }
        if (lastLoss.value != null) { if (lastLoss.value > 0.05) score -= 2; else if (lastLoss.value > 0.01) score -= 1 }
        if (score < 1) score = 1
        signalLevel.value = score
    } catch {
        // ignore transient errors
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
                    voiceStore.error && !voiceStore.connected ? 'bg-error/20 border border-error/40 rounded-lg px-2 py-1' : ''
                ]"
                :title="voiceStore.connected ? `Connected to ${currentVoiceChannel?.name} • Click to go to voice channel` : (voiceStore.error && !voiceStore.connected ? 'Unable to make call' : 'Your Account')"
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
                        </div>
                    </button>
                                        
                    <!-- Microphone Control -->
                    <button
                        @click.stop="voiceStore.toggleMic"
                        :disabled="!voiceStore.connected || (!!voiceStore.sfuComposable && !(voiceStore.sfuComposable as any)?.transportReady)"
                        :class="[
                            'btn btn-circle btn-xs',
                            voiceStore.micMuted ? 'btn-error' : 'btn-success'
                        ]"
                        :title="voiceStore.micMuted ? 'Unmute Microphone' : 'Mute Microphone'"
                    >
                        <svg v-if="!voiceStore.micMuted" xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
                        </svg>   

                        <svg v-else xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
                        </svg>

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
                        <svg v-if="!voiceStore.deafened" class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path fill-rule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clip-rule="evenodd" />
                        </svg>
                        <svg v-else class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path fill-rule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019 10a1 1 0 10-2 0 8.1 8.1 0 01-1.879 5.131l-1.297-1.297a5.99 5.99 0 001.176-3.834 1 1 0 10-2 0 3.99 3.99 0 01-.849 2.205l-1.356-1.356a1.99 1.99 0 00-.205-.849V4a1 1 0 00-1.707-.707L4.586 7H2a1 1 0 00-1 1v4a1 1 0 001 1h2.586l.707.707L3.707 2.293z" clip-rule="evenodd" />
                        </svg>
                    </button>

                    <!-- Disconnect Button -->
                    <button
                        @click.stop="voiceStore.leaveVoiceChannel"
                        class="btn btn-error btn-xs btn-circle"
                        title="Disconnect from voice"
                    >
                        <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                        </svg>
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
                          'ring-2 ring-error ring-offset-2 ring-offset-base-100': voiceStore.error && !voiceStore.connected
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
                        <svg class="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fill-rule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 0 1 7 15a1 1 0 0 0-2 0 7.001 7.001 0 0 0 6 6.93V17H6a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2.07z" clip-rule="evenodd" />
                        </svg>
                    </div>
                    <!-- Error Indicator -->
                    <div 
                        v-if="voiceStore.error && !voiceStore.connected" 
                        class="absolute -bottom-1 -right-1 w-4 h-4 bg-error rounded-full flex items-center justify-center animate-pulse"
                    >
                        <svg class="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-8.293l-3-3a1 1 0 00-1.414 1.414L10.586 9H7a1 1 0 100 2h3.586l-1.293 1.293a1 1 0 101.414 1.414l3-3a1 1 0 000-1.414z" clip-rule="evenodd" />
                        </svg>
                    </div>
                    <!-- Connection Status Pulse -->
                    <div 
                        v-if="voiceStore.connected && !(voiceStore.sfuComposable as any)?.transportReady" 
                        class="absolute -bottom-1 -right-1 w-4 h-4 bg-warning rounded-full animate-pulse"
                    >
                    </div>
                </div>
        <!-- Voice Error Modal -->
        <div v-if="voiceStore.error && !voiceStore.connected" class="modal modal-open">
            <div class="modal-box">
                <h3 class="font-bold text-lg mb-4 text-error">Unable to make call</h3>
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
