<template>
  <div class="flex items-center">
    <!-- Rooms Dropdown/Horizontal List -->
    <div class="flex items-center transition-all duration-300 ease-in-out">
      <!-- Collapsed State: Dropdown -->
  <div v-if="isCollapsed" class="dropdown dropdown-right" style="z-index:1000;">
        <button 
          tabindex="0" 
          class="btn btn-ghost btn-sm flex items-center gap-2"
          :class="{ 'btn-active': selectedRoom }"
        >
          <span class="text-sm font-medium">Rooms</span>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
            <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
        <div tabindex="0" class="dropdown-content z-[1000] menu p-2 shadow bg-base-100 rounded-box w-80 max-h-96 overflow-y-auto">
          <!-- Loading State -->
          <div v-if="roomsStore.loading" class="p-2">
            <div class="space-y-2">
              <div v-for="i in 3" :key="i" class="animate-pulse">
                <div class="flex items-center gap-3 p-2">
                  <div class="w-8 h-8 bg-base-300 rounded-full"></div>
                  <div class="flex-1">
                    <div class="h-3 bg-base-300 rounded w-3/4 mb-1"></div>
                    <div class="h-2 bg-base-300 rounded w-1/2"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <!-- Error State -->
          <div v-else-if="roomsStore.error" class="p-2">
            <div class="alert alert-error alert-sm">
              <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-4 w-4" fill="none" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span class="text-xs">{{ roomsStore.error }}</span>
            </div>
          </div>
          <!-- Rooms List -->
          <div v-else-if="roomsStore.rooms.length > 0">
            <li v-for="room in roomsStore.rooms" :key="room.id">
              <a 
                @click="navigateToRoom(room)"
                class="flex items-center gap-3 p-2"
                :class="{ 'active': modelValue === room.id }"
              >
                <div class="avatar placeholder">
                  <template v-if="getRoomPictureUrl(room)">
                    <img :src="getRoomPictureUrl(room)" class="w-12 h-12 min-w-[3rem] min-h-[3rem] max-w-[3rem] max-h-[3rem] rounded-full object-cover" :alt="room.name" />
                  </template>
                  <template v-else>
                    <div class="w-12 h-12 rounded-full bg-primary text-primary-content text-sm flex items-center justify-center">
                      <span>{{ room.name.charAt(0).toUpperCase() }}</span>
                    </div>
                  </template>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between">
                    <span class="text-sm font-medium truncate">{{ room.name }}</span>
                    <div v-if="hasActivity(room)" class="w-2 h-2 bg-accent rounded-full"></div>
                  </div>
                  <p class="text-xs text-base-content/60 truncate">
                    {{ room.desc || `${room.members.length} members` }}
                  </p>
                </div>
              </a>
            </li>
            <div class="divider my-1"></div>
            <li><a @click="showJoinModal = true" class="text-sm"><svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" /></svg>Join Room</a></li>
            <li><a @click="showCreateModal = true" class="text-sm"><svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.5v15m7.5-7.5h-15" /></svg>Create Room</a></li>
          </div>
          <!-- Empty State -->
          <div v-else class="p-4 text-center">
            <div class="text-base-content/50 text-sm">
              <p>No rooms found</p>
              <div class="mt-2 space-y-1">
                <button @click="showJoinModal = true" class="btn btn-xs btn-ghost">Join Room</button>
                <button @click="showCreateModal = true" class="btn btn-xs btn-ghost">Create Room</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <!-- Expanded State: Only Room Icons -->
      <div v-else class="flex items-center gap-3">
        <button
          v-for="room in visibleRooms"
          :key="room.id"
          @click="navigateToRoom(room)"
          class="relative group"
          :class="modelValue === room.id ? 'opacity-100' : 'opacity-60 hover:opacity-100'"
          :title="room.name"
        >
          <div class="avatar placeholder">
            <template v-if="getRoomPictureUrl(room)">
              <img :src="getRoomPictureUrl(room)" class="w-12 h-12 min-w-[3rem] min-h-[3rem] max-w-[3rem] max-h-[3rem] rounded-full object-cover transition-all" :class="modelValue === room.id ? 'ring-2 ring-primary ring-offset-2' : ''" :alt="room.name" />
            </template>
            <template v-else>
              <div
                class="w-12 h-12 rounded-full text-xs font-semibold transition-all flex items-center justify-center"
                :class="modelValue === room.id ? 'bg-primary text-primary-content ring-2 ring-primary ring-offset-2' : 'bg-neutral text-neutral-content hover:bg-primary hover:text-primary-content'"
              >
                <span>{{ room.name.charAt(0).toUpperCase() }}</span>
              </div>
            </template>
          </div>
          <div v-if="hasActivity(room)" class="absolute -top-1 -right-1 w-3 h-3 bg-accent rounded-full"></div>
        </button>
        <!-- More Rooms Dropdown (if there are too many) -->
        <div v-if="hiddenRooms.length > 0" class="dropdown dropdown-end" style="z-index:1000;">
          <button tabindex="0" class="btn btn-ghost btn-xs btn-circle">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 12.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 18.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z" />
            </svg>
          </button>
          <div tabindex="0" class="dropdown-content z-[1000] menu p-2 shadow bg-base-100 rounded-box w-64">
            <li v-for="room in hiddenRooms" :key="room.id">
              <a 
                @click="navigateToRoom(room)"
                class="flex items-center gap-2 text-sm"
                :class="{ 'active': modelValue === room.id }"
              >
                <div class="avatar placeholder">
                  <template v-if="getRoomPictureUrl(room)">
                    <img :src="getRoomPictureUrl(room)" class="w-12 h-12 min-w-[3rem] min-h-[3rem] max-w-[3rem] max-h-[3rem] rounded-full object-cover" :alt="room.name" />
                  </template>
                  <template v-else>
                    <div class="w-6 h-6 rounded-full bg-primary text-primary-content text-xs flex items-center justify-center">
                      <span>{{ room.name.charAt(0).toUpperCase() }}</span>
                    </div>
                  </template>
                </div>
                <span class="truncate">{{ room.name }}</span>
                <div v-if="hasActivity(room)" class="w-2 h-2 bg-accent rounded-full ml-auto"></div>
              </a>
            </li>
          </div>
        </div>
        <!-- Action Buttons -->
        <div class="flex items-center gap-1 ml-2 pl-2 border-l border-base-300">
          <button 
            @click="showJoinModal = true" 
            class="btn btn-ghost btn-xs btn-circle" 
            title="Join Room"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
            </svg>
          </button>
          <button 
            @click="showCreateModal = true" 
            class="btn btn-ghost btn-xs btn-circle" 
            title="Create Room"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </button>
        </div>
      </div>
      <!-- Toggle Button -->
      <button 
        @click="toggleCollapse"
        class="btn btn-ghost btn-xs btn-circle ml-2"
        :title="isCollapsed ? 'Show Room Icons' : 'Show Rooms Menu'"
      >
        <svg v-if="isCollapsed" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
          <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
      </button>
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
            ref="joinInputRef"
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
            ref="createNameRef"
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

    <!-- Collapsed State Context Menu -->
    <div v-if="isCollapsed" class="absolute top-16 left-2 z-50">
      <div class="dropdown dropdown-right">
        <button 
          tabindex="0" 
          class="btn btn-circle btn-ghost btn-xs opacity-0 hover:opacity-100 transition-opacity"
          @click="showContextMenu = !showContextMenu"
          title="Room Actions"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 12.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 18.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z" />
          </svg>
        </button>
        <div tabindex="0" class="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-52">
          <li><a @click="showJoinModal = true">Join Room</a></li>
          <li><a @click="showCreateModal = true">Create Room</a></li>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.transition-all {
  transition-property: all;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 300ms;
}

