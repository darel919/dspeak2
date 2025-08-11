<template>
        <section v-if="!isAuthenticated" class="min-h-screen flex items-center justify-center p-6">
                <div class="max-w-xl mx-auto text-center">
                        <h1 class="font-hero text-4xl mb-4">Welcome to dSpeak</h1>
                        <p class="text-base-content/70 mb-8 text-lg">A modern chat platform for real-time conversations.</p>
                        <NuxtLink to="/auth" class="btn btn-primary btn-lg">Login to Try dSpeak</NuxtLink>
                </div>
        </section>

        <section v-else class="min-h-screen-minus-navbar bg-base-100">
            <div class="h-screen-minus-navbar">
                <div class="h-full flex">
                    <!-- Desktop Layout -->
                    <div v-if="!isMobile" class="flex w-full">
                        <!-- Channel List Sidebar (desktop only) -->
                        <div v-if="selectedRoom" class="w-64 border-base-300">
                            <ChannelList
                                :room="selectedRoom"
                                :selected-channel-id="selectedChannelId"
                                @channel-selected="onChannelSelected"
                            />
                        </div>

                        <!-- Chat Area or Welcome -->
                        <div class="flex-1 flex flex-col">
                            <!-- Chat Window -->
                            <ChatWindow
                                v-if="selectedRoom && selectedChannel && selectedChannel.id"
                                class="flex-1"
                                :channel-id="selectedChannel.id"
                                :channel="selectedChannel"
                                :room="selectedRoom"
                                :show-back-button="false"
                            />
                            <!-- Room Welcome -->
                            <div v-else-if="selectedRoom" class="flex-1 flex items-center justify-center">
                                <div class="text-center">
                                    <h3 class="text-lg font-semibold mb-2">Welcome to {{ selectedRoom?.name }}</h3>
                                    <p class="text-base-content/60">Select a channel to start chatting</p>
                                </div>
                            </div>
                            <!-- Main Welcome -->
                            <div v-else class="flex-1 flex items-center justify-center bg-base-100">
                                <div class="text-center max-w-md">
                                    <div class="text-base-content/30 mb-6">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-24 w-24 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                                        </svg>
                                    </div>
                                    <h2 class="text-2xl font-semibold mb-2">Welcome to DSpeak</h2>
                                    <p class="text-base-content/60 mb-6">
                                        Select a server from the navbar to start collaborating with your team.
                                    </p>
                                    <div class="text-sm text-base-content/50">
                                        <p>💬 Real-time messaging</p>
                                        <p>📱 Responsive design</p>
                                        <p>👥 Team collaboration</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Mobile Layout -->
                    <div v-else class="w-full">
                        <!-- Mobile: Full-screen chat when channel is selected -->
                        <div v-if="selectedChannel && selectedChannel.id" class="h-full">
                            <ChatWindow
                                class="h-full"
                                :channel-id="selectedChannel.id"
                                :channel="selectedChannel"
                                :room="selectedRoom"
                                :show-back-button="true"
                                @back="onBackFromChat"
                            />
                        </div>

                        <!-- Mobile: Show channel list when room is selected but no channel -->
                        <div v-else-if="selectedRoom && !showMobileRoomList" class="h-full">
                            <MobileChannelList
                                :room="selectedRoom"
                                :selected-channel-id="selectedChannelId"
                                :loading="channelsStore.loading"
                                @channel-selected="onChannelSelected"
                                @back="onBackToRoomList"
                            />
                        </div>

                        <!-- Mobile: Show room sidebar when no room is selected or when explicitly requested -->
                        <div v-else class="h-full">
                            <MobileRoomSidebar
                                :selected-room-id="selectedRoomId"
                                @room-selected="onRoomSelected"
                            />
                        </div>
                    </div>
                </div>
            </div>
        </section>
</template>

<script setup>
import { useRoomsStore } from '../stores/rooms'
import { useChannelsStore } from '../stores/channels'
import { useAuthStore } from '../stores/auth'
import ChatWindow from '../components/Chat/ChatWindow.vue'
import ChannelList from '../components/ChannelList.vue'
import MobileRoomSidebar from '../components/MobileRoomSidebar.vue'
import MobileChannelList from '../components/MobileChannelList.vue'

const roomsStore = useRoomsStore()
const channelsStore = useChannelsStore()
const authStore = useAuthStore()
const router = useRouter()
const route = useRoute()

const selectedRoomId = ref(null)
const selectedChannelId = ref(null)
const showMobileRoomList = ref(false)
const selectedRoom = computed(() => roomsStore.rooms.find(r => r.id === selectedRoomId.value) || null)
const selectedChannel = computed(() => channelsStore.getChannelById(selectedChannelId.value))

// Channel lists
const textChannels = computed(() => channelsStore.getTextChannels())
const voiceChannels = computed(() => channelsStore.getMediaChannels())

const isMobile = ref(false)
let resizeHandler = null
if (typeof window !== 'undefined') {
    const checkMobile = () => {
        isMobile.value = window.innerWidth < 768 // md breakpoint (768px)
    }
    resizeHandler = checkMobile
    checkMobile()
    window.addEventListener('resize', checkMobile)
}

// Cleanup event listener
onUnmounted(() => {
    if (typeof window !== 'undefined' && resizeHandler) {
        window.removeEventListener('resize', resizeHandler)
    }
})

// Watch for route changes to update selected room
watch(() => route.path, async (newPath) => {
    if (newPath.startsWith('/room/')) {
        const roomId = route.params.roomId
        selectedRoomId.value = roomId
        selectedChannelId.value = null // Reset channel selection
        showMobileRoomList.value = false // Hide room list when room is selected
        
        if (roomId) {
            try {
                // Fetch channels for this room
                await channelsStore.fetchChannels(roomId)
                
                // On mobile, don't auto-select channel - show channel list instead
                if (!isMobile.value) {
                    // Auto-select first text channel on desktop
                    const textChannels = channelsStore.getTextChannels()
                    if (textChannels.length > 0) {
                        selectedChannelId.value = textChannels[0].id
                    }
                }
            } catch (error) {
                console.error('Failed to fetch channels:', error)
            }
        }
    } else {
        selectedRoomId.value = null
        selectedChannelId.value = null
        showMobileRoomList.value = true // Show room list on home page
    }
}, { immediate: true })

function onChannelSelected(channel) {
    selectedChannelId.value = channel.id
}

function onRoomSelected(room) {
    selectedRoomId.value = room.id
    showMobileRoomList.value = false
    // Navigation will be handled by the MobileRoomSidebar component
}

function onBackFromChat() {
    if (isMobile.value) {
        selectedChannelId.value = null
        // This will show the channel list again
    } else {
        router.push('/')
    }
}

function onBackToRoomList() {
    selectedRoomId.value = null
    selectedChannelId.value = null
    showMobileRoomList.value = true
    router.push('/')
}

const isAuthenticated = computed(() => {
    const token = localStorage.getItem('token')
    const userData = authStore.getUserData()
    return !!token && userData
})

// Watch for authentication changes and fetch rooms
watch(isAuthenticated, async (newValue) => {
    if (newValue) {
        await roomsStore.fetchRooms()
    }
}, { immediate: true })
</script>