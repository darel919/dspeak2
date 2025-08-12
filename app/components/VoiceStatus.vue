<template>
  <div v-if="voiceStore.connected" class="flex items-center gap-2 px-3 py-1 bg-success/10 rounded-lg">
    <svg class="w-4 h-4 text-success" fill="currentColor" viewBox="0 0 20 20">
      <path fill-rule="evenodd" d="M7 4a3 3 0 0 1 6 0v4a3 3 0 1 1-6 0V4zm4 10.93A7.001 7.001 0 0 0 17 8a1 1 0 1 0-2 0A5 5 0 0 1 5 8a1 1 0 0 0-2 0 7.001 7.001 0 0 0 6 6.93V17H6a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2.07z" clip-rule="evenodd" />
    </svg>
    <span class="text-sm text-success font-medium">Voice Connected</span>
    
    <div class="flex items-center gap-1 ml-2">
      <button
        @click="voiceStore.toggleMic"
        :class="[
          'btn btn-xs btn-circle',
          voiceStore.micMuted ? 'btn-error' : 'btn-success'
        ]"
        :title="voiceStore.micMuted ? 'Unmute' : 'Mute'"
      >
        <svg v-if="!voiceStore.micMuted" class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M7 4a3 3 0 0 1 6 0v4a3 3 0 1 1-6 0V4zm4 10.93A7.001 7.001 0 0 0 17 8a1 1 0 1 0-2 0A5 5 0 0 1 5 8a1 1 0 0 0-2 0 7.001 7.001 0 0 0 6 6.93V17H6a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2.07z" clip-rule="evenodd" />
        </svg>
        <svg v-else class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M12.293 5.293a1 1 0 0 1 1.414 0l2 2a1 1 0 0 1-1.414 1.414L13 7.414V8a3 3 0 1 1-6 0v-3a1 1 0 0 1 2 0v3a1 1 0 0 0 2 0V5a1 1 0 0 1 .293-.707zM11 14.93A7.001 7.001 0 0 1 5 8a1 1 0 0 0-2 0 7.001 7.001 0 0 0 6 6.93V17H6a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-5v-2.07z" clip-rule="evenodd" />
        </svg>
      </button>

      <button
        @click="voiceStore.leaveVoiceChannel"
        class="btn btn-xs btn-circle btn-error"
        title="Disconnect"
      >
        <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M3.707 2.293a1 1 0 0 0-1.414 1.414l14 14a1 1 0 0 0 1.414-1.414l-1.473-1.473A10.014 10.014 0 0 0 19 10a1 1 0 1 0-2 0 8.1 8.1 0 0 1-1.879 5.131l-1.297-1.297a5.99 5.99 0 0 0 1.176-3.834 1 1 0 1 0-2 0 3.99 3.99 0 0 1-.849 2.205l-1.356-1.356a1.99 1.99 0 0 0-.205-.849V4a1 1 0 0 0-1.707-.707L4.586 7H2a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h2.586l.707.707L3.707 2.293z" clip-rule="evenodd" />
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup>
import { useVoiceStore } from '~/stores/voice'

const voiceStore = useVoiceStore()
</script>