/* Ensure smooth width transitions */
.w-16 {
  width: 4rem;
}

.w-72 {
  width: 18rem;
}

/* Custom hover effects for collapsed state */
.group:hover .group-hover\:opacity-100 {
  opacity: 1;
}

/* Activity indicator pulse animation */
@keyframes pulse-soft {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}

.bg-accent {
  animation: pulse-soft 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
</style>


<script setup>
import { useRuntimeConfig } from '#app'
import { useRoomsStore } from '../stores/rooms'
import { useAuthStore } from '../stores/auth'
import { formatTime } from '../composables/useTimeUtils'
import { useToast } from '../composables/useToast'

const config = useRuntimeConfig()

function getRoomPictureUrl(room) {
  if (room.picture) {

    return `${config.public.apiPath.replace(/\/$/, '')}/${room.picture.replace(/^\//, '')}`
  }
  return null
}

const props = defineProps({
  modelValue: [String, Number]
})
const emit = defineEmits(['update:modelValue'])

const roomsStore = useRoomsStore()
const authStore = useAuthStore()
const router = useRouter()
const { success, error } = useToast()

const isCollapsed = ref(true)
const showContextMenu = ref(false)

const MAX_VISIBLE_ROOMS = 5

const selectedRoom = computed(() => 
  roomsStore.rooms.find(r => r.id === props.modelValue)
)

const visibleRooms = computed(() => 
  roomsStore.rooms.slice(0, MAX_VISIBLE_ROOMS)
)

const hiddenRooms = computed(() => 
  roomsStore.rooms.length > MAX_VISIBLE_ROOMS 
    ? roomsStore.rooms.slice(MAX_VISIBLE_ROOMS) 
    : []
)

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

function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value

  localStorage.setItem('roomListCollapsed', isCollapsed.value.toString())
}

