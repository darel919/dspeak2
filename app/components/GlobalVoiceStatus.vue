<template>
  <Teleport to="body">
    <div 
      v-if="voiceStore.connected" 
      class="fixed bottom-4 left-4 z-50 bg-base-300 border border-base-content/20 rounded-lg shadow-lg p-3 min-w-[280px]"
    >
      <!-- Header -->
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2">
          <svg class="w-4 h-4 text-success" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clip-rule="evenodd" />
          </svg>
          <span class="text-sm font-medium">Voice Connected</span>
          <div class="w-2 h-2 bg-success rounded-full animate-pulse"></div>
        </div>
        
        <button
          @click="voiceStore.leaveVoiceChannel"
          class="btn btn-ghost btn-xs btn-circle"
          title="Disconnect"
        >
          <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
          </svg>
        </button>
      </div>

      <!-- Channel Info -->
      <div class="text-xs text-base-content/60 mb-3">
        {{ currentChannelName }} • {{ connectedUsers.length }} participant{{ connectedUsers.length !== 1 ? 's' : '' }}
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
          <svg v-if="user.muted" class="w-3 h-3 text-error" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M12.293 5.293a1 1 0 011.414 0l2 2a1 1 0 01-1.414 1.414L13 7.414V8a3 3 0 11-6 0v-3a1 1 0 012 0v3a1 1 0 002 0V5a1 1 0 01.293-.707zM11 14.93A7.001 7.001 0 017 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-5v-2.07z" clip-rule="evenodd" />
          </svg>
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
            voiceStore.micMuted ? 'btn-error' : 'btn-success'
          ]"
          :title="getMicButtonTitle()"
        >
          <svg v-if="!voiceStore.micMuted" class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clip-rule="evenodd" />
          </svg>
          <svg v-else class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M12.293 5.293a1 1 0 011.414 0l2 2a1 1 0 01-1.414 1.414L13 7.414V8a3 3 0 11-6 0v-3a1 1 0 012 0v3a1 1 0 002 0V5a1 1 0 01.293-.707zM11 14.93A7.001 7.001 0 717 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-5v-2.07z" clip-rule="evenodd" />
          </svg>
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
          <svg v-if="!voiceStore.deafened" class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clip-rule="evenodd" />
          </svg>
          <svg v-else class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019 10a1 1 0 10-2 0 8.1 8.1 0 01-1.879 5.131l-1.297-1.297a5.99 5.99 0 001.176-3.834 1 1 0 10-2 0 3.99 3.99 0 01-.849 2.205l-1.356-1.356a1.99 1.99 0 00-.205-.849V4a1 1 0 00-1.707-.707L4.586 7H2a1 1 0 00-1 1v4a1 1 0 001 1h2.586l.707.707L3.707 2.293z" clip-rule="evenodd" />
          </svg>
        </button>

        <!-- Settings/Options -->
        <button
          @click="navigateToVoiceChannel"
          class="btn btn-ghost btn-sm btn-circle"
          title="Go to voice channel"
        >
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-8.293l-3-3a1 1 0 00-1.414 1.414L10.586 9H7a1 1 0 100 2h3.586l-1.293 1.293a1 1 0 101.414 1.414l3-3a1 1 0 000-1.414z" clip-rule="evenodd" />
          </svg>
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

    <!-- Audio Elements Container -->
  <div id="voice-audio-container">
      <!-- Audio elements for remote users will be dynamically added here -->
    </div>
  </Teleport>
</template>

<script setup>
import { useVoiceStore } from '~/stores/voice'
import { useChannelsStore } from '~/stores/channels'

const voiceStore = useVoiceStore()
const channelsStore = useChannelsStore()
const router = useRouter()

const connectedUsers = computed(() => voiceStore.getConnectedUsersArray())

const currentChannelName = computed(() => {
  if (!voiceStore.currentChannelId) return 'Voice Channel'
  const channel = channelsStore.getChannelById(voiceStore.currentChannelId)
  return channel?.name || 'Voice Channel'
})

function getUserDisplayName(user) {
  return user.username || user.display_name || user.email || `User ${user.id}`
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
</script>
