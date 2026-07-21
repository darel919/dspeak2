<template>
  <div v-if="voiceStore.connected" class="flex items-center gap-2 px-3 py-1 bg-success/10 rounded-lg">
    <Icon name="lucide:mic" class="w-4 h-4 text-success" />
    <span class="text-sm text-success font-medium">Voice Connected</span>
    
    <div class="flex items-center gap-2 ml-2">
      <!-- Live participants preview -->
      <div class="flex items-center gap-2">
        <div class="flex items-center -space-x-1">
            <template v-for="(u, idx) in voiceStore.getDisplayUsersArray()" :key="u.id || idx">
              <div
                v-if="u"
                :class="[
                  'w-6 h-6 rounded-full overflow-hidden border-2 flex items-center justify-center text-xs',
                  (voiceStore.getDisplayUsersArray().some(x => x && x.speaking) ? (u.speaking ? 'ring-2 ring-success' : 'border-base-100') : (idx === 0 ? 'ring-2 ring-success' : 'border-base-100'))
                ]"
                :title="u.display_name || u.name || u.username || u.id"
              >
              <img v-if="u.avatar" :src="u.avatar" class="w-full h-full object-cover" />
              <span v-else class="select-none">{{ (u.display_name || u.name || u.username || u.id).split(' ').map(s => s[0]).join('').toUpperCase().slice(0,2) }}</span>
            </div>
          </template>
        </div>
        <span class="text-xs text-base-content/60">{{ voiceStore.getDisplayUsersArray().length }}</span>
      </div>

      <button
        @click="voiceStore.toggleMic"
        :class="[
          'btn btn-xs btn-circle',
          voiceStore.micMuted ? 'btn-error' : 'btn-outline'
        ]"
        :title="voiceStore.micMuted ? 'Unmute' : 'Mute'"
      >
        <Icon name="lucide:mic" v-if="!voiceStore.micMuted" class="w-3 h-3 text-current" />
  <Icon name="lucide:mic-off" v-else class="w-3 h-3 text-white" />
      </button>

      <button
        @click="voiceStore.leaveVoiceChannel"
        class="btn btn-xs btn-circle btn-error"
        title="Disconnect"
      >
        <Icon name="lucide:volume-x" class="w-3 h-3" />
      </button>
    </div>
  </div>
</template>

<script setup>
import { useVoiceStore } from '~/stores/voice'

const voiceStore = useVoiceStore()
</script>
