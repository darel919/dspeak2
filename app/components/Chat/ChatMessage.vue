<template>
  <div 
    ref="messageElement"
    class="chat" 
    :class="isOwnMessage ? 'chat-end' : 'chat-start'" 
    @mouseenter="showActions = true" 
    @mouseleave="showActions = false"
  >
    <div v-if="message.sender.id != authStore.getUserData()?.id" class="chat-image avatar">
      <div class="w-10 rounded-full">
        <img :src="getAvatarUrl(message.sender.avatar)" :alt="message.sender.name" />
      </div>
    </div>
    
    <div class="chat-header">
      {{ isOwnMessage ? null : message.sender.name }}
      <time class="text-xs opacity-50 ml-1 pb-1">{{ formatTime(message.created) }}</time>
      
      <!-- Message Actions -->
      <div 
        v-if="showActions" 
        class="inline-block ml-2"
        :class="isOwnMessage ? 'order-first mr-2 ml-0' : ''"
      >
        <MessageActions 
          :message="message"
          @mark-read="handleMarkRead"
          @show-details="handleShowDetails"
        />
      </div>
    </div>
    
    <div 
      class="chat-bubble" 
      :class="isOwnMessage ? 'chat-bubble-primary' : 'chat-bubble-secondary'"
    >
      {{ message.content }}
    </div>
    
    <div v-if="showReadStatus || isPending" class="chat-footer opacity-50">
      <div class="flex items-center gap-1 text-xs">
        <svg 
          v-if="isPending"
          xmlns="http://www.w3.org/2000/svg" 
          class="h-3 w-3 text-warning animate-spin" 
          fill="none" 
          viewBox="0 0 24 24" 
          stroke="currentColor"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        <svg 
          v-else-if="isRead" 
          xmlns="http://www.w3.org/2000/svg" 
          class="h-3 w-3 text-primary" 
          fill="none" 
          viewBox="0 0 24 24" 
          stroke="currentColor"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
        </svg>
        <svg 
          v-else 
          xmlns="http://www.w3.org/2000/svg" 
          class="h-3 w-3 text-base-content/30" 
          fill="none" 
          viewBox="0 0 24 24" 
          stroke="currentColor"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>{{ getStatusText() }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useAuthStore } from '../../stores/auth'
import { useChatStore } from '../../stores/chat'
import { useRuntimeConfig } from '#app'
import MessageActions from './MessageActions.vue'

const props = defineProps({
  message: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['message-read', 'show-details'])

const authStore = useAuthStore()
const chatStore = useChatStore()
const config = useRuntimeConfig()
const showActions = ref(false)
const messageElement = ref(null)

const isOwnMessage = computed(() => {
  const userData = authStore.getUserData()
  return userData && props.message.sender.id === userData.id
})

const isPending = computed(() => {
  return props.message.status === 'pending'
})

const showReadStatus = computed(() => {
  return isOwnMessage.value && !isPending.value
})

const isRead = computed(() => {
  const userData = authStore.getUserData()
  if (!userData || !props.message.read_by) return false
  
  // For own messages, check if anyone else has read it
  if (isOwnMessage.value) {
    return props.message.read_by.some(readBy => readBy !== userData.id)
  }
  
  // For other messages, check if current user has read it
  return props.message.read_by.includes(userData.id)
})

const shouldAutoMarkAsRead = computed(() => {
  const userData = authStore.getUserData()
  if (!userData || isOwnMessage.value) return false
  
  // Check if current user hasn't read this message yet
  return !props.message.read_by || !props.message.read_by.includes(userData.id)
})

// Intersection Observer for auto-marking messages as read
onMounted(() => {
  if (shouldAutoMarkAsRead.value && messageElement.value) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && shouldAutoMarkAsRead.value) {
            // Mark message as read after it's been visible for 1 second
            setTimeout(() => {
              if (entry.isIntersecting && shouldAutoMarkAsRead.value) {
                markAsRead()
              }
            }, 1000)
          }
        })
      },
      { threshold: 0.5 } // Message needs to be 50% visible
    )
    
    observer.observe(messageElement.value)
    
    // Cleanup
    onUnmounted(() => {
      observer.disconnect()
    })
  }
})

async function markAsRead() {
  try {
    await chatStore.markMessageAsRead(props.message.id)
    emit('message-read', props.message.id)
  } catch (error) {
    console.error('Failed to mark message as read:', error)
  }
}

function handleMarkRead(messageId) {
  emit('message-read', messageId)
}

function handleShowDetails(message) {
  emit('show-details', message)
}

function getStatusText() {
  if (isPending.value) {
    return 'Pending'
  }
  return getReadStatus()
}

function getReadStatus() {
  const userData = authStore.getUserData()
  if (!userData) return 'Sent'
  
  if (!props.message.read_by || props.message.read_by.length === 0) {
    return 'Sent'
  }
  
  // Count how many people have read it (excluding sender)
  const readCount = props.message.read_by.filter(id => id !== props.message.sender.id).length
  
  if (readCount === 0) {
    return 'Sent'
  } else if (readCount === 1) {
    return 'Read'
  } else {
    return `Read by ${readCount}`
  }
}

function formatTime(dateString) {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now - date
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) {
    return 'Just now'
  } else if (diffMins < 60) {
    return `${diffMins}m ago`
  } else if (diffHours < 24) {
    return `${diffHours}h ago`
  } else if (diffDays < 7) {
    return `${diffDays}d ago`
  } else {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }
}

function getAvatarUrl(avatarPath) {
  if (!avatarPath) return '/favicon-32x32.png'
  
  if (avatarPath.startsWith('http')) return avatarPath
  
  const apiPath = config.public.apiPath
  return `${apiPath}/files/${avatarPath}`
}
</script>
