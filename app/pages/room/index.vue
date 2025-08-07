<template>
  <section class="min-h-screen bg-base-100">
    <div class="flex h-screen">
      <!-- Sidebar - Room List -->
      <div 
        class="w-80 bg-base-200 border-r border-base-300 flex flex-col"
      >
        <!-- Sidebar Header -->
        <div class="mt-2 px-4 border-b border-base-300">
          <div class="flex items-center justify-between">
            <h1 class="font-hero text-xl">Rooms</h1>
            <button 
              class="btn btn-ghost btn-sm"
              @click="refreshRooms"
              :disabled="roomsStore.loading"
            >
              <svg 
                xmlns="http://www.w3.org/2000/svg" 
                class="h-4 w-4" 
                :class="{ 'animate-spin': roomsStore.loading }"
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>

        <!-- Room List -->
        <div class="flex-1 overflow-y-auto">
          <!-- Loading state -->
          <div v-if="roomsStore.loading" class="p-4">
            <div class="space-y-3">
              <div v-for="i in 3" :key="i" class="animate-pulse">
                <div class="flex items-center gap-3 p-3">
                  <div class="w-12 h-12 bg-base-300 rounded-full"></div>
                  <div class="flex-1">
                    <div class="h-4 bg-base-300 rounded w-3/4 mb-1"></div>
                    <div class="h-3 bg-base-300 rounded w-1/2"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Error state -->
          <div v-else-if="roomsStore.error" class="p-4">
            <div class="alert alert-error">
              <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h3 class="font-bold text-sm">Error</h3>
                <div class="text-xs">{{ roomsStore.error }}</div>
              </div>
            </div>
          </div>

          <!-- Empty state -->
          <div v-else-if="roomsStore.rooms.length === 0" class="p-4 text-center">
            <div class="text-base-content/50">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a2 2 0 01-2-2v-6a2 2 0 012-2h2m2-4h4a2 2 0 012 2v6a2 2 0 01-2 2h-4m0 0V8a2 2 0 00-2-2H9a2 2 0 00-2 2v8a2 2 0 002 2h4z" />
              </svg>
              <p class="text-sm">No rooms found</p>
            </div>
          </div>

          <!-- Room list -->
          <div v-else class="divide-y divide-base-300">
            <button
              v-for="room in roomsStore.rooms"
              :key="room.id"
              @click="navigateToRoom(room)"
              class="w-full p-4 hover:bg-base-300 transition-colors text-left"
              :class="{ 'bg-primary/10 border-r-2 border-primary': selectedRoomId === room.id }"
            >
              <div class="flex items-center gap-3">
                <!-- Room avatar/icon -->
                <div class="avatar placeholder">
                  <div class="bg-primary text-primary-content rounded-full w-12">
                    <span class="text-lg font-semibold">
                      {{ room.name.charAt(0).toUpperCase() }}
                    </span>
                  </div>
                </div>
                
                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between mb-1">
                    <h3 class="font-medium text-sm truncate">{{ room.name }}</h3>
                    <span class="text-xs text-base-content/50">
                      {{ formatTime(room.updated) }}
                    </span>
                  </div>
                  
                  <p class="text-xs text-base-content/60 truncate">
                    {{ room.desc || `${room.members.length} members` }}
                  </p>
                  
                  <!-- Unread indicator (placeholder) -->
                  <div class="flex items-center justify-between mt-1">
                    <div class="badge badge-ghost badge-xs">
                      {{ room.members.length }} members
                    </div>
                    <!-- <div class="badge badge-primary badge-xs">3</div> -->
                  </div>
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>

      <!-- Main Chat Area -->
      <div class="flex-1 flex flex-col">
        <!-- Welcome screen when no room selected -->
        <div 
          v-if="!selectedRoomId"
          class="flex-1 flex items-center justify-center bg-base-100"
        >
          <div class="text-center max-w-md">
            <div class="text-base-content/30 mb-6">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-24 w-24 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <h2 class="text-2xl font-semibold mb-2">Welcome to DSpeak Rooms</h2>
            <p class="text-base-content/60 mb-6">
              Select a room from the sidebar to start collaborating with your team.
            </p>
            <div class="text-sm text-base-content/50">
              <p>💬 Real-time messaging</p>
              <p>📱 Responsive design</p>
              <p>👥 Team collaboration</p>
            </div>
          </div>
        </div>

        <!-- Chat Window -->
        <ChatWindow
          v-if="selectedRoomId && selectedRoom"
          :room-id="selectedRoomId"
          :room="selectedRoom"
          :show-back-button="true"
          @back="deselectRoom"
          class="flex-1"
        />
      </div>
    </div>

    <!-- Chat Notifications -->
    <ChatNotifications ref="notifications" />
  </section>
