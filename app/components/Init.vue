<template>
  <div v-if="!authChecked && !isAuthPage" class="flex items-center justify-center min-h-screen">
    <div class="text-center">
      <div class="loading loading-spinner loading-lg"></div>
      <p class="mt-4">Checking authentication...</p>
    </div>
  </div>
  <slot v-else />
</template>

<script setup>
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()
const router = useRouter()
const route = useRoute()
const authChecked = ref(false)

const isAuthPage = computed(() => route.path === '/auth')

onMounted(async () => {
  await checkAuth()
})

watch(() => route.path, async () => {
  if (route.path !== '/auth' && !authChecked.value) {
    await checkAuth()
  }
})

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
      return
    }
    authStore.clearAuth()
  }
  
  // Only redirect if not already on auth page
  if (route.path !== '/auth') {
    router.push('/auth')
  }
  
  authChecked.value = true
}
</script>
