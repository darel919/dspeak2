<template>
  <div class="flex flex-col h-full bg-base-200">
    <!-- Channel list header -->
    <div class="p-4 border-b border-base-300">
      <div class="flex items-center justify-between">
        <h3 class="font-semibold text-lg">{{ room?.name || 'Channels' }}</h3>
        <div class="dropdown dropdown-end">
          <button tabindex="0" class="btn btn-ghost btn-sm btn-circle">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
            </svg>
          </button>
          <div tabindex="0" class="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-52">
            <li><a @click="showCreateChannel = true">Create Channel</a></li>
            <li>
              <a @click="goToRoomSettings" class="cursor-pointer hover:bg-base-200">
                Room Settings
              </a>
            </li>
            <li v-if="isRoomOwnerOrAdmin">
              <a @click="handleDeleteRoom" class="text-error cursor-pointer hover:bg-error/20">Delete Room</a>
            </li>
            <li v-else>
              <a @click="handleLeaveRoom" class="text-warning cursor-pointer hover:bg-warning/20">Leave Room</a>
            </li>
          </div>
        </div>
      </div>
    </div>

    <!-- Channel categories -->
    <div class="flex-1 overflow-y-auto p-2 space-y-4">
      <!-- Text Channels -->
      <div>
        <div class="flex items-center gap-2 px-2 py-1 text-xs font-semibold text-base-content/60 uppercase">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-1.586l-4.707 4.707z" />
          </svg>
          Text Channels
        </div>
        <div class="space-y-1">
          <div
            v-for="channel in textChannels"
            :key="channel.id"
            @click="selectChannel(channel)"
            class="flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-base-300 transition-colors"
            :class="{ 'bg-primary text-primary-content': selectedChannelId === channel.id }"
          >
            <span class="text-sm">#</span>
            <span class="flex-1 text-sm truncate">{{ channel.name }}</span>
            <div v-if="getUnreadCount(channel.id)" class="badge badge-primary badge-sm">
              {{ getUnreadCount(channel.id) }}
            </div>
            <!-- Channel actions dropdown -->
            <div class="dropdown dropdown-end" @click.stop>
              <button tabindex="0" class="btn btn-ghost btn-xs btn-circle opacity-0 group-hover:opacity-100">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                </svg>
              </button>
              <div tabindex="0" class="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-44">
                <li><a @click="editChannel(channel)">Edit Channel</a></li>
                <li v-if="canDeleteChannel(channel)"><a @click="deleteChannel(channel)" class="text-error">Delete Channel</a></li>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Voice Channels -->
      <div v-if="voiceChannels.length > 0">
        <div class="flex items-center gap-2 px-2 py-1 text-xs font-semibold text-base-content/60 uppercase">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
          Voice Channels
        </div>
        <div class="space-y-1">
          <div
            v-for="channel in voiceChannels"
            :key="channel.id"
            @click="selectChannel(channel)"
            class="flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-base-300 transition-colors group"
            :class="{ 'bg-primary text-primary-content': selectedChannelId === channel.id }"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m-2.829-2.829a2 2 0 010-2.828m4.95-1.414a8 8 0 010 11.314m-9.9-9.9a8 8 0 000 11.314m2.829-2.829a2 2 0 000-2.828m2.829-2.829a5 5 0 000 7.072" />
            </svg>
            <span class="flex-1 text-sm truncate">{{ channel.name }}</span>
            <div v-if="channel.inRoom?.length" class="text-xs text-base-content/60">
              {{ channel.inRoom.length }}
            </div>
            <!-- Channel actions dropdown -->
            <div class="dropdown dropdown-end" @click.stop>
              <button tabindex="0" class="btn btn-ghost btn-xs btn-circle opacity-0 group-hover:opacity-100">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                </svg>
              </button>
              <div tabindex="0" class="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-44">
                <li><a @click="editChannel(channel)">Edit Channel</a></li>
                <li v-if="canDeleteChannel(channel)"><a @click="deleteChannel(channel)" class="text-error">Delete Channel</a></li>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Create Channel Modal -->
    <div v-if="showCreateChannel" class="modal modal-open">
      <div class="modal-box">
        <h3 class="font-bold text-lg">Create Channel</h3>
        <form @submit.prevent="handleCreateChannel" class="space-y-4 mt-4">
          <div>
            <label class="label">
              <span class="label-text">Channel Name</span>
            </label>
            <input 
              v-model="newChannelName"
              type="text" 
              placeholder="channel-name"
              class="input input-bordered w-full"
              required
            />
          </div>
          <div>
            <label class="label">
              <span class="label-text">Description (optional)</span>
            </label>
            <textarea 
              v-model="newChannelDesc"
              placeholder="Describe what this channel is for..."
              class="textarea textarea-bordered w-full"
              rows="3"
            ></textarea>
          </div>
          <div>
            <label class="label">
              <span class="label-text">Channel Type</span>
            </label>
            <div class="form-control">
              <label class="label cursor-pointer">
                <span class="label-text">Text Channel</span>
                <input 
                  v-model="newChannelType" 
                  type="radio" 
                  value="text" 
                  class="radio"
                />
              </label>
              <label class="label cursor-pointer">
                <span class="label-text">Voice Channel</span>
                <input 
                  v-model="newChannelType" 
                  type="radio" 
                  value="voice" 
                  class="radio"
                />
              </label>
            </div>
          </div>
          <div v-if="newChannelType === 'voice'">
            <label class="label">
              <span class="label-text">Audio Bitrate (kbps)</span>
            </label>
            <select v-model="newChannelBitrate" class="select select-bordered w-full">
              <option value="64">64 kbps</option>
              <option value="96">96 kbps</option>
              <option value="128">128 kbps</option>
              <option value="256">256 kbps</option>
            </select>
          </div>
          <div class="modal-action">
            <button type="button" class="btn" @click="closeCreateModal">Cancel</button>
            <button type="submit" class="btn btn-primary" :disabled="!newChannelName.trim()">
              Create Channel
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Edit Channel Modal -->
    <div v-if="showEditChannel" class="modal modal-open">
      <div class="modal-box">
        <h3 class="font-bold text-lg">Edit Channel</h3>
        <form @submit.prevent="handleEditChannel" class="space-y-4 mt-4">
          <div>
            <label class="label">
              <span class="label-text">Channel Name</span>
            </label>
            <input 
              v-model="editingChannel.name"
              type="text" 
              class="input input-bordered w-full"
              required
            />
          </div>
          <div>
            <label class="label">
              <span class="label-text">Description</span>
            </label>
            <textarea 
              v-model="editingChannel.desc"
              class="textarea textarea-bordered w-full"
              rows="3"
            ></textarea>
          </div>
          <div v-if="editingChannel.isMedia">
            <label class="label">
              <span class="label-text">Audio Bitrate (kbps)</span>
            </label>
            <select v-model="editingChannel.audio_bitrate" class="select select-bordered w-full">
              <option value="64">64 kbps</option>
              <option value="96">96 kbps</option>
              <option value="128">128 kbps</option>
              <option value="256">256 kbps</option>
            </select>
          </div>
          <div class="modal-action">
            <button type="button" class="btn" @click="closeEditModal">Cancel</button>
            <button type="submit" class="btn btn-primary">
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useChannelsStore } from '../stores/channels'
import { useAuthStore } from '../stores/auth'
import { useRoomsStore } from '../stores/rooms'

