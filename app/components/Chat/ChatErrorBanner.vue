<template>
  <div v-if="error" class="alert alert-warning flex items-center justify-between mb-2">
    <div class="flex items-center gap-3">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636" />
      </svg>
      <div>
        <div class="font-semibold text-sm">Real-time connection issue</div>
        <div class="text-xs opacity-60">{{ error }}</div>
      </div>
    </div>

    <div class="flex items-center gap-2">
      <button class="btn btn-sm btn-outline" @click="retry">Retry</button>
      <button class="btn btn-sm btn-ghost" @click="dismiss">Dismiss</button>
    </div>
  </div>
</template>

<script setup>
import { useChatStore } from '../../stores/chat'
import { useAuthStore } from '../../stores/auth'
import { toRef } from 'vue'

const props = defineProps({
  channelId: { type: String, required: true },
  channelName: { type: String, default: null },
  roomId: { type: String, default: null }
})

const chatStore = useChatStore()
const authStore = useAuthStore()
const error = toRef(chatStore, 'error')

async function retry() {
  if (!props.channelId) return
  chatStore.error = null
  // If we have a token, attempt to verify it first
  try {
    const token = authStore.token
    if (token) {
      const ok = await authStore.verifyToken(token)
      if (!ok) {
        console.warn('[ChatErrorBanner] Token verify failed, aborting reconnect')
        return
      }
    }
  } catch (e) {
    console.warn('[ChatErrorBanner] Error verifying token before retry', e)
  }

  chatStore.connectToChannel(props.channelId, props.channelName, props.roomId)
}

function dismiss() {
  chatStore.error = null
}
</script>

<style scoped>
/* minimal styling handled by Tailwind / DaisyUI in parent */
</style>
