<template>
  <div class="h-full bg-base-200 flex flex-col">
    <!-- Sidebar Header -->
    <div class="p-4 border-b border-base-300">
      <h2 class="text-lg font-semibold">Rooms</h2>
    </div>

    <!-- Rooms List -->
    <div class="flex-1 overflow-y-auto p-2">
      <!-- Loading State -->
      <div v-if="roomsStore.loading" class="space-y-3">
        <div v-for="i in 5" :key="i" class="animate-pulse">
          <div class="flex items-center gap-3 p-3">
            <div class="w-12 h-12 bg-base-300 rounded-full"></div>
            <div class="flex-1">
              <div class="h-4 bg-base-300 rounded w-3/4 mb-2"></div>
              <div class="h-3 bg-base-300 rounded w-1/2"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Error State -->
      <div v-else-if="roomsStore.error" class="p-4">
        <div class="alert alert-error alert-sm">
          <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span class="text-xs">{{ roomsStore.error }}</span>
        </div>
      </div>

      <!-- Rooms List -->
      <div v-else-if="roomsStore.rooms.length > 0" class="space-y-2">
        <button
          v-for="room in roomsStore.rooms"
          :key="room.id"
          @click="selectRoom(room)"
          class="w-full flex items-center gap-3 p-3 rounded-lg transition-all duration-200"
          :class="[
            selectedRoomId === room.id 
              ? 'bg-primary text-primary-content' 
              : 'hover:bg-base-300 text-base-content'
          ]"
        >
          <!-- Room Avatar -->
          <div class="avatar placeholder">
            <template v-if="getRoomPictureUrl(room)">
              <img :src="getRoomPictureUrl(room)" class="w-12 h-12 min-w-[3rem] min-h-[3rem] max-w-[3rem] max-h-[3rem] rounded-full object-cover" :alt="room.name" />
            </template>
            <template v-else>
              <div 
                class="w-12 h-12 rounded-full text-sm font-semibold"
                :class="[
                  selectedRoomId === room.id 
                    ? 'bg-primary-content text-primary' 
                    : 'bg-neutral text-neutral-content'
                ]"
              >
                <span>{{ room.name.charAt(0).toUpperCase() }}</span>
              </div>
            </template>
          </div>

          <!-- Room Info -->
          <div class="flex-1 text-left overflow-hidden">
            <div class="font-medium truncate">{{ room.name }}</div>
            <div 
              class="text-sm opacity-70 truncate"
              :class="[
                selectedRoomId === room.id 
                  ? 'text-primary-content' 
                  : 'text-base-content'
              ]"
            >
              {{ room.desc || `${room.members?.length || 0} members` }}
            </div>
          </div>

          <!-- Activity indicator -->
          <div v-if="hasActivity(room)" class="w-3 h-3 bg-accent rounded-full"></div>
        </button>
      </div>

      <!-- Empty State -->
      <div v-else class="flex flex-col items-center justify-center h-64 text-center p-4">
        <div class="text-base-content/50 mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </div>
        <h3 class="font-medium mb-2">No servers found</h3>
        <p class="text-sm text-base-content/60 mb-4">Join or create a server to get started</p>
        <div class="space-y-2">
          <button @click="showJoinModal = true" class="btn btn-sm btn-primary w-full">
            Join Server
          </button>
          <button @click="showCreateModal = true" class="btn btn-sm btn-outline w-full">
            Create Server
          </button>
        </div>
      </div>
    </div>

    <!-- Action Buttons -->
    <div class="p-3 border-t border-base-300">
      <div class="flex gap-2">
        <button 
          @click="showJoinModal = true" 
          class="btn btn-sm btn-ghost flex-1"
          title="Join Server"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
          </svg>
          Join
        </button>
        <button 
          @click="showCreateModal = true" 
          class="btn btn-sm btn-ghost flex-1"
          title="Create Server"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Create
        </button>
      </div>
    </div>

    <!-- Join Room Modal -->
    <div v-if="showJoinModal" class="modal modal-open">
      <div class="modal-box">
        <h3 class="font-bold text-lg mb-4">Join Server</h3>
        <p class="text-base-content/70 mb-4">Enter a server ID or paste a join link to join a server.</p>
        <div class="form-control mb-4">
          <input 
            v-model="joinInput"
            ref="joinInputRef"
            type="text" 
            placeholder="Server ID or invite link..."
            class="input input-bordered w-full"
            @keyup.enter="handleJoinSubmit"
          />
        </div>
        <div v-if="joinError" class="alert alert-error alert-sm mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{{ joinError }}</span>
        </div>
        <div class="modal-action">
          <button 
            class="btn btn-ghost" 
            @click="closeJoinModal"
            :disabled="joiningRoom"
          >
            Cancel
          </button>
          <button 
            class="btn btn-primary" 
            @click="handleJoinSubmit"
            :disabled="!joinInput.trim() || joiningRoom"
            :class="{ 'loading': joiningRoom }"
          >
            {{ joiningRoom ? 'Joining...' : 'Join Server' }}
          </button>
        </div>
      </div>
      <div class="modal-backdrop" @click="closeJoinModal"></div>
    </div>

    <!-- Create Room Modal -->
    <div v-if="showCreateModal" class="modal modal-open">
      <div class="modal-box">
        <h3 class="font-bold text-lg mb-4">Create Server</h3>
        <div class="form-control mb-4">
          <label class="label">
            <span class="label-text">Server Name <span class="text-error">*</span></span>
          </label>
          <input 
            v-model="createName"
            ref="createNameRef"
            type="text" 
            placeholder="Enter server name..."
            class="input input-bordered w-full"
            @keyup.enter="handleCreateSubmit"
          />
        </div>
        <div class="form-control mb-4">
          <label class="label">
            <span class="label-text">Description</span>
          </label>
          <input 
            v-model="createDesc"
            type="text" 
            placeholder="Optional description..."
            class="input input-bordered w-full"
            @keyup.enter="handleCreateSubmit"
          />
        </div>
        <div v-if="createError" class="alert alert-error alert-sm mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{{ createError }}</span>
        </div>
        <div class="modal-action">
          <button 
            class="btn btn-ghost" 
            @click="closeCreateModal"
            :disabled="creatingRoom"
          >
            Cancel
          </button>
          <button 
            class="btn btn-primary" 
            @click="handleCreateSubmit"
            :disabled="!createName.trim() || creatingRoom"
            :class="{ 'loading': creatingRoom }"
          >
            {{ creatingRoom ? 'Creating...' : 'Create Server' }}
          </button>
        </div>
      </div>
      <div class="modal-backdrop" @click="closeCreateModal"></div>
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick, watch } from 'vue'
import { useRoomsStore } from '../stores/rooms'
import { useToast } from '../composables/useToast'
const config = useRuntimeConfig()

