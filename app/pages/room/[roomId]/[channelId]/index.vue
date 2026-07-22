<template>
  <section class="h-screen-minus-navbar overflow-hidden bg-base-100">
    <div class="h-full min-h-0 overflow-hidden">
      <div class="h-full flex">
        <!-- Desktop Layout -->
        <div v-show="!isMobile" class="flex min-h-0 w-full overflow-hidden">
          <!-- Channel List Sidebar -->
          <div class="w-64 border-base-300">
            <ChannelList
              v-if="room"
              :room="room"
              :selected-channel-id="selectedChannelId"
              @channel-selected="onChannelSelected"
            />
          </div>

          <!-- Main Content Area -->
          <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
            <!-- Voice Channel -->
            <div v-if="selectedChannel && selectedChannel.isMedia" class="min-h-0 flex-1 overflow-hidden p-4">
              <VoiceChannel
                :key="`voice-${selectedChannel.id}`"
                :channel="selectedChannel"
              />
            </div>
            <!-- Text Channel -->
            <ChatWindow
              v-else-if="selectedChannel && selectedChannel.id"
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
        <div v-show="isMobile" class="min-h-0 w-full overflow-hidden">
          <!-- Mobile: Full-screen content when channel is selected -->
          <div v-if="selectedChannel && selectedChannel.id" class="h-full">
            <!-- Voice Channel -->
            <VoiceChannel
              v-if="selectedChannel.isMedia"
              :key="`voice-mobile-${selectedChannel.id}`"
              :channel="selectedChannel"
              class="h-full p-4"
            />
            <!-- Text Channel -->
            <ChatWindow
              v-else
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
import { useRoomsStore } from '../../../../stores/rooms'
import { useChannelsStore } from '../../../../stores/channels'
import { useVoiceStore } from '../../../../stores/voice'
import ChatWindow from '../../../../components/Chat/ChatWindow.vue'
import ChannelList from '../../../../components/ChannelList.vue'
import MobileChannelList from '../../../../components/MobileChannelList.vue'
import VoiceChannel from '../../../../components/VoiceChannel.vue'
import { MOBILE_BREAKPOINT_PX } from '../../../../const/ui'

const roomsStore = useRoomsStore()
const channelsStore = useChannelsStore()
const voiceStore = useVoiceStore()
const route = useRoute()
const router = useRouter()

const roomId = computed(() => route.params.roomId)
const channelId = computed(() => route.params.channelId)
const room = computed(() => roomsStore.rooms.find(r => r.id === roomId.value))
const selectedChannelId = ref(channelId.value || null)
const selectedChannel = computed(() =>
  channelsStore.getChannelById(selectedChannelId.value)
)


const isMobile = ref(false)
let resizeHandler = null
let resizeTimeout = null

if (typeof window !== 'undefined') {
  const checkMobile = () => {

    if (resizeTimeout) {
      clearTimeout(resizeTimeout)
    }
    resizeTimeout = setTimeout(() => {
      const newIsMobile = window.innerWidth < MOBILE_BREAKPOINT_PX

      if (isMobile.value !== newIsMobile) {
        isMobile.value = newIsMobile
      }
    }, 150)
  }

  resizeHandler = checkMobile
  checkMobile()
  window.addEventListener('resize', checkMobile)
}


onUnmounted(() => {
  if (typeof window !== 'undefined' && resizeHandler) {
    window.removeEventListener('resize', resizeHandler)
  }

  if (resizeTimeout) {
    clearTimeout(resizeTimeout)
  }




  const chatStore = useChatStore()
  if (chatStore && chatStore.disconnectFromChannel) {
    chatStore.disconnectFromChannel(true)
  }
})

async function onChannelSelected(channel) {
  selectedChannelId.value = channel.id
  router.replace({
    name: 'room-roomId-channelId',
    params: { roomId: roomId.value, channelId: channel.id }
  })


  if (channel.isMedia) {
    try {
      await voiceStore.joinVoiceChannel(channel.id)
    } catch (error) {
      console.error('Failed to auto-join voice channel:', error)
    }
  }


}

function onBackFromChat() {
  if (isMobile.value) {
    selectedChannelId.value = null
    router.replace({ name: 'room-roomId', params: { roomId: roomId.value } })
  }
}

function onBackToHome() {
  router.push('/')
}

watch(room, async (r) => {
  if (r && r.name) {
    if (import.meta.client) {
      document.title = `${r.name} - dSpeak`
    }
    try {
      await channelsStore.fetchChannels(r.id)

      if (!selectedChannelId.value) {
        const currentIsMobile = typeof window !== 'undefined' ? window.innerWidth < MOBILE_BREAKPOINT_PX : false
        if (!currentIsMobile) {
          const textChannels = channelsStore.getTextChannels()
          if (textChannels.length > 0) {
            selectedChannelId.value = textChannels[0].id
            router.replace({
              name: 'room-roomId-channelId',
              params: { roomId: roomId.value, channelId: textChannels[0].id }
            })
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch channels:', error)
    }
  } else {
    if (import.meta.client) {
      document.title = 'dSpeak'
    }
  }
}, { immediate: true })

watch(() => route.params.channelId, async (newChannelId) => {
  if (newChannelId && newChannelId !== selectedChannelId.value) {
    selectedChannelId.value = newChannelId


    const channel = channelsStore.getChannelById(newChannelId)
    if (channel && channel.isMedia) {
      try {
        await voiceStore.joinVoiceChannel(channel.id)
      } catch (error) {
        console.error('Failed to auto-join voice channel via URL:', error)
      }
    }


  }
}, { immediate: true })
</script>
