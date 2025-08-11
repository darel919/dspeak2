<template>
  <section class="min-h-screen bg-base-100">
    <div class="h-screen">
      <div class="h-full flex">
        <!-- Desktop Layout -->
        <div v-if="!isMobile" class="flex w-full">
          <!-- Channel List Sidebar -->
          <div class="w-64 border-r border-base-300">
            <ChannelList
              v-if="room"
              :room="room"
              :selected-channel-id="selectedChannelId"
              @channel-selected="onChannelSelected"
            />
          </div>
          
          <!-- Main Chat Area -->
          <div class="flex-1 flex flex-col">
            <ChatWindow
              v-if="selectedChannel && selectedChannel.id"
              :channel-id="selectedChannel.id"
              :channel="selectedChannel"
              :room="room"
              :show-back-button="false"
              class="flex-1"
            />
            <div v-else class="flex-1 flex items-center justify-center">
              <div class="text-center">
                <h3 class="text-lg font-semibold mb-2">Welcome to {{ room?.name }}</h3>
                <p class="text-base-content/60">Select a channel to start chatting</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Mobile Layout -->
        <div v-else class="w-full">
          <!-- Mobile: Full-screen chat when channel is selected -->
          <div v-if="selectedChannel && selectedChannel.id" class="h-full">
            <ChatWindow
              class="h-full"
              :channel-id="selectedChannel.id"
              :channel="selectedChannel"
              :room="room"
              :show-back-button="true"
              @back="onBackFromChat"
            />
          </div>

          <!-- Mobile: Show channel list when room is selected but no channel -->
          <div v-else class="h-full">
            <MobileChannelList
              :room="room"
              :selected-channel-id="selectedChannelId"
              :loading="channelsStore.loading"
              @channel-selected="onChannelSelected"
              @back="onBackToHome"
            />
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import { useRoomsStore } from '../../../stores/rooms'
import { useChannelsStore } from '../../../stores/channels'
import ChatWindow from '../../../components/Chat/ChatWindow.vue'
import ChannelList from '../../../components/ChannelList.vue'
import MobileChannelList from '../../../components/MobileChannelList.vue'

const roomsStore = useRoomsStore()
const channelsStore = useChannelsStore()
const route = useRoute()
const router = useRouter()

const roomId = computed(() => route.params.roomId)
const room = computed(() => roomsStore.rooms.find(r => r.id === roomId.value))
const selectedChannelId = ref(null)
const selectedChannel = computed(() => 
  channelsStore.getChannelById(selectedChannelId.value)
)

// Mobile detection
const isMobile = ref(false)
let resizeHandler = null
if (typeof window !== 'undefined') {
  const checkMobile = () => {
    isMobile.value = window.innerWidth < 768 // md breakpoint (768px)
  }
  resizeHandler = checkMobile
  checkMobile()
  window.addEventListener('resize', checkMobile)
}

// Cleanup event listener
onUnmounted(() => {
  if (typeof window !== 'undefined' && resizeHandler) {
    window.removeEventListener('resize', resizeHandler)
  }
})

function onChannelSelected(channel) {
  selectedChannelId.value = channel.id
  // Update URL to include channel (optional)
  // router.replace({ query: { channel: channel.id } })
}

function onBackFromChat() {
  if (isMobile.value) {
    selectedChannelId.value = null
    // This will show the channel list again
  }
}

function onBackToHome() {
  router.push('/')
}

watch(room, async (r) => {
  if (r && r.name) {
    document.title = `${r.name} - dSpeak`
    
    // Fetch channels for this room
    try {
      await channelsStore.fetchChannels(r.id)
      
      // Auto-select first text channel only on desktop
      if (!isMobile.value) {
        const textChannels = channelsStore.getTextChannels()
        if (textChannels.length > 0 && !selectedChannelId.value) {
          selectedChannelId.value = textChannels[0].id
        }
      }
    } catch (error) {
      console.error('Failed to fetch channels:', error)
    }
  } else {
    document.title = 'dSpeak'
  }
}, { immediate: true })

// Also watch for URL query parameter for channel selection
watch(() => route.query.channel, (channelId) => {
  if (channelId && channelId !== selectedChannelId.value) {
    selectedChannelId.value = channelId
  }
}, { immediate: true })
</script>