const props = defineProps({
  room: {
    type: Object,
    required: true
  },
  selectedChannelId: {
    type: String,
    default: null
  }
})

const emit = defineEmits(['channel-selected'])

const channelsStore = useChannelsStore()
const authStore = useAuthStore()
const roomsStore = useRoomsStore()
const showCreateChannel = ref(false)
const showEditChannel = ref(false)
const editingChannel = ref(null)
const unreadCounts = ref([])
const newChannelName = ref('')
const newChannelDesc = ref('')
const newChannelType = ref('text')
const newChannelBitrate = ref(64)
const textChannels = computed(() => channelsStore.getTextChannels())
const voiceChannels = computed(() => channelsStore.getMediaChannels())
const currentUserId = computed(() => authStore.getUserData()?.id)
const isRoomOwnerOrAdmin = computed(() => {
  if (!props.room || !props.room.owner) return false
  return props.room.owner.id === currentUserId.value
})
async function handleDeleteRoom() {
  if (!props.room || !props.room.id) return
  if (!confirm(`Are you sure you want to delete the room "${props.room.name}"? This cannot be undone.`)) return
  try {
    await roomsStore.deleteRoom(props.room.id)
    navigateTo('/')
  } catch (err) {
    console.error('Failed to delete room:', err)
  }
}

