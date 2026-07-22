<template>
  <div class="flex flex-col h-full bg-base-200">
    <!-- Channel list header -->
    <div class="p-4 border-base-300">
      <div class="flex items-center justify-between">
        <h3 class="font-semibold text-lg">{{ room?.name || 'Channels' }}</h3>
        <div class="dropdown dropdown-end">
          <button tabindex="0" class="btn btn-ghost btn-sm btn-circle">
            <Icon name="lucide:ellipsis-vertical" class="h-5 w-5" />
          </button>
          <div tabindex="0" class="dropdown-content z-[1] menu p-2 shadow bg-base-100 text-base-content rounded-box w-52">
            <li><a @click="showCreateChannel = true">Create Channel</a></li>
            <li>
              <a @click="goToRoomSettings" class="cursor-pointer hover:bg-base-200">
                Room Settings
              </a>
            </li>
            <li>
              <a @click="handleCopyInviteLink" class="cursor-pointer hover:bg-base-200">Copy Invite Link</a>
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
          <Icon name="lucide:message-square" class="h-3 w-3" />
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
                <Icon name="lucide:ellipsis-vertical" class="h-3 w-3" />
              </button>
              <div tabindex="0" class="dropdown-content z-[1] menu p-2 shadow bg-base-100 text-base-content rounded-box w-44">
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
          <Icon name="lucide:mic" class="h-3 w-3" />
          Voice Channels
        </div>
        <div class="space-y-1">
          <div
            v-for="channel in voiceChannels"
            :key="channel.id"
            class="group rounded transition-colors"
            :class="{ 'bg-primary text-primary-content': selectedChannelId === channel.id, 'bg-success/20 border border-success/50': (voiceStore.currentChannelId === channel.id && voiceStore.connected) }"
          >
            <!-- Row (clickable) -->
            <div @click="selectChannel(channel)" class="flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-base-300">
              <Icon name="lucide:volume-2" class="h-4 w-4" />

              <span class="flex-1 text-sm truncate">{{ channel.name || 'Voice Channel' }}</span>

              <div class="flex items-center gap-2">
                <div v-if="(voiceStore.currentChannelId === channel.id && voiceStore.connected)" class="flex items-center gap-1">
                  <div class="w-2 h-2 bg-success rounded-full animate-pulse" title="Connected to voice"></div>
                </div>

                <!-- Options button (moved here from block end) -->
                <div class="dropdown dropdown-end" @click.stop>
                  <button tabindex="0" class="btn btn-ghost btn-xs btn-circle opacity-0 group-hover:opacity-100" title="Channel options">
                    <Icon name="lucide:ellipsis-vertical" class="h-3 w-3" />
                  </button>
                  <div tabindex="0" class="dropdown-content z-[1] menu p-2 shadow bg-base-100 text-base-content rounded-box w-44">
                    <li><a @click="editChannel(channel)">Edit Channel</a></li>
                    <li v-if="canDeleteChannel(channel)"><a @click="deleteChannel(channel)" class="text-error">Delete Channel</a></li>
                  </div>
                </div>
              </div>
            </div>

            <!-- Expanded vertical participant list (when connected) -->
            <div v-if="(voiceStore.currentChannelId === channel.id && voiceStore.connected)" class="pl-8 pr-2 pb-2">
              <div class="flex flex-col gap-1">
                <template v-for="u in voiceStore.getDisplayUsersArray()" :key="u.id || u">
                  <div class="flex items-center gap-2 text-sm text-base-content/70">
                    <span class="min-w-0 flex-1 truncate">{{ getUserName(u.id || u) }}</span>
                    <div class="dropdown dropdown-end shrink-0" @click.stop>
                      <button
                        tabindex="0"
                        type="button"
                        class="flex h-6 items-end gap-0.5 rounded px-1 py-1 transition-colors hover:bg-base-content/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        :aria-label="getConnectionQualityAriaLabel(u.id || u)"
                        :title="getConnectionQualityTitle(u.id || u)"
                      >
                        <span
                          v-for="bar in 5"
                          :key="bar"
                          class="w-0.5 rounded-full bg-current transition-opacity"
                          :class="bar <= getUserConnectionQuality(u.id || u) ? `${getConnectionQualityColorClass(getUserConnectionQuality(u.id || u))} opacity-100` : 'text-base-content opacity-20'"
                          :style="{ height: `${4 + (bar * 2)}px` }"
                        ></span>
                      </button>
                      <div tabindex="0" class="dropdown-content z-[20] mt-1 w-56 rounded-box border border-base-300 bg-base-100 p-3 text-base-content shadow-xl">
                        <div class="truncate text-sm font-semibold">{{ getUserName(u.id || u) }}</div>
                        <div class="mt-2 space-y-1.5 text-xs">
                          <div class="flex items-center justify-between gap-3">
                            <span class="text-base-content/60">Connection quality</span>
                            <span class="font-medium">{{ getUserConnectionQualityLabel(u.id || u) }}</span>
                          </div>
                          <div class="flex items-center justify-between gap-3">
                            <span class="text-base-content/60">SFU RTT</span>
                            <span class="font-mono tabular-nums">{{ formatRtt(getUserSfuRtt(u.id || u)) }}</span>
                          </div>
                          <div class="flex items-center justify-between gap-3">
                            <span class="text-base-content/60">Peer RTT</span>
                            <span class="font-mono tabular-nums">{{ formatPeerRtt(u.id || u) }}</span>
                          </div>
                          <div v-if="getUserPeerMetrics(u.id || u)" class="flex items-center justify-between gap-3">
                            <span class="text-base-content/60">Packet loss</span>
                            <span class="font-mono tabular-nums">{{ formatPercent(getUserPeerMetrics(u.id || u).packetLossPercent) }}</span>
                          </div>
                          <div v-if="getUserPeerMetrics(u.id || u)" class="flex items-center justify-between gap-3">
                            <span class="text-base-content/60">Jitter</span>
                            <span class="font-mono tabular-nums">{{ formatRtt(getUserPeerMetrics(u.id || u).jitterMs) }}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </template>
              </div>
            </div>

            <!-- Fallback vertical list when not connected but server has inRoom info -->
            <div v-else-if="channel.inRoom?.length" class="pl-8 pr-2 pb-2">
              <div class="flex flex-col gap-1 text-sm text-base-content/60">
                <template v-for="uid in channel.inRoom" :key="uid">
                  <div class="truncate">{{ getUserName(uid) }}</div>
                </template>
              </div>
            </div>
            <!-- channel actions moved into row -->
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
            <div class="w-full">
              <input
                type="range"
                min="1"
                max="5"
                v-model.number="newChannelBitrateLevel"
                class="range w-full"
                step="1"
              />
              <div class="flex justify-between px-2.5 mt-2 text-xs">
                <span>|</span>
                <span>|</span>
                <span>|</span>
                <span>|</span>
                <span>|</span>
              </div>
              <div class="flex justify-between px-2.5 mt-2 text-xs">
                <span>64</span>
                <span>96</span>
                <span>128</span>
                <span>160</span>
                <span>256</span>
              </div>
            </div>
            <div class="text-sm mt-2">Selected: <strong>{{ newChannelBitrateKbps }} kbps</strong></div>
            <div v-if="newChannelBitrateLevel > 3" class="text-sm text-error mt-2">Using high bitrate audio might affect your experience if your connection is unstable.</div>
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
            <label class="label mb-2">
              <span class="label-text">Audio Bitrate (kbps)</span>
            </label>
            <div class="w-full">
              <input
                type="range"
                min="1"
                max="5"
                v-model.number="editingChannelBitrateLevel"
                class="range w-full"
                step="1"
              />
              <div class="flex justify-between px-2.5 mt-2 text-xs">
                <span>|</span>
                <span>|</span>
                <span>|</span>
                <span>|</span>
                <span>|</span>
              </div>
              <div class="flex justify-between px-2.5 mt-2 text-xs">
                <span>64</span>
                <span>96</span>
                <span>128</span>
                <span>160</span>
                <span>256</span>
              </div>
            </div>
            <div class="text-sm mt-2">Selected: <strong>{{ editingChannelBitrateKbps }} kbps</strong></div>
            <div v-if="editingChannelBitrateLevel > 3" class="text-sm text-error mt-2">Using high bitrate audio might affect your experience if your connection is unstable.</div>
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

    <div v-if="showRoomSettings" class="modal modal-open" role="dialog" aria-modal="true" aria-labelledby="room-settings-title">
      <div class="modal-box border border-base-300 bg-base-100 text-base-content shadow-2xl">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h3 id="room-settings-title" class="text-lg font-bold">Edit Room</h3>
            <p class="mt-1 text-sm text-base-content/70">Update how this room appears to its members.</p>
          </div>
          <button type="button" class="btn btn-ghost btn-sm btn-circle" aria-label="Close room settings" @click="closeRoomSettings">
            <Icon name="lucide:x" class="size-5" />
          </button>
        </div>
        <form class="mt-5 space-y-4" @submit.prevent="saveRoomSettings">
          <label class="form-control w-full">
            <span class="mb-2 text-sm font-semibold">Room name</span>
            <input v-model="roomSettingsName" class="input input-bordered w-full" maxlength="80" required />
          </label>
          <label class="form-control w-full">
            <span class="mb-2 text-sm font-semibold">Description</span>
            <textarea v-model="roomSettingsDescription" class="textarea textarea-bordered min-h-28 w-full" maxlength="500" placeholder="What is this room for?"></textarea>
          </label>
          <p v-if="roomSettingsError" class="text-sm text-error" role="alert">{{ roomSettingsError }}</p>
          <div class="modal-action">
            <button type="button" class="btn btn-ghost" :disabled="roomSettingsSaving" @click="closeRoomSettings">Cancel</button>
            <button type="submit" class="btn btn-primary" :disabled="roomSettingsSaving || !roomSettingsName.trim()">
              <span v-if="roomSettingsSaving" class="loading loading-spinner loading-sm"></span>
              Save changes
            </button>
          </div>
        </form>
      </div>
      <button type="button" class="modal-backdrop" aria-label="Close room settings" @click="closeRoomSettings"></button>
    </div>
  </div>
