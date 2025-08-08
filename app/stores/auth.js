import { defineStore } from "pinia";
import { useRuntimeConfig } from '#app'

export const useAuthStore = defineStore('auths', () => {
    const user = ref(null)
    const token = ref(null)
    const config = useRuntimeConfig()

    function setUser(val) {
        console.log('[AuthStore] Setting user:', val)
        user.value = val
        // Sync user metadata to localStorage for notificationManager
        if (typeof window !== 'undefined') {
            if (val && val.user && val.user.user_metadata) {
                localStorage.setItem('userData', JSON.stringify(val.user.user_metadata));
            } else {
                localStorage.removeItem('userData');
            }
        }
        // Send user id to service worker for notification filtering
        if (typeof window !== 'undefined' && navigator.serviceWorker && val && val.user && val.user.user_metadata && val.user.user_metadata.id) {
            // Always try to send to all service worker clients, not just controller
            const userId = val.user.user_metadata.id;
            if (navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({ type: 'SET_USER_ID', userId });
                console.log('[AuthStore] Posted user id to service worker controller:', userId);
            }
            if (navigator.serviceWorker.getRegistrations) {
                navigator.serviceWorker.getRegistrations().then(regs => {
                    regs.forEach(reg => {
                        if (reg.active) {
                            reg.active.postMessage({ type: 'SET_USER_ID', userId });
                            console.log('[AuthStore] Posted user id to SW registration:', userId);
                        }
                    });
                });
            }
            if (navigator.serviceWorker.ready) {
                navigator.serviceWorker.ready.then(reg => {
                    if (reg.active) {
                        reg.active.postMessage({ type: 'SET_USER_ID', userId });
                        console.log('[AuthStore] Posted user id to SW ready registration:', userId);
                    }
                });
            }
        }
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
        localStorage.removeItem('userData')
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