async function handleLeaveRoom() {
  if (!props.room || !props.room.id) return
  if (!confirm(`Are you sure you want to leave the room "${props.room.name}"?`)) return
  try {
    await roomsStore.leaveRoom(props.room.id)
    navigateTo('/')
  } catch (err) {
    console.error('Failed to leave room:', err)
  }
}

async function loadChannels() {
  try {
    await channelsStore.fetchChannels(props.room.id)
    await loadUnreadCounts()
  } catch (error) {
    console.error('Failed to load channels:', error)
  }
}

async function loadUnreadCounts() {
  try {
    const counts = await channelsStore.getUnreadCounts()
    unreadCounts.value = counts
  } catch (error) {
    console.error('Failed to load unread counts:', error)
  }
}

function getUnreadCount(channelId) {
  const count = unreadCounts.value.find(c => c.channelId === channelId)
  return count?.unreadCount || 0
}

function selectChannel(channel) {
  emit('channel-selected', channel)
  if (props.room && channel && channel.id) {
    navigateTo(`/room/${props.room.id}/${channel.id}`)
  }
}

async function handleCreateChannel() {
  try {
    const channelData = {
      name: newChannelName.value.trim(),
      desc: newChannelDesc.value.trim(),
      isMedia: newChannelType.value === 'voice',
      audio_bitrate: newChannelType.value === 'voice' ? parseInt(newChannelBitrate.value) : null
    }

    await channelsStore.createChannel(props.room.id, channelData)
    closeCreateModal()
  } catch (error) {
    console.error('Failed to create channel:', error)
  }
}

async function editChannel(channel) {
  editingChannel.value = { ...channel }
  showEditChannel.value = true
}

async function handleEditChannel() {
  try {
    await channelsStore.editChannel(editingChannel.value.id, editingChannel.value)
    closeEditModal()
  } catch (error) {
    console.error('Failed to edit channel:', error)
  }
}

async function deleteChannel(channel) {
  if (confirm(`Are you sure you want to delete #${channel.name}?`)) {
    try {
      await channelsStore.deleteChannel(channel.id)
    } catch (error) {
      console.error('Failed to delete channel:', error)
    }
  }
}

function canDeleteChannel(channel) {
  return channel.owner?.id === currentUserId.value || props.room.owner?.id === currentUserId.value
}

function closeCreateModal() {
  showCreateChannel.value = false
  newChannelName.value = ''
  newChannelDesc.value = ''
  newChannelType.value = 'text'
  newChannelBitrate.value = 64
}

function closeEditModal() {
  showEditChannel.value = false
  editingChannel.value = null
}

function goToRoomSettings() {
  if (props.room && props.room.id) {
    navigateTo(`/room/${props.room.id}/settings`)
  }
}

onMounted(() => {
  loadChannels()
})
watch(() => props.room.id, () => {
  if (props.room.id) {
    loadChannels()
  }
})
</script>

<style scoped>
.group:hover .group-hover\:opacity-100 {
  opacity: 1;
}
</style>
