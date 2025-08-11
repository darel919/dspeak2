<template>
  <div class="min-h-screen-minus-navbar max-w-lg mx-auto pt-20 px-6">
    <h1 class="text-2xl font-bold mb-6">Your Account</h1>
    <section class="mb-8">
      <h2 class="text-lg font-semibold mb-3">Profile</h2>
      <div v-if="profile" class="flex items-center gap-4 mb-6">
        <div class="avatar avatar-online select-none pointer-events-none">
          <div class="w-16 rounded-full">
            <img :src="profile.avatar" alt="User avatar" />
          </div>
        </div>
        <div>
          <p class="text-lg font-bold">{{ profile.name }}</p>
          <p class="text-sm text-base-content/60">{{ profile.email }}</p>
        </div>
      </div>
      <div v-else class="mb-6 text-error">No profile data available.</div>
      <button class="btn btn-error w-full" @click="handleLogout">Logout</button>
    </section>
  </div>
</template>

<script setup>
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()
const router = useRouter()

import { useRuntimeConfig } from '#app'
const config = useRuntimeConfig()
import { useChatUtils } from '../composables/useChatUtils'
const { getAvatarUrl } = useChatUtils()

const profile = computed(() => {
  const user = authStore.getUserData()
  if (!user) return null
  // Patch avatar URL if needed
  return {
    ...user,
    avatar: getAvatarUrl(user.avatar, config.public.baseApiPath)
  }
})

async function handleLogout() {
  authStore.clearAuth()
  // Ensure localStorage is cleared before navigation
  await nextTick()
  router.push('/')
}
</script>
