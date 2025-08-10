<template>
  <div class="min-h-screen flex items-center justify-center bg-base-100">
    <div class="max-w-md w-full mx-4">
      <div class="card bg-base-100 shadow-xl border border-base-200">
        <div class="card-body text-center">
          <!-- Loading state -->
          <div v-if="loading" class="space-y-4">
            <div class="loading loading-spinner loading-lg mx-auto"></div>
            <h2 class="card-title justify-center">{{ loadingMessage }}</h2>
            <p class="text-base-content/70">Please wait...</p>
          </div>

          <!-- Success state -->
          <div v-else-if="joinSuccess" class="space-y-4">
            <div class="text-success mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 class="card-title justify-center">Successfully Joined Room!</h2>
            <p class="text-base-content/70">
              You have been added to the room. You can now start chatting with other members.
            </p>
            <div class="card-actions justify-center mt-6">
              <button @click="goToRoom" class="btn btn-primary">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                Go to Room
              </button>
              <button @click="goToHome" class="btn btn-ghost">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                Home
              </button>
            </div>
          </div>

          <!-- Error state -->
          <div v-else-if="error" class="space-y-4">
            <div class="text-error mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h2 class="card-title justify-center text-error">Unable to Join Room</h2>
            <p class="text-base-content/70">{{ error }}</p>
            <div class="card-actions justify-center mt-6">
              <button @click="retryJoin" class="btn btn-primary">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Try Again
              </button>
              <button @click="goToHome" class="btn btn-ghost">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                Home
              </button>
            </div>
          </div>

          <!-- Invalid room ID state -->
          <div v-else-if="initialized && !loading && !joinSuccess && !error" class="space-y-4">
            <div class="text-warning mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h2 class="card-title justify-center">Invalid Join Link</h2>
            <p class="text-base-content/70">
              The room ID in this link is not valid. Please check the link and try again.
            </p>
            <div class="card-actions justify-center mt-6">
              <button @click="goToHome" class="btn btn-primary">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                Go to Home
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Toast Container for notifications -->
    <ToastContainer />
  </div>
</template>

<script setup>
import { useRoomsStore } from '../../stores/rooms'
import { useAuthStore } from '../../stores/auth'
import ToastContainer from '../../components/ToastContainer.vue'

const route = useRoute()
const router = useRouter()
const roomsStore = useRoomsStore()
const authStore = useAuthStore()

const roomId = computed(() => route.params.roomId)
const loading = ref(true) // Start with loading = true
const loadingMessage = ref('Initializing...')
const joinSuccess = ref(false)
const error = ref(null)
const initialized = ref(false) // Add initialization flag

onMounted(async () => {
  // First check if user is authenticated from localStorage
  await checkAuthentication()
  await attemptJoin()
  initialized.value = true
})

async function checkAuthentication() {
  console.log('[JoinRoom] Checking authentication...')
  const savedToken = localStorage.getItem('token')
  console.log('[JoinRoom] Saved token:', savedToken ? 'exists' : 'not found')
  
  if (savedToken) {
    console.log('[JoinRoom] Verifying token...')
    const isValid = await authStore.verifyToken(savedToken)
    console.log('[JoinRoom] Token validation result:', isValid)
    if (!isValid) {
      console.log('[JoinRoom] Token invalid, clearing auth')
      authStore.clearAuth()
    }
  }
}

async function attemptJoin() {
  console.log('[JoinRoom] Starting join attempt for roomId:', roomId.value)
  
  // Check if we have a valid room ID first
  if (!roomId.value || !roomId.value.trim()) {
    console.error('[JoinRoom] Invalid room ID:', roomId.value)
    error.value = 'Invalid room ID in the link'
    loading.value = false
    return
  }

  loading.value = true
  loadingMessage.value = 'Checking authentication...'
  error.value = null
  joinSuccess.value = false

  try {
    console.log('[JoinRoom] Checking user authentication...')
    const userData = authStore.getUserData()
    console.log('[JoinRoom] User data:', userData)
    
    if (!userData || !userData.id) {
      console.log('[JoinRoom] User not authenticated, redirecting to auth page')
      loadingMessage.value = 'Redirecting to login...'
      setTimeout(() => {
        router.push('/auth')
      }, 1500)
      return
    }

    console.log('[JoinRoom] User authenticated, attempting to join room...')
    loadingMessage.value = 'Joining room...'
    const result = await roomsStore.joinRoom(roomId.value)
    console.log('[JoinRoom] Join successful:', result)
    
    joinSuccess.value = true
    loadingMessage.value = ''
  } catch (err) {
    console.error('[JoinRoom] Join failed:', err)
    error.value = err.message || 'Failed to join room'
  } finally {
    loading.value = false
  }
}

function retryJoin() {
  attemptJoin()
}

function goToRoom() {
  if (roomId.value && roomId.value.trim()) {
    router.push(`/room/${roomId.value}`)
  } else {
    router.push('/room/')
  }
}

function goToHome() {
  router.push('/')
}

definePageMeta({
  layout: false
})
</script>
