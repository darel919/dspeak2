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
    
    <div class="chat-header flex items-center">
      <span v-if="!isOwnMessage">{{ message.sender.name }}</span>
  <time class="text-xs opacity-50 ml-1 pb-1">{{ formatChatDisplayTime(message.created) }}</time>
      <!-- Message Actions: always render, but toggle visibility -->
      <div
  class="ml-2 min-w-[32px] min-h-[32px] flex items-center justify-center"
        :class="isOwnMessage ? 'order-first mr-2 ml-0' : ''"
        style="transition:opacity 0.15s;"
      >
        <div :style="showActions ? 'opacity:1;pointer-events:auto;' : 'opacity:0;pointer-events:none;'">
          <MessageActions 
            :message="message"
            @mark-read="handleMarkRead"
            @show-details="handleShowDetails"
          />
        </div>
      </div>
    </div>
    
    <div 
      v-if="typeof message.content === 'string'"
      class="chat-bubble" 
      :class="isOwnMessage ? 'chat-bubble-primary' : 'chat-bubble-secondary'"
      style="white-space: pre-wrap; word-break: break-word;"
    >
      {{ message.content }}
    </div>
    <div v-else class="chat-bubble chat-bubble-secondary opacity-50 italic">
      [Unsupported message type]
    </div>
    
  <div v-if="isPending || (isOwnMessage ? hasBeenReadByOthers : isRead)" class="chat-footer opacity-50">

      <div class="flex items-center gap-1 text-xs">
        <template v-if="isPending">
          <svg 
            xmlns="http://www.w3.org/2000/svg" 
            class="h-6 w-6 text-warning animate-spin" 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </template>
        <template v-else>
          <span v-if="isOwnMessage && props.roomMembers && getStatusText() === 'Read by all'" style="position: relative; display: inline-block; width: 16px; height: 14px;">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="size-4">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>

          </span>
          <svg v-else
            xmlns="http://www.w3.org/2000/svg" 
            class="h-4 w-4 text-info" 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
        </template>
        <span>{{ getStatusText() }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
const hasBeenReadByOthers = computed(() => {
  if (!isOwnMessage.value || !props.message.read_by) return false
  const readBy = Array.isArray(props.message.read_by) ? [...new Set(props.message.read_by)] : []
  return readBy.some(id => id !== props.message.sender.id)
})

import { useAuthStore } from '../../stores/auth'
import { useChatStore } from '../../stores/chat'
import { useRuntimeConfig } from '#app'
import MessageActions from './MessageActions.vue'
import { useChatUtils } from '../../composables/useChatUtils'

const { formatChatDisplayTime } = useChatUtils()

const props = defineProps({
  message: {
    type: Object,
    required: true
  },
  roomMembers: {
    type: Array,
    default: () => []
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
  const readBy = Array.isArray(props.message.read_by) ? [...new Set(props.message.read_by)] : []
  if (isOwnMessage.value) {
    // Only show as read if at least one id in readBy is not the sender
    const others = readBy.filter(id => id !== props.message.sender.id)
    return others.length > 0
  }
  // For other messages, check if current user has read it (and is not the sender)
  return readBy.includes(userData.id) && userData.id !== props.message.sender.id
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
  const userData = authStore.getUserData()
  if (!userData) return 'Sent'
  let readBy = Array.isArray(props.message.read_by) ? props.message.read_by : []
  readBy = readBy.map(entry => typeof entry === 'object' && entry !== null ? entry.id : entry)
  const isOwn = isOwnMessage.value
  if (isOwn) {
    const others = readBy.filter(id => id && id !== props.message.sender.id)
    const totalOthers = props.roomMembers.filter(m => m.id !== props.message.sender.id).length
    if (others.length === 0) return ''
    if (totalOthers > 0 && others.length === totalOthers) return `Read by all`
    return `Read by ${others.length}`
  } else {
    if (readBy.includes(userData.id) && userData.id !== props.message.sender.id) {
      return 'Read'
    }
    return ''
  }
}

function getAvatarUrl(avatarPath) {
  if (!avatarPath) return '/favicon-32x32.png'
  
  if (avatarPath.startsWith('http')) return avatarPath
  
  const apiPath = config.public.apiPath
  return `${apiPath}/files/${avatarPath}`
}
</script>
