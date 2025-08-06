<template>
  <section class="min-h-screen bg-base-100">
    <div class="flex h-screen">
      <!-- Sidebar - Room List -->
      <div class="w-80 bg-base-200 border-r border-base-300 flex flex-col">
        <div class="p-4 border-b border-base-300">
          <div class="flex items-center justify-between mb-4">
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
        <div class="flex-1 overflow-y-auto">
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
          <div v-else-if="roomsStore.rooms.length === 0" class="p-4 text-center">
            <div class="text-base-content/50">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a2 2 0 01-2-2v-6a2 2 0 012-2h2m2-4h4a2 2 0 012 2v6a2 2 0 01-2 2h-4m0 0V8a2 2 0 00-2-2H9a2 2 0 00-2 2v8a2 2 0 002 2h4z" />
              </svg>
              <p class="text-sm">No rooms found</p>
            </div>
          </div>
          <div v-else class="divide-y divide-base-300">
            <button
              v-for="r in roomsStore.rooms"
              :key="r.id"
              @click="navigateToRoom(r)"
              class="w-full p-4 hover:bg-base-300 transition-colors text-left"
              :class="{ 'bg-primary/10 border-r-2 border-primary': roomId === r.id }"
            >
              <div class="flex items-center gap-3">
                <div class="avatar placeholder">
                  <div class="bg-primary text-primary-content rounded-full w-12">
                    <span class="text-lg font-semibold">
                      {{ r.name.charAt(0).toUpperCase() }}
                    </span>
                  </div>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between mb-1">
                    <h3 class="font-medium text-sm truncate">{{ r.name }}</h3>
                    <span class="text-xs text-base-content/50">
                      {{ formatTime(r.updated) }}
                    </span>
                  </div>
                  <p class="text-xs text-base-content/60 truncate">
                    {{ r.desc || `${r.members.length} members` }}
                  </p>
                  <div class="flex items-center justify-between mt-1">
                    <div class="badge badge-ghost badge-xs">
                      {{ r.members.length }} members
                    </div>
                  </div>
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
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
import ChatWindow from '../../../components/ChatWindow.vue'

const roomsStore = useRoomsStore()
const route = useRoute()
const router = useRouter()

const roomId = computed(() => route.params.roomId)
const room = computed(() => roomsStore.rooms.find(r => r.id === roomId.value))

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

function navigateToRoom(r) {
  if (roomId.value !== r.id) {
    router.push(`/room/${r.id}`)
  }
}

watch(room, (r) => {
  if (r && r.name) {
    document.title = `${r.name} - dSpeak`
  } else {
    document.title = 'dSpeak'
  }
})

function goBack() {
  router.push('/room')
}
</script>
