<template>
  <div class="p-8">
    <h1 class="text-2xl font-bold mb-4">Room Settings</h1>
    <div v-if="room">
      <div class="mb-4">
        <label class="block font-semibold mb-1">Room Name</label>
        <input v-model="roomName" class="input input-bordered w-full" />
      </div>
      <div class="mb-4">
        <label class="block font-semibold mb-1">Description</label>
        <textarea v-model="roomDesc" class="textarea textarea-bordered w-full"></textarea>
      </div>
      <button class="btn btn-primary" @click="saveSettings">Save Changes</button>
    </div>
    <div v-else>
      <p>Loading room settings...</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useRoomsStore } from '~/stores/rooms'

const route = useRoute()
const router = useRouter()
const roomsStore = useRoomsStore()

const room = ref(null)
const roomName = ref('')
const roomDesc = ref('')

onMounted(async () => {
  const id = route.params.roomId
  room.value = await roomsStore.getRoomById(id)
  if (room.value) {
    roomName.value = room.value.name
    roomDesc.value = room.value.description || ''
  }
})

async function saveSettings() {
  if (!room.value) return
  await roomsStore.updateRoom(room.value.id, {
    name: roomName.value,
    description: roomDesc.value
  })
  router.push(`/room/${room.value.id}`)
}
</script>
