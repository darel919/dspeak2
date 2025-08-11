<template>
  <div class="min-h-screen-minus-navbar flex items-center justify-center bg-base-100">
    <div class="max-w-md w-full mx-4">
      <div class="card bg-base-100 shadow-xl border border-base-200">
        <div class="card-body">
          <h2 class="card-title mb-4">Join a Room</h2>
          <form @submit.prevent="onSubmit">
            <div class="form-control mb-4">
              <label class="label">
                <span class="label-text">Room ID</span>
              </label>
              <input v-model="roomId" class="input input-bordered" required placeholder="Enter Room ID" />
            </div>
            <div class="form-control mt-6">
              <button class="btn btn-primary w-full" :disabled="loading">
                <span v-if="loading" class="loading loading-spinner loading-xs mr-2"></span>
                Join Room
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
import { ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const roomId = ref('')
const loading = ref(false)
const error = ref(null)

async function onSubmit() {
  error.value = null
  if (!roomId.value.trim()) {
    error.value = 'Room ID is required.'
    return
  }
  loading.value = true
  try {
    // Navigate to join/[roomId] page to handle join logic
    await router.push(`/join/${roomId.value}`)
  } catch (e) {
    error.value = 'Failed to navigate.'
  } finally {
    loading.value = false
  }
}
</script>
