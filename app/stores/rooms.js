import { defineStore } from "pinia";
import { useRuntimeConfig } from '#app'
import { useAuthStore } from './auth'

export const useRoomsStore = defineStore('rooms', () => {
    const rooms = ref([])
    const loading = ref(false)
    const error = ref(null)
    const config = useRuntimeConfig()

    async function fetchRooms() {
        loading.value = true
        error.value = null
        
        try {
            const authStore = useAuthStore()
            const userData = authStore.getUserData()
            
            if (!userData || !userData.id) {
                throw new Error('User not authenticated')
            }

            const apiPath = config.public.apiPath
            if (!apiPath) {
                throw new Error('API path is not defined')
            }

            console.log('[RoomsStore] Fetching rooms from:', `${apiPath}/rooms`)
            console.log('[RoomsStore] Using authorization:', userData.id)

            const response = await fetch(`${apiPath}/room`, {
                headers: {
                    'Authorization': userData.id,
                    'Content-Type': 'application/json'
                }
            })

            if (!response.ok) {
                const errorText = await response.text()
                console.error('[RoomsStore] Failed to fetch rooms:', response.status, errorText)
                throw new Error(`Failed to fetch rooms: ${response.status}`)
            }

            const data = await response.json()
            console.log('[RoomsStore] Rooms fetched successfully:', data)
            rooms.value = data
        } catch (err) {
            error.value = err.message
            console.error('[RoomsStore] Error fetching rooms:', err)
        } finally {
            loading.value = false
        }
    }
    
        async function getRoomDetails(roomId) {
            const authStore = useAuthStore()
            const userData = authStore.getUserData()
            const apiPath = config.public.apiPath
            if (!userData || !userData.id) throw new Error('User not authenticated')
            if (!apiPath) throw new Error('API path is not defined')
            const response = await fetch(`${apiPath}/room/details?id=${roomId}`, {
                headers: {
                    'Authorization': userData.id,
                    'Content-Type': 'application/json'
                }
            })
            if (!response.ok) throw new Error('Failed to fetch room details')
            return await response.json()
        }
    
        async function deleteRoom(roomId) {
            const authStore = useAuthStore()
            const userData = authStore.getUserData()
            const apiPath = config.public.apiPath
            if (!userData || !userData.id) throw new Error('User not authenticated')
            if (!apiPath) throw new Error('API path is not defined')
            const response = await fetch(`${apiPath}/room/${roomId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': userData.id,
                    'Content-Type': 'application/json'
                }
            })
            if (!response.ok) throw new Error('Failed to delete room')
            await fetchRooms()
        }

    function isOwner(room, userData) {
        return room.owner.id === userData.id
    }

    async function joinRoom(roomId) {
        loading.value = true
        error.value = null
        
        try {
            const authStore = useAuthStore()
            const userData = authStore.getUserData()
            
            if (!userData || !userData.id) {
                throw new Error('User not authenticated')
            }

            if (!roomId || typeof roomId !== 'string' || !roomId.trim()) {
                throw new Error('Invalid room ID')
            }

            const trimmedRoomId = roomId.trim()

            // Check if user is already a member of this room
            const existingRoom = rooms.value.find(room => room.id === trimmedRoomId)
            if (existingRoom) {
                console.log('[RoomsStore] User is already a member of this room')
                // Don't throw an error, just return the existing room
                return existingRoom
            }

            const apiPath = config.public.apiPath
            if (!apiPath) {
                throw new Error('API path is not defined')
            }

            console.log('[RoomsStore] Joining room:', trimmedRoomId)
            console.log('[RoomsStore] Using authorization:', userData.id)

            const response = await fetch(`${apiPath}/room/join`, {
                method: 'POST',
                headers: {
                    'Authorization': userData.id,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    roomId: trimmedRoomId
                })
            })

            if (!response.ok) {
                const errorText = await response.text()
                console.error('[RoomsStore] Failed to join room:', response.status, errorText)
                
                let errorMessage = 'Failed to join room'
                if (response.status === 404) {
                    errorMessage = 'Room not found'
                } else if (response.status === 403) {
                    errorMessage = 'You are not authorized to join this room'
                } else if (response.status === 409) {
                    errorMessage = 'You are already a member of this room'
                } else if (response.status === 401) {
                    errorMessage = 'Authentication required'
                } else if (response.status >= 500) {
                    errorMessage = 'Server error. Please try again later.'
                }
                
                throw new Error(errorMessage)
            }

            const data = await response.json()
            console.log('[RoomsStore] Successfully joined room:', data)
            
            // Refresh rooms list to include the newly joined room
            await fetchRooms()
            
            return data
        } catch (err) {
            error.value = err.message
            console.error('[RoomsStore] Error joining room:', err)
            throw err
        } finally {
            loading.value = false
        }
    }

    function clearRooms() {
        rooms.value = []
        error.value = null
    }

    return { 
    rooms, 
    loading, 
    error, 
    fetchRooms, 
    joinRoom,
    isOwner,
    clearRooms,
    getRoomDetails,
    deleteRoom
    }
})
