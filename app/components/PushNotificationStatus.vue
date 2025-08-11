<template>
  <div v-if="isSupported && showStatus" class="alert alert-info">
    <div class="flex items-center gap-2">
      <div v-if="loading" class="loading loading-spinner loading-sm"></div>
      <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
      
      <div class="flex-1">
        <div class="font-medium">
          {{ statusText }}
        </div>
        <div v-if="error" class="text-sm text-error mt-1">
          {{ error }}
        </div>
      </div>
      
      <div class="flex gap-2">
        <button 
          v-if="!isSubscribed && !loading" 
          @click="handleSubscribe"
          class="btn btn-sm btn-primary"
        >
          Enable Push
        </button>
        
        <button 
          v-if="isSubscribed && !loading" 
          @click="handleUnsubscribe"
          class="btn btn-sm btn-outline"
        >
          Disable Push
        </button>
        
        <button 
          @click="showStatus = false"
          class="btn btn-sm btn-ghost btn-square"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { usePushSubscription } from '../composables/usePushSubscription'
import { useToast } from '../composables/useToast'

const { isSupported, isSubscribed, loading, error, subscribe, unsubscribe } = usePushSubscription()
const { success, error: showError } = useToast()

const showStatus = ref(true)

const statusText = computed(() => {
  if (loading.value) return 'Managing push notifications...'
  if (isSubscribed.value) return 'Push notifications are active'
  return 'Push notifications are available'
})

async function handleSubscribe() {
  try {
    await subscribe()
    success('Push notifications enabled!')
  } catch (err) {
    showError('Failed to enable push notifications')
    console.error('Subscribe error:', err)
  }
}

async function handleUnsubscribe() {
  try {
    await unsubscribe()
    success('Push notifications disabled')
  } catch (err) {
    showError('Failed to disable push notifications')
    console.error('Unsubscribe error:', err)
  }
}

onMounted(() => {
  setTimeout(() => {
    if (showStatus.value && isSubscribed.value) {
      showStatus.value = false
    }
  }, 10000)
})
</script>