onMounted(() => {
  const stored = localStorage.getItem('roomListCollapsed')
  if (stored !== null) {
    isCollapsed.value = stored === 'true'
  } else {

    isCollapsed.value = true
  }
})

function hasActivity(room) {
  const hasCurrentUser = room.members?.some(member => member.id === getCurrentUserId())
  const simulatedActivity = room.id && (parseInt(room.id, 36) % 3 === 0)
  
  return hasCurrentUser && simulatedActivity
}

function getCurrentUserId() {
  const userData = authStore.getUserData()
  return userData?.id || null
}

watch(showJoinModal, (val) => {
  if (val) {
    nextTick(() => {
      joinInputRef.value?.focus()
    })
  }
})

watch(showCreateModal, (val) => {
  if (val) {
    nextTick(() => {
      setTimeout(() => {
        createNameRef.value?.focus()
      }, 100)
    })
  }
})

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
        try {
          const channels = await useChannelsStore().fetchChannels(roomId)
          const firstChannel = channels && channels.length > 0 ? channels[0] : null
          if (firstChannel) {
            router.push(`/room/${roomId}/${firstChannel.id}`)
          } else {
            router.push(`/room/${roomId}`)
          }
        } catch {
          router.push(`/room/${roomId}`)
        }
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
            try {
              const channels = await useChannelsStore().fetchChannels(room.id)
              const firstChannel = channels && channels.length > 0 ? channels[0] : null
              if (firstChannel) {
                router.push(`/room/${room.id}/${firstChannel.id}`)
              } else {
                router.push(`/room/${room.id}`)
              }
            } catch {
              router.push(`/room/${room.id}`)
            }
        }
    } catch (err) {
        const msg = typeof err?.message === 'string' ? err.message : ''
        if (msg.includes('409') && msg.includes('already exists')) {
          createError.value = 'Pick another name, this name is already taken'
        } else {
          createError.value = msg || 'Failed to create room'
        }
    } finally {
        creatingRoom.value = false
    }
}

function refreshRooms() {
  roomsStore.fetchRooms?.()
}

async function navigateToRoom(r) {
  if (props.modelValue !== r.id) {
    emit('update:modelValue', r.id)
    try {
      const channels = await roomsStore.rooms.find(room => room.id === r.id) ? await useChannelsStore().fetchChannels(r.id) : [];
      const firstChannel = channels && channels.length > 0 ? channels[0] : null;
      if (firstChannel) {
        router.push(`/room/${r.id}/${firstChannel.id}`)
      } else {
        router.push(`/room/${r.id}`)
      }
    } catch {
      router.push(`/room/${r.id}`)
    }
  }
}
</script>
