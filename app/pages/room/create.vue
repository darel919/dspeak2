<template>
  <div class="min-h-screen-minus-navbar flex items-center justify-center bg-base-100">
    <div class="max-w-md w-full mx-4">
      <div class="card bg-base-100 shadow-xl border border-base-200">
        <div class="card-body">
          <h2 class="card-title mb-4">Create a Room</h2>
          <form @submit.prevent="onSubmit">
            <div class="form-control mb-4">
              <label class="label">
                <span class="label-text">Room Name</span>
              </label>
              <input v-model="roomName" class="input input-bordered" required placeholder="Enter Room Name" />
            </div>
            <div class="form-control mb-4">
              <label class="label">
                <span class="label-text">Description (optional)</span>
              </label>
              <input v-model="roomDesc" class="input input-bordered" placeholder="Room Description" />
            </div>
            <div class="form-control mt-6">
              <button class="btn btn-primary w-full" :disabled="loading">
                <span v-if="loading" class="loading loading-spinner loading-xs mr-2"></span>
                Create Room
              </button>
            </div>
            <div v-if="error" class="mt-4 text-error text-sm text-center">{{ error }}</div>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { useRoomsStore } from '../../stores/rooms'

const router = useRouter()
const roomsStore = useRoomsStore()
const roomName = ref('')
const roomDesc = ref('')
const loading = ref(false)
const error = ref(null)

async function onSubmit() {
  error.value = null
  if (!roomName.value.trim()) {
    error.value = 'Room name is required.'
    return
  }
  loading.value = true
  try {
    const newRoom = await roomsStore.createRoom({ name: roomName.value, desc: roomDesc.value })
    if (newRoom && newRoom.id) {
      await router.push(`/room/${newRoom.id}`)
    } else {
      error.value = 'Failed to create room.'
    }
  } catch (e) {
    error.value = e.message || 'Failed to create room.'
  } finally {
    loading.value = false
  }
}
</script>
