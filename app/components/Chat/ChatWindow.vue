<template>
  <div v-if="!channel?.isMedia" class="flex flex-col h-full bg-base-100">
    <!-- Chat Header -->
    <div class="bg-base-200 border-base-300 p-4">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <button 
            v-if="showBackButton"
            @click="$emit('back')"
            class="btn btn-ghost btn-sm btn-circle"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          
          <div class="flex flex-col sm:flex-row items-start sm:items-center gap-0 sm:gap-3">
            <!-- Channel type indicator -->
            <span v-if="channel?.isMedia" class="badge badge-warning badge-sm rounded-xs">Voice Channel</span>
            <span v-else class="badge badge-info badge-sm rounded-xs">Text Channel</span>
            <p class="font-semibold text-md" :title="channel?.desc || 'No description'">
              #{{ channel?.name || 'Channel' }}
            </p>
            <p class="text-sm opacity-40">{{ room?.name || 'Room' }}</p>
          </div>
        </div>
        
        <div class="flex items-center gap-2">
          <!-- Online members count for channel -->
          <div v-if="channel?.inRoom" class="badge badge-ghost badge-sm">
            {{ channel.inRoom.length }} online
          </div>
          <!-- Room members count -->
          <!-- <div v-if="room?.members" class="badge badge-outline badge-sm">
            {{ room.members.length }} members
          </div> -->
        </div>
      </div>
    </div>

    <!-- Messages Container -->
    <div 
      ref="messagesContainer"
      class="flex-1 overflow-y-auto p-4 space-y-4"
      @scroll="handleScroll"
    >
      <!-- Loading indicator -->
      <div v-if="loading" class="flex justify-center py-8">
        <div class="loading loading-spinner loading-lg"></div>
      </div>

      <!-- Error message -->
      <div v-else-if="error" class="alert alert-error">
        <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div>
          <h3 class="font-bold">Error loading messages</h3>
          <div class="text-xs">{{ error }}</div>
        </div>
        <button class="btn btn-sm btn-outline" @click="refreshMessages">
          Retry
        </button>
      </div>

      <!-- Empty state -->
      <div v-else-if="messages.length === 0" class="text-center py-12">
        <div class="text-base-content/50 mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <p class="text-lg">No messages yet</p>
          <p class="text-sm">Start the conversation!</p>
        </div>
      </div>

      <!-- Messages -->
      <div v-else class="space-y-4">
        <ChatMessage 
          v-for="message in messages" 
          :key="message.id"
          :message="message"
          :room-members="room?.members || []"
          @message-read="handleMessageRead"
          @show-details="handleShowDetails"
        />
      </div>

      <!-- Scroll to bottom button -->
      <div 
        v-if="showScrollButton" 
        class="fixed bottom-20 right-6 z-10"
      >
        <button 
          @click="scrollToBottom"
          class="btn btn-circle btn-primary shadow-lg"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Chat Input -->
    <ChatInput 
      :channel-id="channelId"
      :connected="connected"
      :typing-users="typingUsers"
      @message-sent="handleMessageSent"
    />

    <!-- Message Details Modal -->
    <MessageDetailsModal 
      :show="showDetailsModal"
      :message="selectedMessage"
      @close="closeDetailsModal"
    />

  </div>
</template>

<script setup>
import { useChatStore } from '../../stores/chat'
import { useAuthStore } from '../../stores/auth'
import ChatMessage from './ChatMessage.vue'
import ChatInput from './ChatInput.vue'
import MessageDetailsModal from './MessageDetailsModal.vue'

const props = defineProps({
  channelId: {
    type: String,
    required: true
  },
  channel: {
    type: Object,
    default: null
  },
  room: {
    type: Object,
    default: null
  },
  showBackButton: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['back'])

const chatStore = useChatStore()
const router = useRouter()
const messagesContainer = ref(null)
const showScrollButton = ref(false)
const isNearBottom = ref(true)
const showDetailsModal = ref(false)
const selectedMessage = ref(null)
const authStore = useAuthStore()
const currentUserId = computed(() => authStore.getUserData()?.id)

// Computed properties
// Deduplicate: Only show pending if no sent version exists
const messages = computed(() => {
  const all = chatStore.messages
  const sentIds = new Set(all.filter(m => m.status !== 'pending').map(m => m.id))
  // If a sent message exists with same content, sender, and close timestamp, hide the pending
  return all.filter((msg, idx, arr) => {
    if (msg.status !== 'pending') return true
    // Find a sent message with same content, sender, and created within 10s
    return !arr.some(other =>
      other.status !== 'pending' &&
      other.sender?.id === msg.sender?.id &&
      other.content === msg.content &&
      Math.abs(new Date(other.created) - new Date(msg.created)) < 15000
    )
  })
})
const loading = computed(() => chatStore.loading)
const error = computed(() => chatStore.error)
const connected = computed(() => chatStore.connected)
const typingUsers = computed(() => chatStore.typingUsers)
const onlineUsers = computed(() => chatStore.onlineUsers)

// Helper function to get display name for a member
function getDisplayName(member) {
  if (member.id === currentUserId.value) return 'You'
  const onlineUserIds = new Set(onlineUsers.value.map(user => user.id))
  const isOnline = onlineUserIds.has(member.id)
  const firstName = member.name?.split(' ')[0] || member.name || 'Unknown'
  return isOnline ? `${firstName} (online)` : firstName
}

// Lifecycle
onMounted(async () => {
  await initializeChat()
})

onUnmounted(() => {
  chatStore.disconnectFromChannel()
})

// Watch for channel changes
watch(() => props.channelId, async (newChannelId, oldChannelId) => {
  if (newChannelId !== oldChannelId) {
    await initializeChat()
  }
})

// Watch for new messages to auto-scroll
watch(messages, () => {
  nextTick(() => {
    if (isNearBottom.value) {
      scrollToBottom()
    }
  })
}, { deep: true })

// Methods
async function initializeChat() {
  if (!props.channelId) return

  try {
    // Connect to WebSocket for real-time updates with channel name
    await chatStore.connectToChannel(props.channelId, props.channel?.name, props.room?.id)
    
    // Scroll to bottom after loading
    nextTick(() => {
      scrollToBottom()
    })
  } catch (error) {
    console.error('Failed to initialize chat:', error)
  }
}

function handleScroll() {
  if (!messagesContainer.value) return

  const { scrollTop, scrollHeight, clientHeight } = messagesContainer.value
  const scrollFromBottom = scrollHeight - scrollTop - clientHeight
  
  isNearBottom.value = scrollFromBottom < 100
  showScrollButton.value = scrollFromBottom > 200
}

function scrollToBottom() {
  if (!messagesContainer.value) return
  
  messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  isNearBottom.value = true
  showScrollButton.value = false
}

function handleMessageSent() {
  // Auto-scroll to bottom when user sends a message
  nextTick(() => {
    scrollToBottom()
  })
}

function handleMessageRead(messageId) {
  // Message read status is automatically updated via WebSocket
  console.log('Message marked as read:', messageId)
}

function handleShowDetails(message) {
  selectedMessage.value = message
  showDetailsModal.value = true
}

function closeDetailsModal() {
  showDetailsModal.value = false
  selectedMessage.value = null
}

function handleMessageClick(message) {
  // Legacy function - now handled by message actions
}

async function refreshMessages() {
  if (!props.channelId) return
  
  try {
    await chatStore.fetchMessages(props.channelId)
    nextTick(() => {
      scrollToBottom()
    })
  } catch (error) {
    console.error('Failed to refresh messages:', error)
  }
}



// No need for manual reconnect logic here; handled in chatStore
</script>
