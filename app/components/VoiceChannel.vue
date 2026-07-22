<template>
  <div class="voice-channel relative h-full flex flex-col bg-base-200">
    <!-- Header -->
    <div class="flex items-center justify-between p-4 border-b border-base-300">
      <div class="flex items-center gap-2">
        <Icon name="lucide:mic" class="w-5 h-5 text-success" />
        <h3 class="font-semibold">{{ channel.name }}</h3>
      </div>

      <div class="flex items-center gap-2">
        <div
          v-if="voiceStore.connecting && !voiceStore.connected"
          class="flex items-center gap-2 text-info"
        >
          <span class="loading loading-spinner loading-sm"></span>
          <span class="text-sm">Connecting...</span>
        </div>

        <!-- <div v-else-if="voiceStore.connected" class="flex items-center gap-2 text-success">
          <div class="w-2 h-2 bg-success rounded-full animate-pulse"></div>
          <span class="text-sm font-medium">Connected</span>
        </div> -->

        <!-- <button
          v-if="voiceStore.connected"
          @click="leaveChannel"
          class="btn btn-sm btn-error"
        >
          Leave
        </button> -->
      </div>
    </div>

    <!-- Connection Error -->
    <div v-if="voiceStore.error" class="alert alert-error m-4">
      <Icon name="lucide:circle-x" class="w-6 h-6 stroke-current shrink-0" />
      <span>{{ voiceStore.error }}</span>
    </div>

    <!-- Connection Info Banner -->
    <div
      v-if="
        voiceStore.connected && voiceStore.currentChannelId !== props.channel.id
      "
      class="bg-info/10 border border-info/20 rounded-lg p-4 mb-4"
    >
      <div class="flex items-center gap-3">
        <Icon name="lucide:info" class="w-5 h-5 text-info" />
        <div class="flex-1">
          <p class="text-sm font-medium">
            You're connected to a different voice channel
          </p>
          <p class="text-xs text-base-content/60">
            {{ currentConnectedChannelName }}
          </p>
        </div>
        <div class="flex gap-2">
          <button @click="switchToThisChannel" class="btn btn-sm btn-info">
            Switch Here
          </button>
          <button
            @click="navigateToCurrentChannel"
            class="btn btn-sm btn-outline"
          >
            Go Back
          </button>
        </div>
      </div>
    </div>

    <!-- Main Content Area - Participants View -->
    <div
      v-if="
        voiceStore.connected && voiceStore.currentChannelId === props.channel.id
      "
      class="flex-1 flex min-h-0 flex-col overflow-hidden"
    >
      <!-- Video owns the available stage; the grid expands and reflows as feeds appear. -->
      <div
        v-if="videoFeeds.length"
        class="flex min-h-0 flex-1 items-center justify-center p-4 md:p-6"
      >
        <div
          class="grid h-full max-h-full w-full content-center justify-center gap-4"
          :class="
            videoFeeds.length === 1
              ? 'grid-cols-1 max-w-6xl'
              : 'grid-cols-1 md:grid-cols-2'
          "
        >
          <div
            v-for="feed in videoFeeds"
            :key="feed.key"
            class="mx-auto aspect-video max-h-full w-full overflow-hidden"
          >
            <VideoFeed
              :feed-key="feed.key"
              :stream="feed.stream"
              :source="feed.source"
              :label="feed.label"
              :muted="feed.local"
              :local="feed.local"
            />
          </div>
        </div>
      </div>
      <!-- Participants Grid -->
      <div
        :class="
          videoFeeds.length
            ? 'shrink-0 border-t border-base-300 bg-base-200/70 px-4 py-3'
            : 'flex-1 p-6'
        "
      >
        <div v-if="connectedUsers.length > 0" class="h-full">
          <!-- Participants Grid Layout -->
          <div
            :class="
              videoFeeds.length
                ? 'flex max-w-full items-center justify-center gap-3 overflow-x-auto'
                : 'grid h-full auto-rows-max grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
            "
          >
            <div
              v-for="user in connectedUsers"
              :key="user.id"
              class="relative flex flex-col items-center justify-center bg-base-100 shadow-sm border border-base-300 transition-all duration-500"
              :class="[
                videoFeeds.length
                  ? 'min-w-24 rounded-lg px-3 py-2'
                  : 'min-h-[200px] rounded-lg p-6',
                user.speaking ? 'ring-2 ring-success' : '',
              ]"
              @contextmenu.prevent="openVolumeMenu(user)"
            >
              <!-- User Avatar -->
              <div class="avatar" :class="videoFeeds.length ? 'mb-1' : 'mb-4'">
                <div
                  v-if="getUserAvatar(user)"
                  class="rounded-full overflow-hidden ring-2 transition-all duration-150"
                  :class="[
                    videoFeeds.length ? 'h-10 w-10' : 'h-20 w-20',
                    user.speaking
                      ? 'ring-success ring-offset-2 ring-offset-base-100 shadow-[0_0_0_6px_rgba(34,197,94,0.15)]'
                      : 'ring-base-300',
                  ]"
                >
                  <img
                    :src="getUserAvatar(user)"
                    class="w-full h-full object-cover"
                    alt="avatar"
                  />
                </div>
                <div
                  v-else
                  class="rounded-full bg-gradient-to-br from-primary to-secondary text-primary-content flex items-center justify-center font-bold ring-2 transition-all duration-150"
                  :class="[
                    videoFeeds.length
                      ? 'h-10 w-10 text-sm'
                      : 'h-20 w-20 text-2xl',
                    user.speaking
                      ? 'ring-success ring-offset-2 ring-offset-base-100 shadow-[0_0_0_6px_rgba(34,197,94,0.15)]'
                      : 'ring-base-300',
                  ]"
                >
                  {{ getUserInitials(user) }}
                </div>
              </div>
              <!-- User Name -->
              <h4
                class="font-semibold text-center"
                :class="
                  videoFeeds.length
                    ? 'max-w-24 truncate text-xs'
                    : 'mb-2 text-lg'
                "
              >
                {{ getUserDisplayName(user) }}
              </h4>
              <!-- ICE / Connection Status for local user when not fully connected -->
              <div
                v-if="isLocalUser(user) && !voiceStore.connected"
                class="text-xs text-base-content/60 mb-2"
              >
                <span v-if="voiceStore.connecting && !voiceStore.connected"
                  >Waiting</span
                >
                <span
                  v-else-if="
                    voiceStore.sfuComposable &&
                    !voiceStore.sfuComposable.transportReady
                  "
                  >Connecting</span
                >
                <span
                  class="text-error"
                  v-else-if="
                    voiceStore.sfuComposable?.iceConnectedBoth === false
                  "
                  >Disconnected</span
                >
                <span v-else>Not connected</span>
              </div>
              <!-- User Status -->
              <div class="flex items-center gap-2">
                <!-- <div v-if="user.speaking" class="flex items-center gap-1 text-success"> -->
                <!-- <div class="w-2 h-2 bg-success rounded-full animate-pulse"></div> -->
                <!-- <span class="text-sm">Speaking</span> -->
                <!-- </div> -->
                <div
                  v-if="user.muted"
                  class="flex items-center gap-1 text-error"
                >
                  <Icon name="lucide:mic" class="size-6" />
                  <span class="text-sm">Muted</span>
                </div>
              </div>
              <!-- Volume Control Context Menu -->
              <div
                v-if="volumeMenuUser && volumeMenuUser.id === user.id"
                class="absolute top-2 right-2 bg-base-200 border border-base-300 rounded-lg shadow-lg p-3 z-50 w-48"
              >
                <div class="text-xs font-semibold mb-1">Voice</div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  :value="voiceStore.getTrackVolume(user.id, 'audio')"
                  @input="onTrackVolumeChange(user.id, 'audio', $event)"
                  class="w-full"
                />
                <div class="flex justify-between text-xs mt-1">
                  <span>0%</span>
                  <span>100%</span>
                </div>
                <template v-if="hasAudioSource(user.id, 'screen-audio')">
                  <div class="mt-3 text-xs font-semibold mb-1">
                    Screen share
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    :value="voiceStore.getTrackVolume(user.id, 'screen-audio')"
                    @input="
                      onTrackVolumeChange(user.id, 'screen-audio', $event)
                    "
                    class="w-full"
                  />
                  <div class="flex justify-between text-xs mt-1">
                    <span>0%</span>
                    <span>100%</span>
                  </div>
                </template>
                <button
                  class="btn btn-xs btn-outline w-full mt-2"
                  @click="closeVolumeMenu"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Empty state when no other users -->
        <div v-else class="h-full flex flex-col items-center justify-center">
          <Icon
            name="lucide:users"
            class="w-24 h-24 text-base-content/40 mb-6"
          />
          <h4 class="text-xl font-medium text-base-content/60 mb-2">
            You're alone in this voice channel
          </h4>
          <p class="text-base-content/40 text-center max-w-md">
            Others can join by clicking on this channel from the sidebar. Share
            the room invite to get more people in here!
          </p>
        </div>
      </div>
    </div>

    <!-- Voice Controls at Bottom (Discord-style) -->
    <div
      v-if="
        voiceStore.connected && voiceStore.currentChannelId === props.channel.id
      "
      class="voice-controls absolute inset-x-4 bottom-4 z-40 rounded-2xl border border-base-content/15 bg-base-300/95 p-4 shadow-2xl backdrop-blur"
    >
      <div class="flex items-center justify-center gap-4">
        <!-- Microphone Control -->
        <div class="flex flex-col items-center">
          <button
            @click="voiceStore.toggleMic"
            :disabled="
              !voiceStore.connected ||
              (voiceStore.sfuComposable &&
                !voiceStore.sfuComposable.transportReady)
            "
            :class="[
              'btn btn-circle btn-lg',
              voiceStore.micMuted ? 'btn-error' : 'btn-outline',
            ]"
            :title="getButtonTitle()"
          >
            <Icon
              name="lucide:mic"
              v-if="!voiceStore.micMuted"
              class="w-6 h-6 text-current"
            />
            <Icon name="lucide:mic-off" v-else class="w-6 h-6 text-white" />
          </button>
          <!-- <span class="text-xs mt-1 text-center">
            {{ voiceStore.micMuted ? 'Muted' : 'Mic' }}
          </span> -->
        </div>

        <!-- Deafen Control -->
        <div class="flex flex-col items-center">
          <button
            @click="voiceStore.toggleDeafen"
            :class="[
              'btn btn-circle btn-lg',
              voiceStore.deafened ? 'btn-error' : 'btn-outline',
            ]"
            :title="voiceStore.deafened ? 'Undeafen' : 'Deafen'"
          >
            <Icon
              name="lucide:volume-2"
              v-if="!voiceStore.deafened"
              class="w-6 h-6"
            />
            <Icon name="lucide:volume-x" v-else class="w-6 h-6" />
          </button>
          <!-- <span class="text-xs mt-1 text-center">
            {{ voiceStore.deafened ? 'Deafened' : 'Audio' }}
          </span> -->
        </div>

        <button
          class="btn btn-circle btn-lg"
          :class="voiceStore.cameraEnabled ? 'btn-primary' : 'btn-outline'"
          title="Toggle camera"
          @click="toggleCamera"
        >
          <Icon name="lucide:camera" class="size-5" />
        </button>

        <button
          class="btn btn-circle btn-lg"
          :class="voiceStore.screenSharing ? 'btn-primary' : 'btn-outline'"
          title="Toggle screen sharing"
          @click="toggleScreenShare"
        >
          <Icon name="lucide:monitor-up" class="size-5" />
        </button>

        <button
          class="btn btn-circle btn-lg"
          :class="voiceStore.systemAudioSharing ? 'btn-primary' : 'btn-outline'"
          :title="
            voiceStore.systemAudioSharing
              ? 'Stop sharing system audio'
              : 'Share system audio only'
          "
          @click="toggleSystemAudioShare"
        >
          <Icon name="lucide:audio-lines" class="size-5" />
        </button>

        <!-- Connection Status -->
        <div class="flex flex-col items-center ml-4">
          <div class="flex items-center gap-2">
            <div
              v-if="!voiceStore.sfuComposable?.transportReady"
              class="flex items-center gap-1 text-warning"
            >
              <span class="loading loading-spinner loading-xs"></span>
              <span class="text-xs">Setting up...</span>
            </div>
            <div v-else class="flex items-center gap-1 text-success">
              <div class="w-2 h-2 bg-success rounded-full"></div>
              <span class="text-xs">Connected</span>
            </div>
          </div>
          <span class="text-xs text-base-content/60"
            >{{ connectedUsers.length }} participant{{
              connectedUsers.length !== 1 ? "s" : ""
            }}</span
          >
        </div>
      </div>
      <div
        v-if="voiceStore.screenSharing || voiceStore.systemAudioSharing"
        class="mx-auto mt-3 flex max-w-2xl flex-wrap items-center justify-center gap-3"
      >
        <Icon name="lucide:volume-2" class="size-4 shrink-0" />
        <label
          for="shared-audio-volume"
          class="whitespace-nowrap text-xs font-medium"
          >Volume others hear</label
        >
        <input
          id="shared-audio-volume"
          class="range range-primary range-xs min-w-24 flex-1"
          type="range"
          min="0"
          max="100"
          step="1"
          :value="voiceStore.sharedAudioVolume"
          @input="voiceStore.setSharedAudioVolume($event.target.value)"
        />
        <span class="w-10 text-right text-xs tabular-nums"
          >{{ voiceStore.sharedAudioVolume }}%</span
        >
        <div
          class="flex items-center gap-2"
          :title="`${voiceStore.sharedAudioStats.dbfs.toFixed(1)} dBFS`"
        >
          <span class="text-xs font-medium">Sent level</span>
          <progress
            :class="[
              'progress h-3 w-48',
              voiceStore.sharedAudioStats.dbfs >= -12
                ? 'progress-error'
                : 'progress-success',
            ]"
            max="1"
            :value="voiceStore.sharedAudioStats.level"
          ></progress>
          <span class="w-14 text-right text-xs tabular-nums"
            >{{ voiceStore.sharedAudioStats.kbps.toFixed(1) }} kbps</span
          >
        </div>
      </div>
    </div>

    <!-- Audio elements are managed in a global hidden container to persist across navigation -->

    <!-- Not Connected State -->
    <div
      v-if="!voiceStore.connected"
      class="flex-1 flex flex-col items-center justify-center py-12"
    >
      <Icon name="lucide:phone-outgoing" class="size-12 mb-4" />

      <h4 class="text-xl font-medium text-base-content/60 mb-3">
        Connect to {{ props.channel.name }}
      </h4>
      <p class="text-base-content/40 text-center max-w-md mb-6">
        Click the button below to join this voice channel and start talking with
        others.
      </p>
      <button
        @click="joinThisChannel"
        :disabled="voiceStore.connecting"
        class="btn btn-success btn-lg"
      >
        <Icon name="lucide:mic" class="size-6" />

        <span
          v-if="voiceStore.connecting"
          class="loading loading-spinner loading-sm mr-2"
        ></span>
        {{
          voiceStore.connecting
            ? "Connecting..."
            : "Connect to " + props.channel.name
        }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { useVoiceStore } from "~/stores/voice";
import { useAuthStore } from "~/stores/auth";

const props = defineProps({
  channel: {
    type: Object,
    required: true,
  },
});

const voiceStore = useVoiceStore();
const authStore = useAuthStore();
const channelsStore = useChannelsStore();
const router = useRouter();
const config = useRuntimeConfig();

const connectedUsers = computed(() => {
  const display = voiceStore.getDisplayUsersArray();

  if (typeof window !== "undefined") {
    const container = document.getElementById("webrtc-audio-global");
    if (container) {
      const audioElements = Array.from(container.querySelectorAll("audio")).map(
        (el) => ({
          id: el.id,
          dataUserId: el.getAttribute("data-user-id"),
          volume: el.volume,
        }),
      );
    }
  }
  return display;
});
const videoFeeds = computed(() => {
  const sfu = voiceStore.sfuComposable;
  if (!sfu) return [];
  const local = Array.from(sfu.localVideoFeeds || []).map(([source, feed]) => ({
    ...feed,
    key: `local-${source}`,
    local: true,
    label: "You",
  }));
  const remote = Array.from(sfu.remoteVideoFeeds || []).map(
    ([producerId, feed]) => ({
      ...feed,
      key: producerId,
      local: false,
      label: getUserDisplayName(
        voiceStore.getUserById(feed.userId) || { id: feed.userId },
      ),
    }),
  );
  return [...local, ...remote].sort(
    (a, b) => Number(b.source === "screen") - Number(a.source === "screen"),
  );
});

async function toggleCamera() {
  try {
    await voiceStore.toggleCamera();
  } catch (err) {
    console.error("[VoiceChannel] Camera error:", err);
  }
}

async function toggleScreenShare() {
  try {
    await voiceStore.toggleScreenShare();
  } catch (err) {
    console.error("[VoiceChannel] Screen share error:", err);
  }
}

async function toggleSystemAudioShare() {
  try {
    await voiceStore.toggleSystemAudioShare();
  } catch (err) {
    console.error("[VoiceChannel] System audio share error:", err);
  }
}
const volumeMenuUser = ref(null);
function openVolumeMenu(user) {
  console.debug("[VoiceChannel] Opening volume menu for user:", user);
  volumeMenuUser.value = user;
}
function closeVolumeMenu() {
  volumeMenuUser.value = null;
}
function onTrackVolumeChange(userId, source, event) {
  voiceStore.setTrackVolume(userId, source, Number(event.target.value));
}

function hasAudioSource(userId, source) {
  return Array.from(voiceStore.sfuComposable?.remoteAudioFeeds || []).some(
    ([, feed]) =>
      String(feed.userId) === String(userId) && feed.source === source,
  );
}

const currentConnectedChannelName = computed(() => {
  if (!voiceStore.currentChannelId) return "";
  const channel = channelsStore.getChannelById(voiceStore.currentChannelId);
  return channel?.name || "Unknown Channel";
});

function getUserInitials(user) {
  const name = getUserDisplayName(user);
  return name
    .split(" ")
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function getUserDisplayName(user) {
  const profile =
    voiceStore.getUserProfile && user?.id
      ? voiceStore.getUserProfile(user.id)
      : null;
  const merged = { ...profile, ...user };

  try {
    const me = useAuthStore().getUserData && useAuthStore().getUserData();
    if (me && me.id && String(me.id) === String(merged.id)) return "You";
  } catch (_) {
    /* noop */
  }
  return (
    merged.display_name ||
    merged.name ||
    merged.username ||
    merged.email ||
    `User ${merged.id}`
  );
}

function getUserAvatar(user) {
  const profile =
    voiceStore.getUserProfile && user?.id
      ? voiceStore.getUserProfile(user.id)
      : null;
  const merged = { ...profile, ...user };
  const avatar = merged.avatar;
  if (!avatar) return null;

  if (typeof avatar === "string" && /^(https?:)?\/\//i.test(avatar))
    return avatar;
  const base = (config?.public?.baseApiPath || "").replace(/\/$/, "");
  const clean = String(avatar).replace(/^\/+/, "");
  const path = clean.startsWith("auth/") ? clean : `auth/${clean}`;
  return `${base}/${path}`;
}

function getButtonTitle() {
  if (!voiceStore.connected) return "Not connected";
  if (voiceStore.sfuComposable && !voiceStore.sfuComposable.transportReady)
    return "Setting up connection...";
  return voiceStore.micMuted ? "Unmute Microphone" : "Mute Microphone";
}

function isLocalUser(user) {
  try {
    const me = authStore.getUserData && authStore.getUserData();
    return me && me.id && user && String(user.id) === String(me.id);
  } catch (_) {
    return false;
  }
}

async function joinThisChannel() {
  try {
    await voiceStore.joinVoiceChannel(props.channel.id);
  } catch (error) {
    console.error("Failed to join voice channel:", error);
  }
}

async function switchToThisChannel() {
  try {
    await voiceStore.joinVoiceChannel(props.channel.id);
  } catch (error) {
    console.error("Failed to switch voice channel:", error);
  }
}

function navigateToCurrentChannel() {
  if (voiceStore.currentChannelId && voiceStore.currentRoomId) {
    router.push(
      `/room/${voiceStore.currentRoomId}/${voiceStore.currentChannelId}`,
    );
  }
}

async function leaveChannel() {
  try {
    await voiceStore.leaveVoiceChannel();
  } catch (error) {
    console.error("Failed to leave voice channel:", error);
  }
}

onUnmounted(() => {});
</script>

<style scoped>
.voice-channel {
  isolation: isolate;
}

.voice-controls {
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}

@media (hover: hover) and (pointer: fine) {
  .voice-controls {
    pointer-events: none;
    opacity: 0;
    transform: translateY(0.75rem);
  }

  .voice-channel:hover .voice-controls,
  .voice-channel:focus-within .voice-controls {
    pointer-events: auto;
    opacity: 1;
    transform: translateY(0);
  }
}

.animate-pulse {
  animation: pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
</style>
