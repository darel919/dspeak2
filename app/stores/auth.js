import { defineStore } from "pinia";
import { useRuntimeConfig } from '#app'

export const useAuthStore = defineStore('auths', () => {
    const user = ref(null)
    const token = ref(null)
    const config = useRuntimeConfig()

    function writeStorage(key, value) {
        if (!import.meta.client) return
        try {
            localStorage.setItem(key, value)
        } catch (error) {
            console.warn(`[Auth] Could not persist ${key}:`, error)
        }
    }

    function removeStorage(key) {
        if (!import.meta.client) return
        try {
            localStorage.removeItem(key)
        } catch (error) {
            console.warn(`[Auth] Could not remove ${key}:`, error)
        }
    }

    function setUser(val) {
        user.value = val
        if (val?.user?.user_metadata) {
            writeStorage('userData', JSON.stringify(val.user.user_metadata))
        } else {
            removeStorage('userData')
        }
        if (typeof window !== 'undefined' && navigator.serviceWorker && val && val.user && val.user.user_metadata && val.user.user_metadata.id) {
            const userId = val.user.user_metadata.id;
            if (navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({ type: 'SET_USER_ID', userId });
            }
            if (navigator.serviceWorker.getRegistrations) {
                navigator.serviceWorker.getRegistrations().then(regs => {
                    regs.forEach(reg => {
                        if (reg.active) {
                            reg.active.postMessage({ type: 'SET_USER_ID', userId });
                        }
                    });
                });
            }
            if (navigator.serviceWorker.ready) {
                navigator.serviceWorker.ready.then(reg => {
                    if (reg.active) {
                        reg.active.postMessage({ type: 'SET_USER_ID', userId });
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
            const res = await fetch(verifyUrl)
            if (!res.ok) {
                await res.text()
                throw new Error(`Invalid token: ${res.status}`)
            }
            const data = await res.json()
            setUser(data)
            return true
        } catch (error) {
            setToken(null)
            setUser(null)
            removeStorage('token')
            return false
        }
    }
    function saveToken(val) {
        setToken(val)
        writeStorage('token', val)
    }
    function clearAuth() {
        setToken(null)
        setUser(null)
        removeStorage('token')
        removeStorage('userData')
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
        return user.value?.user?.user_metadata || null
    }
    return { user, token, setUser, setToken, verifyToken, saveToken, clearAuth, getUserData }
})
