<template>
  <div class="voice-channel h-full flex flex-col bg-base-200">
    <!-- Header -->
    <div class="flex items-center justify-between p-4 border-b border-base-300">
      <div class="flex items-center gap-2">
        <svg class="w-5 h-5 text-success" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clip-rule="evenodd" />
        </svg>
        <h3 class="font-semibold">{{ channel.name }}</h3>
      </div>
      
      <div class="flex items-center gap-2">
        <div v-if="voiceStore.connecting" class="flex items-center gap-2 text-info">
          <span class="loading loading-spinner loading-sm"></span>
          <span class="text-sm">Connecting...</span>
        </div>
        
        <!-- <div v-else-if="voiceStore.connected" class="flex items-center gap-2 text-success">
          <div class="w-2 h-2 bg-success rounded-full animate-pulse"></div>
          <span class="text-sm font-medium">Connected</span>
        </div> -->
        
        <!-- <button
          v-if="voiceStore.connected"
          @click="leaveChannel"
          class="btn btn-sm btn-error"
        >
          Leave
        </button> -->
      </div>
    </div>

    <!-- Connection Error -->
    <div v-if="voiceStore.error" class="alert alert-error m-4">
      <svg class="w-6 h-6 stroke-current shrink-0" fill="none" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span>{{ voiceStore.error }}</span>
    </div>

    <!-- Connection Info Banner -->
    <div v-if="voiceStore.connected && voiceStore.currentChannelId !== props.channel.id" class="bg-info/10 border border-info/20 rounded-lg p-4 mb-4">
      <div class="flex items-center gap-3">
        <svg class="w-5 h-5 text-info" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" />
        </svg>
        <div class="flex-1">
          <p class="text-sm font-medium">You're connected to a different voice channel</p>
          <p class="text-xs text-base-content/60">{{ currentConnectedChannelName }}</p>
        </div>
        <div class="flex gap-2">
          <button
            @click="switchToThisChannel"
            class="btn btn-sm btn-info"
          >
            Switch Here
          </button>
          <button
            @click="navigateToCurrentChannel"
            class="btn btn-sm btn-outline"
          >
            Go Back
          </button>
        </div>
      </div>
    </div>

    <!-- Main Content Area - Participants View -->
    <div v-if="voiceStore.connected && voiceStore.currentChannelId === props.channel.id" class="flex-1 flex flex-col overflow-hidden">
      <!-- Participants Grid -->
      <div class="flex-1 p-6">
        <div v-if="connectedUsers.length > 0" class="h-full">
          <!-- Participants Grid Layout -->
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 h-full auto-rows-max">
            <div
              v-for="user in connectedUsers"
              :key="user.id"
              class="flex flex-col items-center justify-center p-6 bg-base-100 rounded-lg shadow-sm border border-base-300 min-h-[200px] relative transition-all duration-500"
              :class="user.speaking ? 'ring-2 ring-success' : ''"
              @contextmenu.prevent="openVolumeMenu(user)"
            >
              <!-- User Avatar -->
              <div class="avatar mb-4">
                <div
                  v-if="getUserAvatar(user)"
                  class="w-20 h-20 rounded-full overflow-hidden ring-2 transition-all duration-150"
                  :class="user.speaking ? 'ring-success ring-offset-2 ring-offset-base-100 shadow-[0_0_0_6px_rgba(34,197,94,0.15)]' : 'ring-base-300'"
                >
                  <img :src="getUserAvatar(user)" class="w-full h-full object-cover" alt="avatar"/>
                </div>
                <div
                  v-else
                  class="w-20 h-20 rounded-full bg-gradient-to-br from-primary to-secondary text-primary-content flex items-center justify-center text-2xl font-bold ring-2 transition-all duration-150"
                  :class="user.speaking ? 'ring-success ring-offset-2 ring-offset-base-100 shadow-[0_0_0_6px_rgba(34,197,94,0.15)]' : 'ring-base-300'"
                >
                  {{ getUserInitials(user) }}
                </div>
              </div>
              <!-- User Name -->
              <h4 class="text-lg font-semibold text-center mb-2">{{ getUserDisplayName(user) }}</h4>
              <!-- User Status -->
              <div class="flex items-center gap-2">
                <div v-if="user.speaking" class="flex items-center gap-1 text-success">
                  <div class="w-2 h-2 bg-success rounded-full animate-pulse"></div>
                  <!-- <span class="text-sm">Speaking</span> -->
                </div>
                <div v-if="user.muted" class="flex items-center gap-1 text-error">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
                  </svg>
                  <span class="text-sm">Muted</span>
                </div>
              </div>
              <!-- Volume Control Context Menu -->
              <div v-if="volumeMenuUser && volumeMenuUser.id === user.id" class="absolute top-2 right-2 bg-base-200 border border-base-300 rounded-lg shadow-lg p-3 z-50 w-48">
                <div class="text-xs font-semibold mb-2">User Volume</div>
                <input type="range" min="0" max="1" step="0.01" :value="voiceStore.getUserVolume(user.id)" @input="onVolumeChange(user.id, $event)" class="w-full" />
                <div class="flex justify-between text-xs mt-1">
                  <span>0%</span>
                  <span>100%</span>
                </div>
                <button class="btn btn-xs btn-outline w-full mt-2" @click="closeVolumeMenu">Close</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Empty state when no other users -->
        <div v-else class="h-full flex flex-col items-center justify-center">
          <svg class="w-24 h-24 text-base-content/40 mb-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          <h4 class="text-xl font-medium text-base-content/60 mb-2">You're alone in this voice channel</h4>
          <p class="text-base-content/40 text-center max-w-md">
            Others can join by clicking on this channel from the sidebar. Share the room invite to get more people in here!
          </p>
        </div>
      </div>
    </div>

    <!-- Voice Controls at Bottom (Discord-style) -->
    <div v-if="voiceStore.connected && voiceStore.currentChannelId === props.channel.id" class="border-t border-base-300 bg-base-300 p-4">
      <div class="flex items-center justify-center gap-4">
        <!-- Microphone Control -->
        <div class="flex flex-col items-center">
          <button
            @click="voiceStore.toggleMic"
            :disabled="!voiceStore.connected || (voiceStore.sfuComposable && !voiceStore.sfuComposable.transportReady)"
            :class="[
              'btn btn-circle btn-lg',
              voiceStore.micMuted ? 'btn-error' : 'btn-success'
            ]"
            :title="getButtonTitle()"
          >
            <svg v-if="!voiceStore.micMuted" class="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clip-rule="evenodd" />
            </svg>
            <svg v-else class="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M12.293 5.293a1 1 0 011.414 0l2 2a1 1 0 01-1.414 1.414L13 7.414V8a3 3 0 11-6 0v-3a1 1 0 012 0v3a1 1 0 002 0V5a1 1 0 01.293-.707zM11 14.93A7.001 7.001 0 017 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-5v-2.07z" clip-rule="evenodd" />
            </svg>
          </button>
          <!-- <span class="text-xs mt-1 text-center">
            {{ voiceStore.micMuted ? 'Muted' : 'Mic' }}
          </span> -->
        </div>

        <!-- Deafen Control -->
        <div class="flex flex-col items-center">
          <button
            @click="voiceStore.toggleDeafen"
            :class="[
              'btn btn-circle btn-lg',
              voiceStore.deafened ? 'btn-error' : 'btn-outline'
            ]"
            :title="voiceStore.deafened ? 'Undeafen' : 'Deafen'"
          >
            <svg v-if="!voiceStore.deafened" class="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clip-rule="evenodd" />
            </svg>
            <svg v-else class="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019 10a1 1 0 10-2 0 8.1 8.1 0 01-1.879 5.131l-1.297-1.297a5.99 5.99 0 001.176-3.834 1 1 0 10-2 0 3.99 3.99 0 01-.849 2.205l-1.356-1.356a1.99 1.99 0 00-.205-.849V4a1 1 0 00-1.707-.707L4.586 7H2a1 1 0 00-1 1v4a1 1 0 001 1h2.586l.707.707L3.707 2.293z" clip-rule="evenodd" />
            </svg>
          </button>
          <!-- <span class="text-xs mt-1 text-center">
            {{ voiceStore.deafened ? 'Deafened' : 'Audio' }}
          </span> -->
        </div>

        <!-- Connection Status -->
        <div class="flex flex-col items-center ml-4">
          <div class="flex items-center gap-2">
            <div v-if="!voiceStore.sfuComposable?.transportReady" class="flex items-center gap-1 text-warning">
              <span class="loading loading-spinner loading-xs"></span>
              <span class="text-xs">Setting up...</span>
            </div>
            <div v-else class="flex items-center gap-1 text-success">
              <div class="w-2 h-2 bg-success rounded-full"></div>
              <span class="text-xs">Connected</span>
            </div>
          </div>
          <span class="text-xs text-base-content/60">{{ connectedUsers.length }} participant{{ connectedUsers.length !== 1 ? 's' : '' }}</span>
        </div>
      </div>
    </div>

  <!-- Audio elements are managed in a global hidden container to persist across navigation -->

    <!-- Not Connected State -->
    <div v-if="!voiceStore.connected" class="flex-1 flex flex-col items-center justify-center py-12">
     <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-12 mb-4">
      <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 3.75v4.5m0-4.5h-4.5m4.5 0-6 6m3 12c-8.284 0-15-6.716-15-15V4.5A2.25 2.25 0 0 1 4.5 2.25h1.372c.516 0 .966.351 1.091.852l1.106 4.423c.11.44-.054.902-.417 1.173l-1.293.97a1.062 1.062 0 0 0-.38 1.21 12.035 12.035 0 0 0 7.143 7.143c.441.162.928-.004 1.21-.38l.97-1.293a1.125 1.125 0 0 1 1.173-.417l4.423 1.106c.5.125.852.575.852 1.091V19.5a2.25 2.25 0 0 1-2.25 2.25h-2.25Z" />
    </svg>

      <h4 class="text-xl font-medium text-base-content/60 mb-3">Connect to {{ props.channel.name }}</h4>
      <p class="text-base-content/40 text-center max-w-md mb-6">
        Click the button below to join this voice channel and start talking with others.
      </p>
      <button
        @click="joinThisChannel"
        :disabled="voiceStore.connecting"
        class="btn btn-success btn-lg"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
        </svg>

        <span v-if="voiceStore.connecting" class="loading loading-spinner loading-sm mr-2"></span>
        {{ voiceStore.connecting ? 'Connecting...' : 'Connect to ' + props.channel.name  }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { useVoiceStore } from '~/stores/voice'
import { useAuthStore } from '~/stores/auth'

const props = defineProps({
  channel: {
    type: Object,
    required: true
  }
})

const voiceStore = useVoiceStore()
const authStore = useAuthStore()
const channelsStore = useChannelsStore()
const router = useRouter()
const config = useRuntimeConfig()

const connectedUsers = computed(() => {
  const display = voiceStore.getDisplayUsersArray()
  // Also log available audio elements for comparison
  if (typeof window !== 'undefined') {
    const container = document.getElementById('webrtc-audio-global')
    if (container) {
      const audioElements = Array.from(container.querySelectorAll('audio')).map(el => ({
        id: el.id,
        dataUserId: el.getAttribute('data-user-id'),
        volume: el.volume
      }))
      // console.log('[VoiceChannel] Available audio elements:', audioElements)
    }
  }
  return display
})
const volumeMenuUser = ref(null)
function openVolumeMenu(user) {
  console.log('[VoiceChannel] Opening volume menu for user:', user)
  volumeMenuUser.value = user
}
function closeVolumeMenu() {
  volumeMenuUser.value = null
}
function onVolumeChange(userId, event) {
  console.log('[VoiceChannel] Volume change for user:', userId, 'value:', event.target.value)
  voiceStore.setUserVolume(userId, Number(event.target.value))
  
  // Also try to directly find and update any matching audio element
  // This is a workaround for mapping mismatches
  const container = document.getElementById('webrtc-audio-global')
  if (container) {
    const allAudio = container.querySelectorAll('audio')
    console.log('[VoiceChannel] Available audio elements during volume change:', 
      Array.from(allAudio).map(el => ({ id: el.id, dataUserId: el.getAttribute('data-user-id') })))
    
    // Try multiple strategies to find the right element
    let found = false
    allAudio.forEach(audio => {
      // Strategy 1: Direct ID match
      if (audio.id === `audio-${userId}`) {
        audio.volume = Number(event.target.value)
        console.log('[VoiceChannel] Updated volume via direct ID match')
        found = true
      }
      // Strategy 2: data-user-id match
      else if (audio.getAttribute('data-user-id') === userId) {
        audio.volume = Number(event.target.value)
        console.log('[VoiceChannel] Updated volume via data-user-id match')
        found = true
      }
    })
    
    if (!found) {
      console.log('[VoiceChannel] No audio element found for user', userId)
    }
  }
}

const currentConnectedChannelName = computed(() => {
  if (!voiceStore.currentChannelId) return ''
  const channel = channelsStore.getChannelById(voiceStore.currentChannelId)
  return channel?.name || 'Unknown Channel'
})

function getUserInitials(user) {
  const name = getUserDisplayName(user)
  return name.split(' ').map(word => word.charAt(0)).join('').toUpperCase().slice(0, 2)
}

function getUserDisplayName(user) {
  // Prefer mapped profile from the voice store directory
  const profile = (voiceStore.getUserProfile && user?.id) ? voiceStore.getUserProfile(user.id) : null
  const merged = { ...profile, ...user }
  return merged.display_name || merged.name || merged.username || merged.email || `User ${merged.id}`
}

function getUserAvatar(user) {
  const profile = (voiceStore.getUserProfile && user?.id) ? voiceStore.getUserProfile(user.id) : null
  const merged = { ...profile, ...user }
  const avatar = merged.avatar
  if (!avatar) return null
  // Absolute URLs pass through as-is
  if (typeof avatar === 'string' && /^(https?:)?\/\//i.test(avatar)) return avatar
  const base = (config?.public?.baseApiPath || '').replace(/\/$/, '')
  const clean = String(avatar).replace(/^\/+/, '')
  const path = clean.startsWith('auth/') ? clean : `auth/${clean}`
  return `${base}/${path}`
}

function getButtonTitle() {
  if (!voiceStore.connected) return 'Not connected'
  if (voiceStore.sfuComposable && !voiceStore.sfuComposable.transportReady) return 'Setting up connection...'
  return voiceStore.micMuted ? 'Unmute Microphone' : 'Mute Microphone'
}


async function joinThisChannel() {
  try {
    await voiceStore.joinVoiceChannel(props.channel.id)
    // Do not navigate away on error; error modal will show if needed
  } catch (error) {
    // Stay in the channel view, just show error
    console.error('Failed to join voice channel:', error)
  }
}


async function switchToThisChannel() {
  try {
    await voiceStore.joinVoiceChannel(props.channel.id)
    // Do not navigate away on error; error modal will show if needed
  } catch (error) {
    // Stay in the channel view, just show error
    console.error('Failed to switch voice channel:', error)
  }
}

function navigateToCurrentChannel() {
  if (voiceStore.currentChannelId && voiceStore.currentRoomId) {
    router.push(`/room/${voiceStore.currentRoomId}/${voiceStore.currentChannelId}`)
  }
}

async function leaveChannel() {
  try {
    await voiceStore.leaveVoiceChannel()
  } catch (error) {
    console.error('Failed to leave voice channel:', error)
  }
}

onUnmounted(() => {
  // Don't auto-disconnect when leaving voice channel view
  // Voice connection should persist globally
})
</script>

<style scoped>
.voice-channel {
  transition: all 0.2s ease;
}

.voice-channel:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.animate-pulse {
  animation: pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
</style>
