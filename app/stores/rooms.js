import { defineStore } from "pinia";
import { useRuntimeConfig } from '#app'
import { useAuthStore } from './auth'

const rooms = ref([])
const loading = ref(false)
const error = ref(null)

export const useRoomsStore = defineStore('rooms', () => {
    const config = useRuntimeConfig()

    async function updateRoom(roomId, data) {
        const authStore = useAuthStore()
        const userData = authStore.getUserData()
        const apiPath = config.public.apiPath
        if (!userData || !userData.id) throw new Error('User not authenticated')
        if (!apiPath) throw new Error('API path is not defined')
        const response = await fetch(`${apiPath}/room/`, {
            method: 'PUT',
            headers: {
                'Authorization': userData.id,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ roomId, ...data })
        })
        if (!response.ok) throw new Error('Failed to update room')
        await fetchRooms()
        return await response.json()
    }
    
    function getRoomById(id) {
        return Array.isArray(rooms?.value) ? rooms.value.find(room => room.id === id) : undefined
    }

        async function createRoom(name, desc = "") {
            const authStore = useAuthStore()
            const userData = authStore.getUserData()
            const apiPath = config.public.apiPath
            if (!name || typeof name !== 'string' || !name.trim()) throw new Error('Room name is required')
            if (!userData || !userData.id) throw new Error('User not authenticated')
            if (!apiPath) throw new Error('API path is not defined')
            const body = { name: name.trim() }
            if (desc && typeof desc === 'string' && desc.trim()) body.desc = desc.trim()
            const response = await fetch(`${apiPath}/room/`, {
                method: 'POST',
                headers: {
                    'Authorization': userData.id,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            })
            if (!response.ok) {
                const errorText = await response.text()
                throw new Error(`Failed to create room: ${response.status} ${errorText}`)
            }
            const data = await response.json()
            await fetchRooms()
            
            if (data && data.id) {
                await joinRoom(data.id)
            }
            return data
        }
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
            const response = await fetch(`${apiPath}/room`, {
                headers: {
                    'Authorization': userData.id,
                    'Content-Type': 'application/json'
                }
            })
            if (!response.ok) {
                const errorText = await response.text()
                throw new Error(`Failed to fetch rooms: ${response.status}`)
            }
            const data = await response.json()
            rooms.value = data
            loading.value = false
            
            loading.value = false
        } catch (err) {
            error.value = err.message
            console.error('[RoomsStore] Error fetching rooms:', err)
            
            if (window.indexedDB) {
                try {
                    const { openDB } = await import('../../public/idb.js')
                    const db = await openDB()
                    const tx = db.transaction('roomsCache', 'readonly')
                    const store = tx.objectStore('roomsCache')
                    const req = store.getAll()
                    req.onsuccess = () => {
                        loading.value = false
                        rooms.value = req.result
                        error.value = null
                    }
                    req.onerror = () => {
                        loading.value = false
                    }
                } catch (e) {
                    loading.value = false
                }
            } else {
                loading.value = false
            }
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
            const response = await fetch(`${apiPath}/room/`, {
                method: 'DELETE',
                headers: {
                    'Authorization': userData.id,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({"roomId": roomId})
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

            
            const existingRoom = rooms.value.find(room => room.id === trimmedRoomId)
            if (existingRoom) {
                
                if (typeof window !== 'undefined') {
                    try {
                        const { usePushSubscription } = await import('../composables/usePushSubscription')
                        const { updateSubscription } = usePushSubscription()
                        await updateSubscription()
                    } catch (err) {
                    }
                }
                return existingRoom
            }

            const apiPath = config.public.apiPath
            if (!apiPath) {
                throw new Error('API path is not defined')
            }


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
            
            
            await fetchRooms()

            
            if (typeof window !== 'undefined') {
                try {
                    const { usePushSubscription } = await import('../composables/usePushSubscription')
                    const { updateSubscription } = usePushSubscription()
                    await updateSubscription()
                } catch (err) {
                }
            }

            return data
        } catch (err) {
            error.value = err.message
            throw err
        } finally {
            loading.value = false
        }
    }

    async function leaveRoom(roomId) {
        try {
            loading.value = true
            error.value = null

            const authStore = useAuthStore()
            const userData = authStore.getUserData()
            if (!userData) {
                throw new Error('User not authenticated')
            }

            const trimmedRoomId = roomId.trim()
            const apiPath = config.public.apiPath
            const response = await fetch(`${apiPath}/room/leave`, {
                method: 'POST',
                headers: {
                    'Authorization': userData.id,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ roomId: trimmedRoomId })
            })

            if (!response.ok) {
                let errorMessage = 'Failed to leave room'
                if (response.status === 404) {
                    errorMessage = 'Room not found'
                } else if (response.status === 403) {
                    errorMessage = 'Not authorized to leave this room'
                } else if (response.status >= 500) {
                    errorMessage = 'Server error. Please try again later.'
                }
                throw new Error(errorMessage)
            }

            const data = await response.json()
            
            
            if (typeof window !== 'undefined') {
                try {
                    const { usePushSubscription } = await import('../composables/usePushSubscription')
                    const { unsubscribe } = usePushSubscription()
                    await unsubscribe(trimmedRoomId)
                } catch (err) {
                }
            }
            
            
            await fetchRooms()

            return data
        } catch (err) {
            error.value = err.message
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
        leaveRoom,
        isOwner,
        clearRooms,
        getRoomDetails,
        deleteRoom, 
        createRoom,
        getRoomById,
        updateRoom
    }
})
