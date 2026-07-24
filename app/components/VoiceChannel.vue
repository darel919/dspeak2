<template>
  <div class="voice-channel relative flex h-full flex-col bg-base-200">
    <header
      class="voice-channel-header flex min-h-12 shrink-0 items-center justify-between gap-4 border-b border-white/10 bg-black px-4 text-white"
    >
      <div class="flex min-w-0 items-center gap-3">
        <span class="grid size-8 shrink-0 place-items-center">
          <Icon name="lucide:volume-2" class="size-5 text-primary" />
        </span>
        <div class="min-w-0">
          <h1 class="truncate text-sm font-semibold">{{ channel.name }}</h1>
        </div>
      </div>

      <div class="flex shrink-0 items-center gap-2" aria-live="polite">
        <div
          v-if="voiceStore.connecting && !voiceStore.connected"
          class="flex items-center gap-2 text-sm text-info"
        >
          <span class="loading loading-spinner loading-sm"></span>
          <span class="hidden sm:inline">Connecting</span>
        </div>
        <span
          v-else-if="voiceStore.connected"
          class="inline-flex items-center gap-2 text-sm text-success"
        >
          <span class="size-2 bg-success"></span>
          <span class="hidden sm:inline">Voice connected</span>
        </span>
      </div>
    </header>

    <!-- Connection Info Banner -->
    <div
      v-if="
        voiceStore.connected && voiceStore.currentChannelId !== props.channel.id
      "
      class="metro-status m-4 border-info bg-info/10 text-info"
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
      class="voice-stage flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <!-- Video owns the available stage; the grid expands and reflows as feeds appear. -->
      <div
        v-if="videoFeeds.length"
        class="flex min-h-0 flex-1 items-center justify-center px-4 py-3 md:px-8 md:py-5"
      >
        <div
          class="grid h-full min-h-0 w-full content-center justify-center gap-3"
          :class="
            videoFeeds.length === 1
              ? 'grid-cols-1 max-w-7xl'
              : 'grid-cols-1 md:grid-cols-2'
          "
        >
          <div
            v-for="feed in videoFeeds"
            :key="feed.key"
            class="mx-auto min-h-0 overflow-hidden bg-black"
            :class="
              videoFeeds.length === 1
                ? 'aspect-video h-full w-auto max-w-full'
                : 'aspect-video w-full'
            "
          >
            <VideoFeed
              :feed-key="feed.key"
              :stream="feed.stream"
              :source="feed.source"
              :label="feed.label"
              :muted="feed.local"
              :local="feed.local"
              :receiving="feed.receiving !== false"
              :own-camera-stream="ownCameraFeed?.stream || null"
              :own-camera-feed-key="ownCameraFeed?.key || null"
              @start-receiving="setScreenReceiving(feed, true)"
              @stop-receiving="setScreenReceiving(feed, false)"
            />
          </div>
        </div>
      </div>
      <!-- Participants Grid -->
      <div
        v-if="!videoFeeds.length || showParticipants"
        :class="
          videoFeeds.length
            ? 'shrink-0 px-4 pb-3'
            : 'min-h-0 flex-1 overflow-y-auto p-4 md:p-6'
        "
      >
        <div v-if="connectedUsers.length > 0" class="h-full">
          <!-- Participants Grid Layout -->
          <div
            :class="
              videoFeeds.length
                ? 'flex max-w-full items-center justify-center gap-3 overflow-x-auto'
                : 'participant-grid grid h-full gap-3'
            "
          >
            <div
              v-for="user in connectedUsers"
              :key="user.id"
              class="participant-tile metro-transition group relative flex min-w-0 flex-col items-center justify-center overflow-hidden border border-white/10 bg-base-300"
              :class="[
                videoFeeds.length
                  ? 'min-w-36 border-base-content/20 bg-base-300 px-3 py-3'
                  : connectedUsers.length === 1
                    ? 'participant-audio-tile h-full min-h-0 p-6'
                    : 'participant-audio-tile min-h-48 p-6 md:min-h-56',
                user.speaking ? 'participant-tile-speaking' : '',
              ]"
              @contextmenu.prevent="openVolumeMenu(user)"
            >
              <button
                v-if="!isLocalUser(user)"
                class="btn btn-ghost btn-square btn-sm absolute right-2 top-2 z-10 opacity-70 hover:opacity-100 focus-visible:opacity-100"
                type="button"
                :aria-label="`Adjust volume for ${getUserDisplayName(user)}`"
                @click.stop="openVolumeMenu(user, $event.currentTarget)"
              >
                <Icon name="lucide:volume-2" class="size-4" />
              </button>
              <!-- User Avatar -->
              <div class="avatar" :class="videoFeeds.length ? 'mb-1' : 'mb-4'">
                <ProfileAvatar
                  :src="userAvatarSource(user)"
                  :name="getUserDisplayName(user)"
                  :base-api-path="config.public.baseApiPath"
                  class="metro-transition rounded-full bg-primary text-primary-content font-bold ring-2"
                  :class="[
                    videoFeeds.length
                      ? 'h-14 w-14 text-sm'
                      : 'h-24 w-24 text-2xl md:h-28 md:w-28',
                    user.speaking
                      ? 'ring-success ring-offset-2 ring-offset-base-100'
                      : 'ring-base-300',
                  ]"
                />
              </div>
              <!-- User Name -->
              <h4
                class="font-semibold text-center"
                :class="
                  videoFeeds.length
                    ? 'mt-2 max-w-32 truncate text-sm'
                    : 'mt-4 max-w-full truncate text-lg'
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
                  <Icon
                    name="lucide:mic-off"
                    class="size-5"
                    aria-label="Microphone off"
                  />
                </div>
                <div
                  v-if="user.deafened"
                  class="flex items-center gap-1 text-error"
                >
                  <Icon
                    name="lucide:volume-x"
                    class="size-5"
                    aria-label="Deafened"
                  />
                </div>
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

    <Teleport to="body">
      <div
        v-if="volumeMenuUser"
        class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
        role="presentation"
        @pointerdown.self="closeVolumeMenu"
      >
        <section
          ref="volumeDialog"
          class="w-full max-w-md border border-base-content/20 bg-base-200 text-base-content shadow-2xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="participant-volume-title"
          tabindex="-1"
        >
          <header
            class="flex items-center justify-between gap-4 border-b border-base-content/15 px-5 py-4"
          >
            <div class="min-w-0">
              <p
                class="text-xs font-semibold uppercase tracking-wider text-base-content/55"
              >
                Playback volume
              </p>
              <h4
                id="participant-volume-title"
                class="truncate text-lg font-bold"
              >
                {{ getUserDisplayName(volumeMenuUser) }}
              </h4>
            </div>
            <button
              class="btn btn-ghost btn-square btn-sm shrink-0"
              type="button"
              aria-label="Close volume settings"
              @click="closeVolumeMenu"
            >
              <Icon name="lucide:x" class="size-5" />
            </button>
          </header>

          <div class="space-y-6 p-5">
            <div>
              <div class="mb-3 flex items-center justify-between gap-3">
                <label
                  class="flex items-center gap-2 font-semibold"
                  for="participant-voice-volume"
                >
                  <Icon name="lucide:mic" class="size-4 text-primary" />
                  Voice
                </label>
                <output class="text-sm font-semibold tabular-nums">
                  {{ trackVolumePercent(volumeMenuUser.id, "audio") }}%
                </output>
              </div>
              <input
                id="participant-voice-volume"
                class="range range-primary w-full"
                type="range"
                min="0"
                max="2"
                step="0.01"
                :value="voiceStore.getTrackVolume(volumeMenuUser.id, 'audio')"
                @input="onTrackVolumeChange(volumeMenuUser.id, 'audio', $event)"
              />
              <div
                class="mt-2 flex justify-between text-xs text-base-content/55"
              >
                <span>Muted</span>
                <span>200%</span>
              </div>
            </div>

            <div v-if="hasAudioSource(volumeMenuUser.id, 'screen-audio')">
              <div class="mb-3 flex items-center justify-between gap-3">
                <label
                  class="flex items-center gap-2 font-semibold"
                  for="participant-screen-volume"
                >
                  <Icon
                    name="lucide:monitor-up"
                    class="size-4 text-secondary"
                  />
                  Screen share
                </label>
                <output class="text-sm font-semibold tabular-nums">
                  {{ trackVolumePercent(volumeMenuUser.id, "screen-audio") }}%
                </output>
              </div>
              <input
                id="participant-screen-volume"
                class="range range-secondary w-full"
                type="range"
                min="0"
                max="2"
                step="0.01"
                :value="
                  voiceStore.getTrackVolume(volumeMenuUser.id, 'screen-audio')
                "
                @input="
                  onTrackVolumeChange(volumeMenuUser.id, 'screen-audio', $event)
                "
              />
              <div
                class="mt-2 flex justify-between text-xs text-base-content/55"
              >
                <span>Muted</span>
                <span>200%</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </Teleport>

    <footer
      v-if="
        voiceStore.connected && voiceStore.currentChannelId === props.channel.id
      "
      class="voice-command-bar shrink-0 border-t border-white/10 bg-black px-3 py-3 text-white"
    >
      <div
        class="voice-command-dock mx-auto flex w-fit max-w-full items-center gap-2"
      >
        <div class="flex min-w-0 items-center gap-2 overflow-x-auto">
          <MediaSettingsContextMenu kind="microphone">
            <button
              @click="voiceStore.toggleMic"
              :disabled="
                !voiceStore.connected ||
                (voiceStore.sfuComposable &&
                  !voiceStore.sfuComposable.transportReady)
              "
              :class="[
                'voice-dock-button metro-transition',
                voiceStore.micMuted ? 'voice-dock-button-danger' : '',
              ]"
              :aria-label="getButtonTitle()"
              :data-label="voiceStore.micMuted ? 'Unmute' : 'Mute'"
            >
              <Icon
                :name="voiceStore.micMuted ? 'lucide:mic-off' : 'lucide:mic'"
                class="size-5"
              />
            </button>
          </MediaSettingsContextMenu>

          <button
            @click="voiceStore.toggleDeafen"
            :class="[
              'voice-dock-button metro-transition',
              voiceStore.deafened ? 'voice-dock-button-danger' : '',
            ]"
            :aria-label="voiceStore.deafened ? 'Undeafen' : 'Deafen'"
            :data-label="voiceStore.deafened ? 'Undeafen' : 'Deafen'"
          >
            <Icon
              :name="
                voiceStore.deafened ? 'lucide:volume-x' : 'lucide:headphones'
              "
              class="size-5"
            />
          </button>

          <MediaSettingsContextMenu kind="camera">
            <button
              class="voice-dock-button metro-transition"
              :class="
                voiceStore.cameraEnabled ? 'voice-dock-button-active' : ''
              "
              :aria-label="
                voiceStore.cameraEnabled ? 'Turn camera off' : 'Turn camera on'
              "
              :data-label="
                voiceStore.cameraEnabled ? 'Turn camera off' : 'Turn camera on'
              "
              @click="toggleCamera"
            >
              <Icon name="lucide:camera" class="size-5" />
            </button>
          </MediaSettingsContextMenu>

          <button
            class="voice-dock-button metro-transition"
            :class="voiceStore.screenSharing ? 'voice-dock-button-active' : ''"
            :aria-label="
              voiceStore.screenSharing
                ? 'Stop sharing screen'
                : 'Share your screen'
            "
            :data-label="
              voiceStore.screenSharing ? 'Stop sharing' : 'Share screen'
            "
            @click="toggleScreenShare"
          >
            <Icon name="lucide:monitor-up" class="size-5" />
          </button>

          <button
            class="voice-dock-button metro-transition"
            :class="
              voiceStore.systemAudioSharing ? 'voice-dock-button-active' : ''
            "
            :aria-label="
              voiceStore.systemAudioSharing
                ? 'Stop sharing system audio'
                : 'Share system audio only'
            "
            :data-label="
              voiceStore.systemAudioSharing
                ? 'Stop system audio'
                : 'System audio'
            "
            @click="toggleSystemAudioShare"
          >
            <Icon name="lucide:audio-lines" class="size-5" />
          </button>

          <SoundboardPanel
            :room-id="String(channel.room)"
            :channel-id="String(channel.id)"
            compact
          />

          <button
            v-if="videoFeeds.length"
            type="button"
            class="voice-dock-button metro-transition"
            :class="showParticipants ? 'voice-dock-button-active' : ''"
            :aria-pressed="showParticipants"
            aria-label="Show participants"
            :data-label="
              showParticipants ? 'Hide participants' : 'Show participants'
            "
            @click="showParticipants = !showParticipants"
          >
            <Icon name="lucide:users" class="size-5" />
          </button>
        </div>

        <button
          type="button"
          class="voice-dock-button voice-dock-button-leave metro-transition shrink-0"
          aria-label="Leave voice channel"
          data-label="Leave"
          @click="leaveChannel"
        >
          <Icon name="lucide:phone-off" class="size-5" />
        </button>
      </div>
      <div
        v-if="voiceStore.screenSharing || voiceStore.systemAudioSharing"
        class="mx-auto mt-2 flex max-w-3xl flex-wrap items-center gap-3 bg-base-200 p-3"
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
    </footer>

    <div
      v-if="!voiceStore.connected"
      class="voice-stage flex flex-1 flex-col items-center justify-center px-6 py-12 text-center text-white"
    >
      <span
        class="mb-6 grid size-20 place-items-center bg-primary/20 text-primary"
      >
        <Icon name="lucide:phone-outgoing" class="size-9 text-primary" />
      </span>
      <p
        class="mb-2 text-xs font-semibold uppercase tracking-widest text-primary"
      >
        Voice channel
      </p>
      <h2 class="mb-3 text-2xl font-semibold text-white">
        Join {{ props.channel.name }}
      </h2>
      <p class="mb-8 max-w-md text-white/65">
        Talk, share your camera, or present your screen. Your saved microphone
        and audio settings will be applied when you join.
      </p>
      <button
        @click="joinThisChannel"
        :disabled="voiceStore.connecting"
        class="btn btn-primary btn-lg"
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
import { useIdentityStore } from "~/stores/identity";

