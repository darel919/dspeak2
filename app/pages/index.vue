<template>
        <section v-if="!isAuthenticated" class="min-h-screen flex items-center justify-center p-6">
                <div class="max-w-xl mx-auto text-center">
                        <h1 class="font-hero text-4xl mb-4">Welcome to dSpeak</h1>
                        <p class="text-base-content/70 mb-8 text-lg">A modern chat platform for real-time conversations.</p>
                        <NuxtLink to="/auth" class="btn btn-primary btn-lg">Login to Try dSpeak</NuxtLink>
                </div>
        </section>

        <section v-else class="min-h-screen bg-base-100">
            <div class="flex h-screen">
                <RoomList
                    :model-value="null"
                    @update:modelValue="onRoomChange"
                />
                <div class="flex-1 flex flex-col">
                    <div class="flex-1 flex items-center justify-center bg-base-100">
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
                </div>
            </div>


        </section>
</template>

<script setup>
import { useRoomsStore } from '../stores/rooms'
import { useAuthStore } from '../stores/auth'

const roomsStore = useRoomsStore()
const authStore = useAuthStore()
const router = useRouter()

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