</template>

<script setup>
import { useRoomsStore } from '../../stores/rooms'
import { useAuthStore } from '../../stores/auth'
import { useChatStore } from '../../stores/chat'
import ChatWindow from '../../components/Chat/ChatWindow.vue'
import ChatNotifications from '../../components/Chat/ChatNotifications.vue'
import { useRuntimeConfig } from '#app'

definePageMeta({
  layout: 'default'
})

const roomsStore = useRoomsStore()
const authStore = useAuthStore()
const chatStore = useChatStore()
const config = useRuntimeConfig()
const notifications = ref(null)
const route = useRoute()

const selectedRoomId = ref(null)

// Computed properties
const userData = computed(() => authStore.getUserData())
const selectedRoom = computed(() => {
  if (!selectedRoomId.value) return null
  return roomsStore.rooms.find(room => room.id === selectedRoomId.value)
})

// Watch for room selection and update document title
watch(selectedRoom, (room) => {
  if (room && room.name) {
    document.title = `${room.name} - dSpeak`
  } else {
    document.title = 'dSpeak'
  }
})

// Lifecycle
onMounted(async () => {
  if (roomsStore.rooms.length === 0) {
    await roomsStore.fetchRooms()
  }
  
  // Check if there's a roomId in the query params (from join link)
  const route = useRoute()
  const roomIdParam = route.query.roomId
  if (roomIdParam) {
    // Find the room and select it
    const room = roomsStore.rooms.find(r => r.id === roomIdParam)
    if (room) {
      selectRoom(room)
    }
  }
})

onUnmounted(() => {
  chatStore.clearChat()
})

// Methods
function navigateToRoom(room) {
  navigateTo(`/room/${room.id}`)
}

function selectRoom(room) {
  if (selectedRoomId.value === room.id) {
    return
  }
  selectedRoomId.value = room.id
}

function deselectRoom() {
  selectedRoomId.value = null
  chatStore.disconnectFromRoom()
  
  if (notifications.value) {
    notifications.value.addNotification('info', 'Left chat room', '', 2000)
  }
}

async function refreshRooms() {
  try {
    await roomsStore.fetchRooms()
    if (notifications.value) {
      notifications.value.addNotification('success', 'Rooms refreshed', '', 2000)
    }
  } catch (error) {
    if (notifications.value) {
      notifications.value.addNotification('error', 'Failed to refresh rooms', error.message)
    }
  }
}

function formatTime(dateString) {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now - date
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) {
    return 'now'
  } else if (diffMins < 60) {
    return `${diffMins}m`
  } else if (diffHours < 24) {
    return `${diffHours}h`
  } else if (diffDays < 7) {
    return `${diffDays}d`
  } else {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    })
  }
}

function getAvatarUrl(avatarPath) {
  if (!avatarPath) return '/favicon-32x32.png'
  
  if (avatarPath.startsWith('http')) return avatarPath
  
  const apiPath = config.public.apiPath
  return `${apiPath}/files/${avatarPath}`
}

// Handle back navigation on mobile
function handleBackKey(event) {
  if (event.key === 'Escape' && selectedRoomId.value) {
    deselectRoom()
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleBackKey)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleBackKey)
})

// Watch for connection status changes
watch(() => chatStore.connected, (isConnected, wasConnected) => {
  if (selectedRoomId.value && notifications.value) {
    if (!isConnected && wasConnected === true) {
      notifications.value.addNotification('warning', 'Disconnected from chat', 'Attempting to reconnect...', 5000)
    }
  }
})

// Watch for chat errors
watch(() => chatStore.error, (error) => {
  if (error && notifications.value) {
    notifications.value.addNotification('error', 'Chat Error', error)
  }
})
</script>
