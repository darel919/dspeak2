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
        @contextmenu.prevent="openVolumeMenu(member, $event)"
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
            <Icon name="lucide:shield-alert" class="w-4 h-4 text-accent" />
          </span>
        </div>
      </div>
    </div>
    <Teleport to="body">
      <div
        v-if="volumeMenuUser"
        ref="volumeMenuElement"
        class="fixed z-[100] w-48 rounded-lg border border-base-300 bg-base-200 p-3 text-base-content opacity-100 shadow-lg"
        :style="volumeMenuStyle"
        role="dialog"
        aria-label="User volume control"
        @pointerdown.stop
        @contextmenu.prevent.stop
      >
        <div class="mb-2 text-xs font-semibold">User Volume</div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="voiceStore.getUserVolume(volumeMenuUser.id)"
          class="w-full"
          :aria-label="`Volume for ${volumeMenuUser.name}`"
          @input="onVolumeChange(volumeMenuUser.id, $event)"
        />
        <div class="mt-1 flex justify-between text-xs">
          <span>0%</span>
          <span>100%</span>
        </div>
        <button class="btn btn-xs btn-outline mt-2 w-full" @click="closeVolumeMenu">Close</button>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { useVoiceStore } from '../stores/voice'
const voiceStore = useVoiceStore()
const volumeMenuUser = ref(null)
const volumeMenuElement = ref(null)
const volumeMenuPosition = ref({ x: 0, y: 0 })
const volumeMenuStyle = computed(() => ({
  left: `${volumeMenuPosition.value.x}px`,
  top: `${volumeMenuPosition.value.y}px`
}))

async function openVolumeMenu(member, event) {
  volumeMenuUser.value = member
  volumeMenuPosition.value = { x: event.clientX, y: event.clientY }
  await nextTick()
  keepVolumeMenuInViewport()
}
function closeVolumeMenu() {
  volumeMenuUser.value = null
}
function onVolumeChange(userId, event) {
  voiceStore.setUserVolume(userId, Number(event.target.value))
}

function keepVolumeMenuInViewport() {
  if (!volumeMenuElement.value) return

  const viewportPadding = 8
  const { width, height } = volumeMenuElement.value.getBoundingClientRect()
  volumeMenuPosition.value = {
    x: Math.max(viewportPadding, Math.min(volumeMenuPosition.value.x, window.innerWidth - width - viewportPadding)),
    y: Math.max(viewportPadding, Math.min(volumeMenuPosition.value.y, window.innerHeight - height - viewportPadding))
  }
}

function onDocumentKeydown(event) {
  if (event.key === 'Escape') closeVolumeMenu()
}

onMounted(() => {
  document.addEventListener('pointerdown', closeVolumeMenu)
  document.addEventListener('keydown', onDocumentKeydown)
  window.addEventListener('resize', closeVolumeMenu)
  window.addEventListener('scroll', closeVolumeMenu, true)
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', closeVolumeMenu)
  document.removeEventListener('keydown', onDocumentKeydown)
  window.removeEventListener('resize', closeVolumeMenu)
  window.removeEventListener('scroll', closeVolumeMenu, true)
})
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


const onlineUserIds = computed(() => new Set(onlineUsers.value.map(user => user.id)))


const sortedMembers = computed(() => {
  if (!props.members) return []

  return [...props.members].sort((a, b) => {

    const aIsOwner = isOwner(a)
    const bIsOwner = isOwner(b)
    if (aIsOwner && !bIsOwner) return -1
    if (!aIsOwner && bIsOwner) return 1


    const aStatus = getMemberPresenceStatus(a)
    const bStatus = getMemberPresenceStatus(b)

    const statusOrder = { 'in-room': 0, 'online': 1, 'offline': 2 }
    const aOrder = statusOrder[aStatus] || 2
    const bOrder = statusOrder[bStatus] || 2

    if (aOrder !== bOrder) return aOrder - bOrder


    return (a.name || '').localeCompare(b.name || '')
  })
})


const onlineMembersCount = computed(() => {
  if (!props.members) return 0
  return props.members.filter(member =>
    onlineUserIds.value.has(member.id) || member.online === true
  ).length
})



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

  if (onlineUsers.value.some(user => user.id === member.id)) {
    return 'in-room'
  }


  if (onlineUserIds.value.has(member.id) || member.online === true) {
    return 'online'
  }

  return 'offline'
}




</script>
