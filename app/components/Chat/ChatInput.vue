<template>
  <div class="bg-base-100 border-t border-base-200 p-4">
    <form @submit.prevent="handleSendMessage" class="flex gap-2">
      <div class="flex-1">
        <textarea
          v-model="messageText"
          ref="chatTextarea"
          placeholder="Type a message..."
          class="textarea textarea-bordered w-full resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 min-h-[2.5rem] max-h-[6.5rem] overflow-y-auto"
          @input="handleTextareaInput"
          @focus="handleFocus"
          @blur="handleBlur"
          @keydown="handleKeydown"
          maxlength="1000"
          rows="1"
          autocomplete="off"
          spellcheck="false"
        ></textarea>
      </div>
      <button
        type="submit"
        class="btn btn-primary"
  :disabled="!messageText.trim()"

      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
        </svg>
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
    <div v-if="!connected" class="mt-2 text-xs text-warning">
      <div class="flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636m12.728 12.728L18.364 5.636M5.636 18.364l12.728-12.728" />
        </svg>
        <span>We're offline</span>
        <button @click="triggerSync" class="btn btn-xs btn-outline btn-warning ml-2">
          Sync Now
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useChatStore } from '../../stores/chat'

const props = defineProps({
  channelId: {
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

const isTyping = ref(false)
const typingTimeout = ref(null)

const chatTextarea = ref(null)
onMounted(() => {
  nextTick(() => {
    if (chatTextarea.value) {
      chatTextarea.value.focus()
    }
  })
})

async function handleSendMessage() {
  if (!messageText.value.trim()) {
    return
  }
  let content = messageText.value.trim()
  if (typeof content !== 'string') {
    messageText.value = ''
    return
  }
  messageText.value = ''
  nextTick(() => adjustTextareaHeight())
  if (isTyping.value) {
    chatStore.sendTypingIndicator(false)
    isTyping.value = false
  }
  chatStore.sendMessage(props.channelId, content)
    .then(result => {
      if (result.status && result.status.includes('queued')) {
        console.log('Message queued for background sync')
      }
      emit('message-sent')
    })
    .catch(error => {
      console.error('Failed to send message:', error)
    })
}

function handleTextareaInput(e) {
  handleTyping()
  adjustTextareaHeight()
}

function adjustTextareaHeight() {
  const el = chatTextarea.value
  if (!el) return
  el.style.height = 'auto'
  // 3 lines max, line-height: 2.1rem (from daisyUI textarea), padding included
  const maxHeight = 3 * 2.1 + 0.8 // 3 lines * line-height + padding fudge
  el.style.height = Math.min(el.scrollHeight, maxHeight * 16) + 'px'
}

watch(messageText, () => nextTick(() => adjustTextareaHeight()))

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

function handleKeydown(event) {
  // Enter without shift sends message
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    handleSendMessage()
  }
  // Enter with shift allows multiline (default behavior)
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

function triggerSync() {
  console.log('[ChatInput] Manual sync triggered');
  chatStore.triggerManualSync();
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
