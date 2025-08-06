<template>
    <section v-if="!isAuthenticated" class="min-h-screen flex items-center justify-center p-6">
        <div class="max-w-xl mx-auto text-center">
            <h1 class="font-hero text-4xl mb-4">Welcome to dSpeak</h1>
            <p class="text-base-content/70 mb-8 text-lg">A modern chat platform for real-time conversations.</p>
            <NuxtLink to="/auth" class="btn btn-primary btn-lg">Login to Try dSpeak</NuxtLink>
        </div>
    </section>
    <section v-else class="min-h-screen p-6">
        <div class="max-w-6xl mx-auto">
            <h1 class="font-hero text-3xl mb-2">Home</h1>
            <p class="text-base-content/70 mb-8">Welcome to dSpeak</p>
            <div class="mb-6">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-2xl font-semibold">Your Rooms</h2>
                    <div class="flex gap-2">
                        <button 
                            class="btn btn-ghost btn-sm"
                            @click="showJoinModal = true"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                            </svg>
                            Join Room
                        </button>
                                <button 
                                    class="btn btn-ghost btn-sm"
                                    @click="showCreateModal = true"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                                    </svg>
                                    Create Room
                                </button>
                        <button 
                            class="btn btn-ghost btn-sm"
                            :class="{ 'loading': roomsStore.loading }"
                            @click="roomsStore.fetchRooms()"
                            :disabled="roomsStore.loading"
                        >
                            <svg v-if="!roomsStore.loading" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            Refresh
                        </button>
                    </div>
                </div>
                <div v-if="roomsStore.loading" class="flex justify-center py-8">
                    <div class="loading loading-spinner loading-lg"></div>
                </div>
                <div v-else-if="roomsStore.error" class="alert alert-error">
                    <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                        <h3 class="font-bold">Error loading rooms</h3>
                        <div class="text-xs">{{ roomsStore.error }}</div>
                    </div>
                    <button class="btn btn-sm btn-outline" @click="roomsStore.fetchRooms()">
                        Retry
                    </button>
                </div>
                <div v-else-if="roomsStore.rooms.length === 0" class="text-center py-12">
                    <div class="text-base-content/50 mb-4">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM9 3a2 2 0 11-4 0 2 2 0 014 0z" />
                        </svg>
                        <p class="text-lg">No rooms found</p>
                        <p class="text-sm">You haven't joined any rooms yet.</p>
                    </div>
                </div>
                <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <RoomCard 
                        v-for="room in roomsStore.rooms" 
                        :key="room.id"
                        :room="room"
                    />
                </div>
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
                            {{ creatingRoom ? 'Creating...' : 'Create Room' }}
                        </button>
                    </div>
                </div>
                <div class="modal-backdrop" @click="closeCreateModal"></div>
            </div>
    </section>
</template>

<script setup>
import { useRoomsStore } from '../stores/rooms'
import { useAuthStore } from '../stores/auth'
import { useToast } from '../composables/useToast'

const roomsStore = useRoomsStore()
const authStore = useAuthStore()
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

const isAuthenticated = computed(() => {
  const token = localStorage.getItem('token')
  const userData = authStore.getUserData()
  const result = !!token && userData
  console.log('[Index] isAuthenticated computed:', { token: !!token, userData: !!userData, result })
  return result
})

// Watch for authentication changes and fetch rooms
watch(isAuthenticated, async (newValue) => {
  console.log('[Index] Authentication changed:', newValue)
  if (newValue) {
    console.log('[Index] User is authenticated, fetching rooms')
    await roomsStore.fetchRooms()
  }
}, { immediate: true })

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
</script>