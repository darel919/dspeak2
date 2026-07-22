<template>
  <div v-if="error" class="alert alert-warning flex items-center justify-between mb-2">
    <div class="flex items-center gap-3">
      <Icon name="lucide:ban" class="h-5 w-5" />
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