</template>

<script setup>
function getUserName(userId) {
  const user = voiceStore.getUserById(userId) || voiceStore.getUserProfile(userId)
  return user?.display_name || user?.name || user?.username || userId
}
function getUserSfuRtt(userId) {
  const sfu = unref(voiceStore.sfuComposable)
  if (!sfu) return null
  const isCurrentUser = String(userId) === String(authStore.getUserData()?.id)
  const value = isCurrentUser
    ? unref(sfu.sfuRoundTripTime)
    : unref(sfu.participantSfuRoundTripTimes)?.[String(userId)]
  return Number.isFinite(Number(value)) ? Number(value) : null
}
function getUserPeerRtt(userId) {
  const sfu = unref(voiceStore.sfuComposable)
  const isCurrentUser = String(userId) === String(authStore.getUserData()?.id)
  if (!sfu) return null
  const peerRoundTripTimes = unref(sfu.peerRoundTripTimes) || {}
  const values = Object.values(peerRoundTripTimes).map(Number).filter(Number.isFinite)
  const value = isCurrentUser
    ? (values.length ? Math.max(...values) : null)
    : peerRoundTripTimes[String(userId)]
  return Number.isFinite(Number(value)) ? Number(value) : null
}
function getUserConnectionQuality(userId) {
  const sfu = unref(voiceStore.sfuComposable)
  const provider = unref(sfu?.activeProvider)
  if (provider !== 'p2p') return getConnectionQualityBars(getUserSfuRtt(userId))
  const isCurrentUser = String(userId) === String(authStore.getUserData()?.id)
  const metrics = isCurrentUser ? null : getUserPeerMetrics(userId)
  return getConnectionQualityBars(getUserPeerRtt(userId), metrics?.packetLossPercent, metrics?.jitterMs)
}
function getUserPeerMetrics(userId) {
  const sfu = unref(voiceStore.sfuComposable)
  const isCurrentUser = String(userId) === String(authStore.getUserData()?.id)
  return isCurrentUser ? null : unref(sfu?.peerConnectionMetrics)?.[String(userId)] || null
}
function getUserConnectionQualityLabel(userId) {
  return getConnectionQualityLabel(getUserConnectionQuality(userId))
}
function getConnectionQualityAriaLabel(userId) {
  const name = getUserName(userId)
  const label = getUserConnectionQualityLabel(userId)
  const rtt = formatRtt(getUserPeerRtt(userId) ?? getUserSfuRtt(userId))
  return `${name} connection quality: ${label}, RTT ${rtt}. Show connection statistics.`
}
function getConnectionQualityTitle(userId) {
  return `${getUserConnectionQualityLabel(userId)} connection · Click for RTT statistics`
}
function formatRtt(value) {
  return Number.isFinite(Number(value)) ? `${Math.round(Number(value))} ms` : 'Waiting'
}
function formatPercent(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}%` : 'Waiting'
}
function formatPeerRtt(userId) {
  const isCurrentUser = String(userId) === String(authStore.getUserData()?.id)
  return isCurrentUser ? 'Current device' : formatRtt(getUserPeerRtt(userId))
}
import { useChannelsStore } from '../stores/channels'
import { useAuthStore } from '../stores/auth'
import { useRoomsStore } from '../stores/rooms'
import { useVoiceStore } from '../stores/voice'
import { getConnectionQualityBars, getConnectionQualityColorClass, getConnectionQualityLabel } from '../shared/connection-quality'
import { unref } from 'vue'
import { CHANNEL_BITRATE_LEVELS } from '../const/media'

import { useChatUtils } from '../composables/useChatUtils'
import { useToast } from '../composables/useToast'
const { copyToClipboard } = useChatUtils()
const { success, error } = useToast()

async function handleCopyInviteLink() {
  if (!props.room || !props.room.id) return
  const baseUrl = window.location.origin
  const inviteLink = `${baseUrl}/join/${props.room.id}`
  const copied = await copyToClipboard(inviteLink)
  if (copied) {
    success('Link successfully copied to clipboard.')
  } else {
    error('Failed to copy invite link')
  }
}

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
const voiceStore = useVoiceStore()
const showCreateChannel = ref(false)
const showEditChannel = ref(false)
const editingChannel = ref(null)
const editingChannelBitrateLevel = ref(3)
const editingChannelBitrateKbps = computed(() => {
  return CHANNEL_BITRATE_LEVELS[editingChannelBitrateLevel.value] || 64
})
const unreadCounts = ref([])
const newChannelName = ref('')
const newChannelDesc = ref('')
const newChannelType = ref('text')
const newChannelBitrate = ref(64)

const newChannelBitrateLevel = ref(3)
const newChannelBitrateKbps = computed(() => CHANNEL_BITRATE_LEVELS[newChannelBitrateLevel.value] || 64)
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

      audio_bitrate: newChannelType.value === 'voice' ? Number(newChannelBitrateKbps.value) : null
    }

    await channelsStore.createChannel(props.room.id, channelData)
    closeCreateModal()
  } catch (error) {
    console.error('Failed to create channel:', error)
  }
}

async function editChannel(channel) {
  editingChannel.value = { ...channel }

  const kbps = Number(channel.audio_bitrate) || 64
  const level = bitrateLevelToKbps.indexOf(kbps)
  editingChannelBitrateLevel.value = level > 0 ? level : 1
  showEditChannel.value = true
}

async function handleEditChannel() {
  try {

    if (editingChannel.value) editingChannel.value.audio_bitrate = Number(editingChannelBitrateKbps.value)
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
  newChannelBitrateLevel.value = 3
}

function closeEditModal() {
  showEditChannel.value = false
  editingChannel.value = null
}

const showRoomSettings = ref(false)
const roomSettingsName = ref('')
const roomSettingsDescription = ref('')
const roomSettingsSaving = ref(false)
const roomSettingsError = ref('')

function goToRoomSettings() {
  if (!props.room?.id) return
  roomSettingsName.value = props.room.name || ''
  roomSettingsDescription.value = props.room.desc || ''
  roomSettingsError.value = ''
  showRoomSettings.value = true
}

function closeRoomSettings() {
  if (roomSettingsSaving.value) return
  showRoomSettings.value = false
  roomSettingsError.value = ''
}

async function saveRoomSettings() {
  if (!props.room?.id || !roomSettingsName.value.trim()) return
  roomSettingsSaving.value = true
  roomSettingsError.value = ''
  try {
    await roomsStore.updateRoom(props.room.id, {
      name: roomSettingsName.value.trim(),
      desc: roomSettingsDescription.value.trim()
    })
    showRoomSettings.value = false
  } catch (error) {
    roomSettingsError.value = error?.message || 'Room settings could not be saved.'
  } finally {
    roomSettingsSaving.value = false
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
