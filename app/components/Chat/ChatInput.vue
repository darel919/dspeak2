<template>
  <div class="bg-base-100 border-t border-base-200 p-4">
    <form @submit.prevent="handleSendMessage" class="flex gap-2">
      <div class="flex-1">
        <input
          v-model="messageText"
          type="text"
          placeholder="Type a message..."
          class="input input-bordered w-full"
          :disabled="!connected || sending"
          @input="handleTyping"
          @focus="handleFocus"
          @blur="handleBlur"
          maxlength="1000"
        />
      </div>
      <button
        type="submit"
        class="btn btn-primary"
        :disabled="!messageText.trim() || !connected || sending"
        :class="{ 'loading': sending }"
      >
        <svg 
          v-if="!sending"
          xmlns="http://www.w3.org/2000/svg" 
          class="h-5 w-5" 
          fill="none" 
          viewBox="0 0 24 24" 
          stroke="currentColor"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
        </svg>
        {{ sending ? '' : 'Send' }}
      </button>
    </form>
    
    <!-- Typing indicators -->
    <div v-if="typingUsers.length > 0" class="mt-2 text-xs text-base-content/60">
      <div class="flex items-center gap-2">
        <div class="flex space-x-1">
          <div class="w-1 h-1 bg-primary rounded-full animate-bounce"></div>
          <div class="w-1 h-1 bg-primary rounded-full animate-bounce" style="animation-delay: 0.1s"></div>
          <div class="w-1 h-1 bg-primary rounded-full animate-bounce" style="animation-delay: 0.2s"></div>
        </div>
        <span>
          {{ getTypingText() }}
        </span>
      </div>
    </div>
    
    <!-- Connection status -->
    <div v-if="!connected" class="mt-2 text-xs text-error">
      <div class="flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636m12.728 12.728L18.364 5.636M5.636 18.364l12.728-12.728" />
        </svg>
        <span>Disconnected - messages cannot be sent</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useChatStore } from '../../stores/chat'

const props = defineProps({
  roomId: {
    type: String,
    required: true
  },
  connected: {
    type: Boolean,
    default: false
  },
  typingUsers: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['message-sent'])

const chatStore = useChatStore()
const messageText = ref('')
const sending = ref(false)
const isTyping = ref(false)
const typingTimeout = ref(null)

async function handleSendMessage() {
  if (!messageText.value.trim() || !props.connected || sending.value) {
    return
  }

  const content = messageText.value.trim()
  sending.value = true

  try {
    await chatStore.sendMessage(props.roomId, content)
    messageText.value = ''
    
    // Stop typing indicator when message is sent
    if (isTyping.value) {
      chatStore.sendTypingIndicator(false)
      isTyping.value = false
    }
    
    emit('message-sent')
  } catch (error) {
    console.error('Failed to send message:', error)
  } finally {
    sending.value = false
  }
}

function handleTyping() {
  if (!props.connected) return

  // Send typing indicator if not already typing
  if (!isTyping.value) {
    isTyping.value = true
    chatStore.sendTypingIndicator(true)
  }

  // Reset typing timeout
  if (typingTimeout.value) {
    clearTimeout(typingTimeout.value)
  }

  // Stop typing indicator after 3 seconds of inactivity
  typingTimeout.value = setTimeout(() => {
    if (isTyping.value) {
      isTyping.value = false
      chatStore.sendTypingIndicator(false)
    }
  }, 3000)
}

function handleFocus() {
  // Mark latest messages as read when user focuses on input
  // This will be implemented when we add read receipt functionality
}

function handleBlur() {
  // Stop typing indicator when input loses focus
  if (isTyping.value) {
    isTyping.value = false
    chatStore.sendTypingIndicator(false)
  }
  
  if (typingTimeout.value) {
    clearTimeout(typingTimeout.value)
  }
}

function getTypingText() {
  const count = props.typingUsers.length
  if (count === 0) return ''
  
  if (count === 1) {
    return 'Someone is typing...'
  } else if (count === 2) {
    return '2 people are typing...'
  } else {
    return `${count} people are typing...`
  }
}

// Cleanup on unmount
onUnmounted(() => {
  if (typingTimeout.value) {
    clearTimeout(typingTimeout.value)
  }
  
  if (isTyping.value) {
    chatStore.sendTypingIndicator(false)
  }
})
</script>

<style scoped>
@keyframes bounce {
  0%, 80%, 100% {
    transform: translateY(0);
  }
  40% {
    transform: translateY(-5px);
  }
}

.animate-bounce {
  animation: bounce 1.4s infinite;
}
</style>
