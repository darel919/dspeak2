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
        <Icon name="lucide:send" class="size-6" />
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
        <Icon name="lucide:ban" class="h-3 w-3" />
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
        console.debug('Message queued for background sync')
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

  const maxHeight = 3 * 2.1 + 0.8
  el.style.height = Math.min(el.scrollHeight, maxHeight * 16) + 'px'
}

watch(messageText, () => nextTick(() => adjustTextareaHeight()))

function handleTyping() {
  if (!props.connected) return


  if (!isTyping.value) {
    isTyping.value = true
    chatStore.sendTypingIndicator(true)
  }


  if (typingTimeout.value) {
    clearTimeout(typingTimeout.value)
  }


  typingTimeout.value = setTimeout(() => {
    if (isTyping.value) {
      isTyping.value = false
      chatStore.sendTypingIndicator(false)
    }
  }, 3000)
}

function handleKeydown(event) {

  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    handleSendMessage()
  }

}

function handleFocus() {


}

function handleBlur() {

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
  console.debug('[ChatInput] Manual sync triggered');
  chatStore.triggerManualSync();
}


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
