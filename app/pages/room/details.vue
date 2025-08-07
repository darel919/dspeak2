<template>
  <div class="min-h-screen container p-8">
    <h1 class="text-2xl font-bold mb-6">Room Details</h1>
    <div v-if="room">
      <div class="mb-4">
        <h2 class="text-lg font-semibold">Room: {{ room.name }}</h2>
        <p class="text-base-content/70">ID: {{ room.id }}</p>
      </div>
      <div class="mb-6">
        <h3 class="text-md font-semibold mb-2">Members</h3>
        <ul class="list-disc pl-6">
          <li v-for="member in room.members" :key="member.id">
            <span>{{ member.name }}</span>
            <span v-if="room.owner && member.id === room.owner.id" class="ml-2 text-xs text-primary">(Owner)</span>
          </li>
        </ul>
      </div>
      <div v-if="isOwner" class="mt-8">
        <button class="btn btn-error" @click="deleteRoom" :disabled="deleting">
          {{ deleting ? 'Deleting...' : 'Delete Room' }}
        </button>
      </div>
    </div>
    <div v-else>
      <p>Loading room details...</p>
    </div>
  </div>
</template>

<script setup>
import { useRoomsStore } from '../../stores/rooms'
import { useAuthStore } from '../../stores/auth'
import { useToast } from '../../composables/useToast'

const route = useRoute()
const router = useRouter()
const roomsStore = useRoomsStore()
const authStore = useAuthStore()
const { success, error } = useToast()

const room = ref(null)
const deleting = ref(false)

const isOwner = computed(() => {
  if (!room.value || !room.value.owner || !authStore.getUserData()) return false
  return room.value.owner.id === authStore.getUserData().id
})

async function fetchRoomDetails() {
  const roomId = route.query.roomId
  if (!roomId) return
  room.value = await roomsStore.getRoomDetails(roomId)
}

async function deleteRoom() {
  if (!room.value) return
  deleting.value = true
  try {
    await roomsStore.deleteRoom(room.value.id)
    success('Room deleted successfully')
    router.push('/')
  } catch (err) {
    error('Failed to delete room')
  } finally {
    deleting.value = false
  }
}

onMounted(fetchRoomDetails)
</script>
