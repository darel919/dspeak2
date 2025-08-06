<template>
  <div class="dropdown dropdown-end">
    <label tabindex="0" class="btn btn-ghost btn-xs btn-circle">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01" />
      </svg>
    </label>
    
    <ul tabindex="0" class="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-52">
      <!-- <li v-if="!isOwnMessage">
        <button @click="handleMarkAsRead" :disabled="isRead">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
          {{ isRead ? 'Already read' : 'Mark as read' }}
        </button>
      </li>
       -->
      <li>
        <button @click="handleCopyMessage">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          Copy message
        </button>
      </li>
      
      <!-- <li>
        <button @click="handleReportMessage">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          Report message
        </button>
      </li>
       -->
      <div class="divider my-1"></div>
      
      <li>
        <button @click="handleViewDetails">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Message details
        </button>
      </li>
    </ul>
  </div>
</template>

<script setup>
import { useChatStore } from '../../stores/chat'
import { useAuthStore } from '../../stores/auth'

const props = defineProps({
  message: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['mark-read', 'show-details'])

const chatStore = useChatStore()
const authStore = useAuthStore()

const isOwnMessage = computed(() => {
  const userData = authStore.getUserData()
  return userData && props.message.sender.id === userData.id
})

const isRead = computed(() => {
  const userData = authStore.getUserData()
  if (!userData) return false
  
  return props.message.read_by && props.message.read_by.includes(userData.id)
})

async function handleMarkAsRead() {
  if (isRead.value || isOwnMessage.value) return
  
  try {
    await chatStore.markMessageAsRead(props.message.id)
    emit('mark-read', props.message.id)
  } catch (error) {
    console.error('Failed to mark message as read:', error)
  }
}

async function handleCopyMessage() {
  try {
    await navigator.clipboard.writeText(props.message.content)
    // You could show a toast notification here
    console.log('Message copied to clipboard')
  } catch (error) {
    console.error('Failed to copy message:', error)
  }
}

function handleReportMessage() {
  // Implement reporting functionality
  console.log('Report message:', props.message.id)
  // You could open a modal or navigate to a report page
}

function handleViewDetails() {
  emit('show-details', props.message)
}
</script>
