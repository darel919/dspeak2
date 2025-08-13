<template>
  <div class="bg-base-100 h-full flex flex-col p-4">
    <div class="text-base-content/60 text-sm mb-2">Online — {{ onlineMembersCount }}</div>
    <div v-if="!members || members.length === 0" class="text-center py-4 text-base-content/50">
      <p class="text-sm">It's lonely here...</p>
    </div>
    <div v-else class="flex flex-col gap-2">
      <div
        v-for="member in sortedMembers"
        :key="member.id"
        class="flex items-center gap-3 group relative"
        :style="getMemberPresenceStatus(member) === 'offline' && member.id !== currentUser?.id ? 'opacity: 0.3' : ''"
        @contextmenu.prevent="openVolumeMenu(member)"
      >
        <div class="avatar relative flex items-center" style="overflow: visible;">
          <div
            class="w-9 rounded-full relative"
            :class="getMemberPresenceStatus(member) === 'in-room' ? 'shadow-[0_0_0_2px_#06b6d4,0_0_0_4px_var(--b1)]' : ''"
            style="overflow: visible; margin-bottom: 4px;"
          >
            <img :src="getAvatarUrl(member.avatar)" :alt="member.name" class="block rounded-full" />
            <!-- Status dot at right bottom -->
            <span
              v-if="member.id === currentUser?.id && (getMemberPresenceStatus(member) === 'online' || getMemberPresenceStatus(member) === 'in-room')"
              class="absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-base-100 bg-success z-10"
            ></span>
            <span
              v-else-if="getMemberPresenceStatus(member) === 'online' && member.id !== currentUser?.id"
              class="absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-base-100 bg-success z-10"
            ></span>
            <span
              v-else-if="getMemberPresenceStatus(member) === 'in-room' && member.id !== currentUser?.id"
              class="absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-base-100 bg-info z-10"
            ></span>
          </div>
        </div>
        <!-- Name and owner icon -->
        <div class="flex items-center gap-1 text-base-content font-medium">
          <span class="text-sm font-bold">{{ member.name }}</span>
          <span v-if="isOwner(member)" class="ml-1" title="Room Owner">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4 text-accent">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m0-10.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.75c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.75h-.152c-3.196 0-6.1-1.25-8.25-3.286Zm0 13.036h.008v.008H12v-.008Z" />
            </svg>
          </span>
          <!-- Volume Control Context Menu -->
          <div v-if="volumeMenuUser && volumeMenuUser.id === member.id" class="absolute top-2 right-2 bg-base-200 border border-base-300 rounded-lg shadow-lg p-3 z-50 w-48">
            <div class="text-xs font-semibold mb-2">User Volume</div>
            <input type="range" min="0" max="1" step="0.01" :value="voiceStore.getUserVolume(member.id)" @input="onVolumeChange(member.id, $event)" class="w-full" />
            <div class="flex justify-between text-xs mt-1">
              <span>0%</span>
              <span>100%</span>
            </div>
            <button class="btn btn-xs btn-outline w-full mt-2" @click="closeVolumeMenu">Close</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useVoiceStore } from '../stores/voice'
const voiceStore = useVoiceStore()
const volumeMenuUser = ref(null)
function openVolumeMenu(member) {
  volumeMenuUser.value = member
}
function closeVolumeMenu() {
  volumeMenuUser.value = null
}
function onVolumeChange(userId, event) {
  voiceStore.setUserVolume(userId, Number(event.target.value))
}
import { useRuntimeConfig } from '#app'
import { useChatStore } from '../stores/chat'
import { useAuthStore } from '../stores/auth'

const props = defineProps({
  members: {
    type: Array,
    default: () => []
  },
  room: {
    type: Object,
    default: () => ({})
  },
  roomId: {
    type: String,
    default: ''
  },
  channelId: {
    type: String,
    default: ''
  }
})

const config = useRuntimeConfig()
const chatStore = useChatStore()
const authStore = useAuthStore()

const onlineUsers = computed(() => chatStore.onlineUsers || [])
const currentUser = computed(() => authStore.getUserData())

// Create a Set of online user IDs for faster lookup
const onlineUserIds = computed(() => new Set(onlineUsers.value.map(user => user.id)))

// Sort members by status: owner first, then online users, then offline users
const sortedMembers = computed(() => {
  if (!props.members) return []
  
  return [...props.members].sort((a, b) => {
    // Owner always first
    const aIsOwner = isOwner(a)
    const bIsOwner = isOwner(b)
    if (aIsOwner && !bIsOwner) return -1
    if (!aIsOwner && bIsOwner) return 1
    
    // Then sort by presence status
    const aStatus = getMemberPresenceStatus(a)
    const bStatus = getMemberPresenceStatus(b)
    
    const statusOrder = { 'in-room': 0, 'online': 1, 'offline': 2 }
    const aOrder = statusOrder[aStatus] || 2
    const bOrder = statusOrder[bStatus] || 2
    
    if (aOrder !== bOrder) return aOrder - bOrder
    
    // Finally sort alphabetically by name
    return (a.name || '').localeCompare(b.name || '')
  })
})

// Count online members
const onlineMembersCount = computed(() => {
  if (!props.members) return 0
  return props.members.filter(member => 
    onlineUserIds.value.has(member.id) || member.online === true
  ).length
})

// Count members currently in this room/channel

function getAvatarUrl(avatarPath) {
  if (!avatarPath) return '/favicon-32x32.png'
  
  if (avatarPath.startsWith('http')) return avatarPath
  
  const apiPath = config.public.baseApiPath
  return `${apiPath}/auth/${avatarPath}`
}

function isOwner(member) {
  return props.room?.owner?.id === member.id
}


function getMemberPresenceStatus(member) {
  // Check if user is currently in this room/channel (from chat websocket)
  if (onlineUsers.value.some(user => user.id === member.id)) {
    return 'in-room'
  }
  
  // Check if user is online (from member data or general online status)
  if (onlineUserIds.value.has(member.id) || member.online === true) {
    return 'online'
  }
  
  return 'offline'
}




</script>
