<template>
  <div class="h-full bg-base-200 flex flex-col">
    <!-- Header with back button -->
    <div class="p-4 border-b border-base-300">
      <div class="flex items-center gap-3">
        <button 
          @click="$emit('back')"
          class="btn btn-ghost btn-sm btn-circle"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h2 class="text-lg font-semibold">{{ room?.name || 'Server' }}</h2>
          <p class="text-sm text-base-content/60">{{ room?.members?.length || 0 }} members</p>
        </div>
      </div>
    </div>

    <!-- Channels List -->
    <div class="flex-1 overflow-y-auto p-4 space-y-4">
      <!-- Text Channels -->
      <div v-if="textChannels.length > 0">
        <h3 class="text-sm font-semibold text-base-content/70 uppercase tracking-wide mb-2 px-2">
          Text Channels
        </h3>
        <div class="space-y-1">
          <button
            v-for="channel in textChannels"
            :key="channel.id"
            @click="selectChannel(channel)"
            class="w-full flex items-center gap-3 p-3 rounded-lg transition-all duration-200"
            :class="[
              selectedChannelId === channel.id 
                ? 'bg-primary text-primary-content' 
                : 'hover:bg-base-300 text-base-content'
            ]"
          >
            <!-- Channel Icon -->
            <div class="flex-shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
              </svg>
            </div>

            <!-- Channel Info -->
            <div class="flex-1 text-left overflow-hidden">
              <div class="font-medium">{{ channel.name }}</div>
              <div 
                v-if="channel.desc" 
                class="text-sm opacity-70 truncate"
                :class="[
                  selectedChannelId === channel.id 
                    ? 'text-primary-content' 
                    : 'text-base-content'
                ]"
              >
                {{ channel.desc }}
              </div>
            </div>

            <!-- Unread indicator or online count -->
            <div class="flex-shrink-0">
              <div v-if="channel.inRoom?.length" class="badge badge-ghost badge-sm">
                {{ channel.inRoom.length }}
              </div>
            </div>
          </button>
        </div>
      </div>

      <!-- Voice Channels -->
      <div v-if="voiceChannels.length > 0">
        <h3 class="text-sm font-semibold text-base-content/70 uppercase tracking-wide mb-2 px-2">
          Voice Channels
        </h3>
        <div class="space-y-1">
          <button
            v-for="channel in voiceChannels"
            :key="channel.id"
            @click="selectChannel(channel)"
            class="w-full flex items-center gap-3 p-3 rounded-lg transition-all duration-200"
            :class="[
              selectedChannelId === channel.id 
                ? 'bg-primary text-primary-content' 
                : 'hover:bg-base-300 text-base-content'
            ]"
          >
            <!-- Channel Icon -->
            <div class="flex-shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </div>

            <!-- Channel Info -->
            <div class="flex-1 text-left overflow-hidden">
              <div class="font-medium">{{ channel.name }}</div>
              <div 
                v-if="channel.desc" 
                class="text-sm opacity-70 truncate"
                :class="[
                  selectedChannelId === channel.id 
                    ? 'text-primary-content' 
                    : 'text-base-content'
                ]"
              >
                {{ channel.desc }}
              </div>
            </div>

            <!-- Voice channel specific indicators -->
            <div class="flex-shrink-0">
              <div v-if="channel.inRoom?.length" class="badge badge-success badge-sm">
                {{ channel.inRoom.length }} 🔊
              </div>
            </div>
          </button>
        </div>
      </div>

      <!-- No Channels State -->
      <div v-if="textChannels.length === 0 && voiceChannels.length === 0" class="flex flex-col items-center justify-center h-64 text-center">
        <div class="text-base-content/50 mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
          </svg>
        </div>
        <h3 class="font-medium mb-2">No channels found</h3>
        <p class="text-sm text-base-content/60">This server doesn't have any channels yet</p>
      </div>

      <!-- Loading State -->
      <div v-if="loading" class="space-y-3">
        <div v-for="i in 4" :key="i" class="animate-pulse">
          <div class="flex items-center gap-3 p-3">
            <div class="w-5 h-5 bg-base-300 rounded"></div>
            <div class="flex-1">
              <div class="h-4 bg-base-300 rounded w-3/4 mb-1"></div>
              <div class="h-3 bg-base-300 rounded w-1/2"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useChannelsStore } from '../stores/channels'

const props = defineProps({
  room: Object,
  selectedChannelId: String,
  loading: Boolean
})

const emit = defineEmits(['channel-selected', 'back'])

const channelsStore = useChannelsStore()

const textChannels = computed(() => channelsStore.getTextChannels())
const voiceChannels = computed(() => channelsStore.getMediaChannels())

function selectChannel(channel) {
  emit('channel-selected', channel)
  if (props.room && channel && channel.id) {
    navigateTo(`/room/${props.room.id}/${channel.id}`)
  }
}
</script>