const props = defineProps({
  selectedRoomId: String
})

const emit = defineEmits(['room-selected'])

const roomsStore = useRoomsStore()
const router = useRouter()
const { success, error } = useToast()

const showJoinModal = ref(false)
const joinInput = ref('')
const joinError = ref(null)
const joiningRoom = ref(false)

const showCreateModal = ref(false)
const createName = ref('')
const createDesc = ref('')
const createError = ref(null)
const creatingRoom = ref(false)

const joinInputRef = ref(null)
const createNameRef = ref(null)

function getRoomPictureUrl(room) {
  if (room.picture) {
    return `${config.public.apiPath.replace(/\/$/, '')}/${room.picture.replace(/^\//, '')}`
  }
  return null
}


async function selectRoom(room) {
  emit('room-selected', room)
  router.push(`/room/${room.id}`)
}

function hasActivity(room) {
  return 0
  // return Math.random() > 0.7
}

function closeJoinModal() {
  showJoinModal.value = false
  joinInput.value = ''
  joinError.value = null
  joiningRoom.value = false
}

function closeCreateModal() {
  showCreateModal.value = false
  createName.value = ''
  createDesc.value = ''
  createError.value = null
  creatingRoom.value = false
}

function extractRoomIdFromInput(input) {
  const trimmed = input.trim()
  const joinLinkMatch = trimmed.match(/\/join\/([^/?#]+)/)
  if (joinLinkMatch) {
    return joinLinkMatch[1]
  }
  return trimmed
}

async function handleJoinSubmit() {
  if (!joinInput.value.trim()) return
  joiningRoom.value = true
  joinError.value = null
  try {
    const roomId = extractRoomIdFromInput(joinInput.value)
    if (!roomId) {
      throw new Error('Invalid server ID or join link')
    }
    await roomsStore.joinRoom(roomId)
    success('Successfully joined server!')
    closeJoinModal()
    router.push(`/room/${roomId}`)
  } catch (err) {
    joinError.value = err.message || 'Failed to join server'
  } finally {
    joiningRoom.value = false
  }
}

async function handleCreateSubmit() {
  if (!createName.value.trim()) return
  creatingRoom.value = true
  createError.value = null
  try {
    const room = await roomsStore.createRoom(createName.value, createDesc.value)
    success('Server created successfully!')
    closeCreateModal()
    if (room && room.id) {
      router.push(`/room/${room.id}`)
    }
  } catch (err) {
    const msg = typeof err?.message === 'string' ? err.message : ''
    if (msg.includes('409') && msg.includes('already exists')) {
      createError.value = 'Pick another name, this name is already taken'
    } else {
      createError.value = msg || 'Failed to create server'
    }
  } finally {
    creatingRoom.value = false
  }
}
watch(showJoinModal, (newValue) => {
  if (newValue) {
    nextTick(() => {
      joinInputRef.value?.focus()
    }, 100)
  }
})

watch(showCreateModal, (newValue) => {
  if (newValue) {
    nextTick(() => {
      createNameRef.value?.focus()
    }, 100)
  }
})
</script>
