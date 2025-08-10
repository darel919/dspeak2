<template>
  <section class="min-h-screen bg-base-100">
    <div class="flex h-screen">
      <RoomList
        :model-value="roomId"
        @update:modelValue="onRoomChange"
      />
      <!-- Main Chat Area -->
      <div class="flex-1 flex flex-col">
        <ChatWindow
          v-if="room && room.id"
          :room-id="room.id"
          :room="room"
          :show-back-button="true"
          @back="goBack"
          class="flex-1"
        />
      </div>
    </div>
  </section>
</template>

<script setup>
import { useRoomsStore } from '../../../stores/rooms'
import ChatWindow from '../../../components/Chat/ChatWindow.vue'
import RoomList from '../../../components/RoomList.vue'

const roomsStore = useRoomsStore()
const route = useRoute()
const router = useRouter()

const roomId = computed(() => route.params.roomId)
const room = computed(() => roomsStore.rooms.find(r => r.id === roomId.value))

function onRoomChange(id) {
  if (roomId.value !== id) {
    router.push(`/room/${id}`)
  }
}
// Removed: handled by modal events now

watch(room, (r) => {
  if (r && r.name) {
    document.title = `${r.name} - dSpeak`
  } else {
    document.title = 'dSpeak'
  }
})

function goBack() {
  router.push('/')
}
</script>
