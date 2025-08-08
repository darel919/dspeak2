<template>
  <div>
    <div v-if="!authChecked && !isAuthPage" class="flex items-center justify-center min-h-screen">
      <div class="text-center">
        <div class="loading loading-spinner loading-lg"></div>
        <p class="mt-4">Checking authentication...</p>
      </div>
    </div>
    <div v-else>
      <NotificationWarning v-if="authChecked && !isAuthPage && shouldShowNotificationWarning" />
      <slot :authenticated="isAuthenticated" />
    </div>
  </div>
</template>

<script setup>
import { useAuthStore } from '../stores/auth'
import { useRoomsStore } from '../stores/rooms'
import { useNotifications } from '../composables/useNotifications'
import NotificationWarning from './NotificationWarning.vue'

const authStore = useAuthStore()
const roomsStore = useRoomsStore()
const router = useRouter()
const route = useRoute()
const authChecked = ref(false)

const isAuthenticated = computed(() => {
  const token = localStorage.getItem('token')
  const userData = authStore.getUserData()
  const result = !!token && authChecked.value && userData
  console.log('[Init] isAuthenticated computed:', { 
    token: !!token, 
    authChecked: authChecked.value, 
    userData: !!userData, 
    result 
  })
  return result
})

const isAuthPage = computed(() => route.path === '/auth')

// Get notification composable for checking if we should show warning
const { isSupported, permission, isEnabled } = useNotifications()

// Only show notification warning when there are actual problems
const shouldShowNotificationWarning = computed(() => {
  if (!isSupported.value) return false
  
  // Show warning only if notifications are blocked/denied
  return permission.value === 'denied'
})

onMounted(async () => {
  // Only check auth if not on /auth page and token exists
  if (!isAuthPage.value && localStorage.getItem('token')) {
    await checkAuth()
    // Automatically request notification permission on app start if user is authenticated
    if (authChecked.value) {
      await requestNotificationPermissionAutomatically()
    }
  } else {
    authChecked.value = true
  }
  // Always send user ID to service worker on page load
  sendUserIdToServiceWorker()

})

function sendUserIdToServiceWorker() {
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    const userData = authStore.getUserData()
    if (userData && userData.id) {
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'SET_USER_ID', userId: userData.id })
        console.log('[Init] Sent user id to service worker controller:', userData.id)
      }
      if (navigator.serviceWorker.getRegistrations) {
        navigator.serviceWorker.getRegistrations().then(regs => {
          regs.forEach(reg => {
            if (reg.active) {
              reg.active.postMessage({ type: 'SET_USER_ID', userId: userData.id })
              console.log('[Init] Sent user id to SW registration:', userData.id)
            }
          })
        })
      }
      if (navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(reg => {
          if (reg.active) {
            reg.active.postMessage({ type: 'SET_USER_ID', userId: userData.id })
            console.log('[Init] Sent user id to SW ready registration:', userData.id)
          }
        })
      }
    }
  }
}

// Watch for authentication changes to fetch rooms
watch(() => authStore.getUserData(), async (userData) => {
  if (userData && !isAuthPage.value) {
    console.log('[Init] User authenticated, fetching rooms')
    await roomsStore.fetchRooms()
    // Also send user ID to service worker after login/auth
    sendUserIdToServiceWorker()
  }
})

watch(() => route.path, async () => {
  if (route.path !== '/auth' && !authChecked.value) {
    await checkAuth()
  }
})

async function requestNotificationPermissionAutomatically() {
  try {
    // Use notification manager for more reliable initialization
    const notificationManager = (await import('../utils/notificationManager')).default
    
    console.log('[Init] Notification manager state:', {
      supported: notificationManager.isSupported,
      permission: notificationManager.permission,
      enabled: notificationManager.isEnabled
    })
    
    // Automatically request permission if it's the first time (default state)
    if (notificationManager.isSupported && notificationManager.permission === 'default') {
      console.log('[Init] Requesting notification permission automatically')
      await notificationManager.requestPermission()
    }
  } catch (error) {
    console.error('Error requesting notification permission automatically:', error)
  }
}

async function checkAuth() {
  // Always skip auth check on auth page
  if (route.path === '/auth') {
    authChecked.value = true
    return
  }

  const savedToken = localStorage.getItem('token')

  if (savedToken) {
    const isValid = await authStore.verifyToken(savedToken)
    if (isValid) {
      authChecked.value = true
      // Fetch rooms after successful authentication
      await roomsStore.fetchRooms()
      return
    }
    authStore.clearAuth()
    // After logout, redirect to home, not /auth
    if (route.path !== '/') {
      router.push('/')
    }
    authChecked.value = true
    return
  }

  // Only redirect to /auth if user is trying to access a protected page
  if (route.path !== '/' && route.path !== '/auth') {
    router.push('/')
  }
  authChecked.value = true
}
</script>
