<template>
  <section class="min-h-screen-minus-navbar bg-base-100">
    <!-- Mobile: Show channel list -->
    <div v-if="isMobile" class="h-screen-minus-navbar">
      <MobileChannelList
        v-if="room"
        :room="room"
        :selected-channel-id="null"
        :loading="channelsStore.loading"
        @channel-selected="onChannelSelected"
        @back="onBackToHome"
      />
    </div>
    
    <!-- Desktop: Will redirect to first channel -->
    <div v-else />
  </section>
</template>

<script setup>
import { useRoomsStore } from '../../../stores/rooms'
import { useChannelsStore } from '../../../stores/channels'
import MobileChannelList from '../../../components/MobileChannelList.vue'

const roomsStore = useRoomsStore()
const channelsStore = useChannelsStore()
const route = useRoute()
const router = useRouter()

const roomId = computed(() => route.params.roomId)
const room = computed(() => roomsStore.rooms.find(r => r.id === roomId.value))

// Mobile detection
const isMobile = ref(false)
let resizeHandler = null

onMounted(() => {
  if (typeof window !== 'undefined') {
    const checkMobile = () => {
      isMobile.value = window.innerWidth < 768 // md breakpoint (768px)
    }
    resizeHandler = checkMobile
    checkMobile()
    window.addEventListener('resize', checkMobile)
  }
})

onUnmounted(() => {
  if (typeof window !== 'undefined' && resizeHandler) {
    window.removeEventListener('resize', resizeHandler)
  }
})

function onChannelSelected(channel) {
  router.push({
    name: 'room-roomId-channelId',
    params: { roomId: roomId.value, channelId: channel.id }
  })
}

function onBackToHome() {
  router.push('/')
}

watchEffect(async () => {
  if (room.value) {
    await channelsStore.fetchChannels(room.value.id)
    const textChannels = channelsStore.getTextChannels()
    // Only redirect to first channel if not on mobile (>= 768px)
    if (textChannels.length > 0 && !isMobile.value) {
      router.replace({ name: 'room-roomId-channelId', params: { roomId: roomId.value, channelId: textChannels[0].id } })
    }
  }
})
</script>
