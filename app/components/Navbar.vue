
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

const connectedUsers = computed(() => voiceStore.getConnectedUsersArray())

// Voice control functions
function navigateToVoiceChannel() {
    if (voiceStore.currentChannelId && voiceStore.currentRoomId) {
        router.push(`/room/${voiceStore.currentRoomId}/${voiceStore.currentChannelId}`)
    }
}

function handleProfileClick() {
    if (voiceStore.connected) {
        navigateToVoiceChannel()
    } else {
        router.push('/settings')
    }
}
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
            <!-- Settings Link -->
            <!-- <NuxtLink to="/settings" class="btn btn-ghost btn-sm" title="Settings">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12a7.5 7.5 0 0 0 15 0m-15 0a7.5 7.5 0 1 1 15 0m-15 0H3m16.5 0H21m-1.5 0H12m-8.457 3.077 1.41-.513m14.095-5.13 1.41-.513M5.106 17.785l1.15-.964m11.49-9.642 1.149-.964M7.501 19.795l.75-1.3m7.5-12.99.75-1.3m-6.063 16.658.26-1.477m2.605-14.772.26-1.477m0 17.726-.26-1.477M10.698 4.614l-.26-1.477M16.5 19.794l-.75-1.299M7.5 4.205 12 12m6.894 5.785-1.149-.964M6.256 7.178l-1.15-.964m15.352 8.864-1.41-.513M4.954 9.435l-1.41-.514M12.002 12l-3.75 6.495" />
                </svg>
            </NuxtLink> -->

            <!-- Smart Profile/Voice Control -->
            <div 
                @click="handleProfileClick"
                class="flex items-center cursor-pointer group relative"
                :class="{ 'bg-success/20 border border-success/40 rounded-lg px-2 py-1': voiceStore.connected }"
                :title="voiceStore.connected ? `Connected to ${currentVoiceChannel?.name} • Click to go to voice channel` : 'Your Account'"
            >
                <!-- Voice Controls (when connected) -->
                <div v-if="voiceStore.connected" class="flex items-center gap-2 mr-3">
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
                        <svg v-if="!voiceStore.micMuted" class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path fill-rule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 0 1 7 15a1 1 0 0 0-2 0 7.001 7.001 0 0 0 6 6.93V17H6a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2.07z" clip-rule="evenodd" />
                        </svg>
                        <svg v-else class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path fill-rule="evenodd" d="M12.293 5.293a1 1 0 011.414 0l2 2a1 1 0 01-1.414 1.414L13 7.414V8a3 3 0 11-6 0v-3a1 1 0 012 0v3a1 1 0 002 0V5a1 1 0 01.293-.707zM11 14.93A7.001 7.001 0 717 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-5v-2.07z" clip-rule="evenodd" />
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
                        :class="{ 'ring-2 ring-success ring-offset-2 ring-offset-base-100': voiceStore.connected }"
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
                    
                    <!-- Connection Status Pulse -->
                    <div 
                        v-if="voiceStore.connected && !(voiceStore.sfuComposable as any)?.transportReady" 
                        class="absolute -bottom-1 -right-1 w-4 h-4 bg-warning rounded-full animate-pulse"
                    >
                    </div>
                </div>
            </div>

            <div v-if="isDisconnected" class="ml-2 text-red-500 text-xs font-semibold">
                Connection lost. Please refresh the page.
            </div>
        </section>
    </section>
   

</template>