const props = defineProps({
  channel: {
    type: Object,
    required: true,
  },
});

const voiceStore = useVoiceStore();
const authStore = useAuthStore();
const identityStore = useIdentityStore();
const channelsStore = useChannelsStore();
const router = useRouter();
const config = useRuntimeConfig();
const showParticipants = ref(true);

const connectedUsers = computed(() => {
  return voiceStore.getDisplayUsersArray();
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
const ownCameraFeed = computed(
  () =>
    videoFeeds.value.find((feed) => feed.local && feed.source === "camera") ||
    null,
);

function setScreenReceiving(feed, receiving) {
  if (feed.local || feed.source !== "screen") return;
  voiceStore.setRemoteScreenReceiving(feed.key, receiving);
}

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
const volumeDialog = ref(null);
let volumeMenuTrigger = null;

async function openVolumeMenu(user, trigger = null) {
  if (isLocalUser(user)) return;
  volumeMenuTrigger = trigger instanceof HTMLElement ? trigger : null;
  volumeMenuUser.value = user;
  await nextTick();
  volumeDialog.value?.focus();
}
function closeVolumeMenu() {
  volumeMenuUser.value = null;
  nextTick(() => volumeMenuTrigger?.focus());
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

function trackVolumePercent(userId, source) {
  return Math.round(voiceStore.getTrackVolume(userId, source) * 100);
}

function onVolumeDialogKeydown(event) {
  if (event.key === "Escape" && volumeMenuUser.value) closeVolumeMenu();
}

const currentConnectedChannelName = computed(() => {
  if (!voiceStore.currentChannelId) return "";
  const channel = channelsStore.getChannelById(voiceStore.currentChannelId);
  return channel?.name || "Unknown Channel";
});

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
  return identityStore.displayName(merged);
}

function userAvatarSource(user) {
  const currentUser = authStore.getUserData?.();
  if (
    currentUser?.id &&
    user?.id &&
    String(currentUser.id) === String(user.id)
  ) {
    return currentUser.avatar || "";
  }
  const profile =
    voiceStore.getUserProfile && user?.id
      ? voiceStore.getUserProfile(user.id)
      : null;
  const merged = { ...profile, ...user };
  return merged.avatar || "";
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

onMounted(() => document.addEventListener("keydown", onVolumeDialogKeydown));
onUnmounted(() =>
  document.removeEventListener("keydown", onVolumeDialogKeydown),
);
</script>

<style scoped>
.voice-channel {
  isolation: isolate;
}

.voice-stage {
  background: #050505;
}

.participant-grid {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
}

.participant-tile {
  box-shadow: inset 0 -4px 0 transparent;
}

.voice-stage .participant-tile:not(.participant-audio-tile) {
  background: #18191c;
  color: #f2f3f5;
}

.participant-tile-speaking {
  border-color: var(--color-success);
  box-shadow: inset 0 -4px 0 var(--color-success);
}

.participant-audio-tile {
  border-color: rgb(255 255 255 / 12%);
  background: #cdb597;
  color: #171717;
}

.voice-dock-button,
:deep(.voice-dock-button) {
  position: relative;
  display: inline-flex;
  width: 2.75rem;
  height: 2.75rem;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: 0;
  background: #1e1f22;
  color: #f2f3f5;
}

.voice-dock-button:hover,
:deep(.voice-dock-button:hover) {
  background: #35373c;
}

.voice-dock-button::after,
:deep(.voice-dock-button::after) {
  position: absolute;
  bottom: calc(100% + 0.5rem);
  left: 50%;
  z-index: 50;
  max-width: 12rem;
  padding: 0.375rem 0.5rem;
  background: var(--color-neutral);
  color: var(--color-neutral-content);
  content: attr(data-label);
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1rem;
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, 0.25rem);
  transition:
    opacity 120ms ease,
    transform 120ms ease;
  white-space: nowrap;
}

.voice-dock-button:hover::after,
.voice-dock-button:focus-visible::after,
:deep(.voice-dock-button:hover::after),
:deep(.voice-dock-button:focus-visible::after) {
  opacity: 1;
  transform: translate(-50%, 0);
}

.voice-dock-button-active {
  background: var(--color-primary);
  color: var(--color-primary-content);
}

.voice-dock-button-danger,
.voice-dock-button-leave {
  background: var(--color-error);
  color: var(--color-error-content);
}

.voice-dock-button-leave {
  margin-left: 0.25rem;
}
</style>
