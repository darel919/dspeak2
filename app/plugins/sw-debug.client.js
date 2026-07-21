import { watch } from 'vue'

export default defineNuxtPlugin(async (nuxtApp) => {
  if (!('serviceWorker' in navigator)) return

  try {
    const registration = await navigator.serviceWorker.getRegistration()
    if (!registration) await navigator.serviceWorker.register('/sw.js')

    const { useAuthStore } = await import('../stores/auth')
    const authStore = useAuthStore()
    const stopAuthWatcher = watch(
      () => authStore.getUserData()?.id,
      async (id) => {
        if (!id) return
        try {
          const { usePushSubscription } = await import('../composables/usePushSubscription')
          await usePushSubscription().updateSubscription()
        } catch (error) {
          console.error('[PushSubscription] Refresh failed:', error)
        }
      },
      { immediate: true }
    )

    nuxtApp.hook('app:beforeUnmount', stopAuthWatcher)
  } catch (error) {
    console.error('[ServiceWorker] Initialization failed:', error)
  }
})
