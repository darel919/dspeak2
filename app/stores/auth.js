import { defineStore } from "pinia";
import { useRuntimeConfig } from '#app'

export const useAuthStore = defineStore('auths', () => {
    const user = ref(null)
    const token = ref(null)
    const config = useRuntimeConfig()

    function setUser(val) {
        console.log('[AuthStore] Setting user:', val)
        user.value = val
    }
    function setToken(val) {
        token.value = val
    }
    async function verifyToken(val) {
        try {
            const authPath = config.public.authPath
            if (!authPath) {
                throw new Error('Auth path is not defined')
            }
            const verifyUrl = `${authPath}/verify?at=${encodeURIComponent(val)}`
            console.log('[AuthStore] Verifying token at:', verifyUrl)
            const res = await fetch(verifyUrl)
            console.log('[AuthStore] Response status:', res.status)
            if (!res.ok) {
                const errorText = await res.text()
                console.error('[AuthStore] Token verification failed:', res.status, errorText)
                throw new Error(`Invalid token: ${res.status}`)
            }
            const data = await res.json()
            console.log('[AuthStore] Token verification successful, user data:', data)
            setUser(data)
            return true
        } catch (error) {
            console.error('[AuthStore] Token verification error:', error)
            setToken(null)
            setUser(null)
            localStorage.removeItem('token')
            return false
        }
    }
    function saveToken(val) {
        console.log('[AuthStore] Saving token:', val)
        setToken(val)
        localStorage.setItem('token', val)
    }
    function clearAuth() {
        setToken(null)
        setUser(null)
        localStorage.removeItem('token')
        
        // Import stores dynamically to avoid circular dependency
        Promise.all([
            import('./rooms.js').then(({ useRoomsStore }) => {
                const roomsStore = useRoomsStore()
                if (roomsStore) {
                    roomsStore.clearRooms()
                }
            }).catch(() => {}),
            import('./chat.js').then(({ useChatStore }) => {
                const chatStore = useChatStore()
                if (chatStore) {
                    chatStore.clearChat()
                }
            }).catch(() => {})
        ])
    }
    function getUserData() {
        return user.value ? user.value.user.user_metadata : null
    }
    return { user, token, setUser, setToken, verifyToken, saveToken, clearAuth, getUserData }
})