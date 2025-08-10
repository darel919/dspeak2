<template>
  <div class="w-80 bg-base-200 border-r border-base-300 flex flex-col">
    <div class="mt-2 px-4 border-b border-base-300">
      <div class="flex items-center justify-between gap-2">
        <h1 class="font-hero text-xl">Rooms</h1>
        <div class="flex gap-1">
          <button class="btn btn-ghost btn-xs" @click="showJoinModal = true" title="Join Room">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
            </svg>

          </button>
          <button class="btn btn-ghost btn-xs" @click="showCreateModal = true" title="Create Room">
           <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>

          </button>
          <!-- <button 
            class="btn btn-ghost btn-sm"
            @click="refreshRooms"
            :disabled="roomsStore.loading"
            title="Refresh Rooms"
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
          </button> -->
        </div>
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
          :class="{ 'bg-primary/10 border-r-2 border-primary': modelValue === r.id }"
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
              </div>
              <p class="text-xs text-base-content/60 truncate">
                {{ r.desc || `${r.members.length} members` }}
              </p>
            </div>
          </div>
        </button>
      </div>
    </div>

    <!-- Join Room Modal -->
    <div v-if="showJoinModal" class="modal modal-open">
      <div class="modal-box">
        <h3 class="font-bold text-lg mb-4">Join Room</h3>
        <p class="text-base-content/70 mb-4">Enter a room ID or paste a join link to join a room.</p>
        <div class="form-control">
          <label class="label">
            <span class="label-text">Room ID or Join Link</span>
          </label>
          <input 
            v-model="joinInput"
            type="text" 
            placeholder="Enter room ID or paste join link..."
            class="input input-bordered w-full"
            @keyup.enter="handleJoinSubmit"
          />
        </div>
        <div v-if="joinError" class="alert alert-error mt-4">
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
            {{ joiningRoom ? 'Joining...' : 'Join Room' }}
          </button>
        </div>
      </div>
      <div class="modal-backdrop" @click="closeJoinModal"></div>
    </div>

    <!-- Create Room Modal -->
    <div v-if="showCreateModal" class="modal modal-open">
      <div class="modal-box">
        <h3 class="font-bold text-lg mb-4">Create Room</h3>
        <div class="form-control mb-4">
          <label class="label">
            <span class="label-text">Room Name <span class="text-error">*</span></span>
          </label>
          <input 
            v-model="createName"
            type="text" 
            placeholder="Enter room name..."
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
        <div v-if="createError" class="alert alert-error mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
            {{ creatingRoom ? 'Creating...' : 'Create Room' }}
          </button>
        </div>
      </div>
      <div class="modal-backdrop" @click="closeCreateModal"></div>
    </div>
  </div>
</template>

<script setup>
import { useRoomsStore } from '../stores/rooms'
import { formatTime } from '../composables/useTimeUtils'
import { useToast } from '../composables/useToast'

const props = defineProps({
  modelValue: [String, Number]
})
const emit = defineEmits(['update:modelValue'])

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
            throw new Error('Invalid room ID or join link')
        }
        await roomsStore.joinRoom(roomId)
        success('Successfully joined room!')
        closeJoinModal()
        router.push(`/room?roomId=${roomId}`)
    } catch (err) {
        joinError.value = err.message || 'Failed to join room'
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
        success('Room created successfully!')
        closeCreateModal()
        if (room && room.id) {
            router.push(`/room?roomId=${room.id}`)
        }
    } catch (err) {
        createError.value = err.message || 'Failed to create room'
    } finally {
        creatingRoom.value = false
    }
}

function refreshRooms() {
  roomsStore.fetchRooms?.()
}

function navigateToRoom(r) {
  if (props.modelValue !== r.id) {
    emit('update:modelValue', r.id)
    router.push(`/room/${r.id}`)
  }
}
</script>
