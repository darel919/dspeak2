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
        <button
          v-if="voiceStore.protocolUpdateRequired"
          type="button"
          class="btn btn-warning btn-sm"
          @click="reloadForMediaUpdate"
        >
          <Icon name="lucide:refresh-cw" />
          <span class="hidden sm:inline">Refresh to update voice</span>
        </button>
        <div
          v-else-if="voiceStore.connecting && !voiceStore.connected"
          class="voice-connecting-status flex items-center gap-2 text-sm"
        >
          <span class="loading loading-spinner loading-sm"></span>
          <span class="hidden sm:inline">{{ connectionPhaseLabel }}</span>
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

    <div
      v-if="remoteSystemAudioShares.length"
      class="grid shrink-0 gap-px border-b border-base-content/15 bg-base-content/15"
      aria-live="polite"
    >
      <div
        v-for="share in remoteSystemAudioShares"
        :key="share.key"
        class="flex items-center justify-between gap-4 bg-base-200 px-4 py-3"
      >
        <div class="flex min-w-0 items-center gap-3">
          <Icon
            name="lucide:audio-lines"
            class="size-5 shrink-0 text-primary"
          />
          <p class="truncate text-sm font-medium">
            {{ share.label }} is sharing system audio
          </p>
        </div>
        <button
          class="btn btn-sm shrink-0"
          :class="share.receiving === false ? 'btn-primary' : 'btn-ghost'"
          type="button"
          @click="setSystemAudioReceiving(share, share.receiving === false)"
        >
          <Icon
            :name="
              share.receiving === false ? 'lucide:volume-2' : 'lucide:volume-x'
            "
            class="size-4"
          />
          {{ share.receiving === false ? "Listen" : "Stop listening" }}
        </button>
      </div>
    </div>

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

    <div
      v-if="
        voiceStore.connected && voiceStore.currentChannelId === props.channel.id
      "
      class="voice-stage flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <div
        v-if="roomTiles.length"
        class="screen-feed-area min-h-0 flex-1 overflow-hidden p-4 md:p-6"
      >
        <div
          class="voice-room-grid h-full min-h-0 w-full"
          :class="{ 'voice-room-grid-focused': viewMode === 'focused' }"
        >
          <div
            v-for="tile in displayedRoomTiles"
            :key="tile.key"
            class="voice-room-tile min-h-0 overflow-hidden"
            :class="{
              'voice-room-tile-focused':
                viewMode === 'focused' && tile.key === focusedTileKey,
              'participant-tile-speaking': tile.user?.speaking,
            }"
            :role="tile.type === 'feed' ? 'button' : undefined"
            :tabindex="tile.type === 'feed' ? 0 : undefined"
            :aria-label="
              tile.type === 'feed'
                ? `Maximize ${tile.feed.label} ${tile.feed.source}`
                : undefined
            "
            @click="tile.type === 'feed' && scheduleTileFocus(tile.key)"
            @dblclick.stop="cancelTileFocus"
            @keydown.enter.prevent="tile.type === 'feed' && focusTile(tile.key)"
            @keydown.space.prevent="tile.type === 'feed' && focusTile(tile.key)"
            @contextmenu.prevent="openTileVolumeMenu(tile)"
          >
            <VideoFeed
              v-if="tile.type === 'feed'"
              :feed-key="tile.feed.key"
              :stream="tile.feed.stream"
              :source="tile.feed.source"
              :label="tile.feed.label"
              :muted="true"
              :local="tile.feed.local"
              :receiving="tile.feed.receiving !== false"
              :compact="viewMode === 'focused' && tile.key !== focusedTileKey"
              :avatar-src="tile.feed.avatar"
              :own-camera-stream="ownCameraFeed?.stream || null"
              :own-camera-feed-key="ownCameraFeed?.key || null"
              @start-receiving="setScreenReceiving(tile.feed, true)"
              @stop-receiving="setScreenReceiving(tile.feed, false)"
            />
            <div
              v-else
              class="participant-tile participant-audio-tile metro-transition group relative flex h-full min-w-0 flex-col items-center justify-center overflow-hidden border"
              :class="
                viewMode === 'focused'
                  ? 'participant-audio-tile-compact p-2'
                  : 'p-6'
              "
            >
              <button
                v-if="!isLocalUser(tile.user)"
                class="btn btn-ghost btn-square btn-sm absolute right-2 top-2 z-10 opacity-70 hover:opacity-100 focus-visible:opacity-100"
                type="button"
                :aria-label="`Adjust volume for ${getUserDisplayName(tile.user)}`"
                @click.stop="openVolumeMenu(tile.user, $event.currentTarget)"
              >
                <Icon name="lucide:volume-2" class="size-4" />
              </button>
              <div
                class="avatar"
                :class="viewMode === 'focused' ? 'mb-0' : 'mb-4'"
              >
                <ProfileAvatar
                  :src="userAvatarSource(tile.user)"
                  :name="getUserDisplayName(tile.user)"
                  class="metro-transition rounded-full bg-primary text-primary-content font-bold ring-2"
                  :class="[
                    viewMode === 'focused'
                      ? 'h-12 w-12 text-sm'
                      : 'h-24 w-24 text-2xl md:h-28 md:w-28',
                    tile.user.speaking
                      ? 'ring-success ring-offset-2 ring-offset-base-100'
                      : 'ring-base-300',
                  ]"
                />
              </div>
              <h4
                class="max-w-full truncate text-center font-semibold"
                :class="
                  viewMode === 'focused' ? 'mt-1 text-sm' : 'mt-4 text-lg'
                "
              >
                {{ getUserDisplayName(tile.user) }}
              </h4>
              <div class="flex items-center gap-2">
                <div
                  v-if="tile.user.muted"
                  class="flex items-center gap-1 text-error"
                >
                  <Icon
                    name="lucide:mic-off"
                    class="size-5"
                    aria-label="Microphone off"
                  />
                </div>
                <div
                  v-if="tile.user.deafened"
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
      <div class="voice-command-dock mx-auto">
        <div class="voice-command-group">
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
            <Icon name="lucide:volume-2" class="size-5" />
          </button>

          <SoundboardPanel
            :room-id="String(channel.room)"
            :channel-id="String(channel.id)"
            compact
          />
        </div>

        <button
          type="button"
          class="voice-dock-button voice-dock-button-leave metro-transition"
          aria-label="Leave voice channel"
          data-label="Leave"
          @click="leaveChannel"
        >
          <Icon name="lucide:phone-off" class="size-5" />
        </button>
      </div>
      <div
        v-if="voiceStore.screenSharing || voiceStore.systemAudioSharing"
        class="shared-audio-status mx-auto mt-3 max-w-3xl"
      >
        <div class="shared-audio-heading">
          <span class="shared-audio-icon">
            <Icon
              :name="
                voiceStore.systemAudioSharing
                  ? 'lucide:volume-2'
                  : 'lucide:monitor-up'
              "
              class="size-4"
            />
          </span>
          <div>
            <p class="text-sm font-semibold">
              {{
                voiceStore.systemAudioSharing
                  ? "System audio is live"
                  : "Screen audio is live"
              }}
            </p>
            <p class="text-xs text-white/60">
              Control what everyone else hears
            </p>
          </div>
        </div>

        <div class="shared-audio-control">
          <label for="shared-audio-volume" class="shared-audio-label">
            <span>Shared volume</span>
            <span class="shared-audio-volume-status">
              <output class="tabular-nums" aria-live="polite">
                <span>{{ voiceStore.sharedAudioVolume }}%</span>
                <template v-if="voiceStore.sharedAudioDucking.active">
                  <span class="shared-audio-ducking-arrow" aria-hidden="true"
                    >→</span
                  >
                  <span class="shared-audio-ducking-value">
                    {{
                      Math.round(
                        (voiceStore.sharedAudioVolume *
                          voiceStore.sharedAudioDucking.effectivePercent) /
                          100,
                      )
                    }}%
                  </span>
                  <span class="sr-only">effective while voice is detected</span>
                </template>
              </output>
            </span>
          </label>
          <input
            id="shared-audio-volume"
            class="range range-primary range-xs w-full"
            type="range"
            min="0"
            max="100"
            step="1"
            :value="voiceStore.sharedAudioVolume"
            @input="voiceStore.setSharedAudioVolume($event.target.value)"
          />
        </div>

        <div
          class="shared-audio-meter"
          :title="`${voiceStore.sharedAudioStats.dbfs.toFixed(1)} dBFS`"
        >
          <div class="shared-audio-label">
            <span>Signal sent</span>
            <span class="tabular-nums"
              >{{ voiceStore.sharedAudioStats.kbps.toFixed(1) }} kbps</span
            >
          </div>
          <progress
            :class="[
              'progress h-2 w-full',
              voiceStore.sharedAudioStats.dbfs >= -12
                ? 'progress-error'
                : 'progress-success',
            ]"
            max="1"
            :value="voiceStore.sharedAudioStats.level"
          ></progress>
          <span class="shared-audio-detail tabular-nums">
            {{ voiceStore.sharedAudioStats.dbfs.toFixed(1) }} dBFS
          </span>
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
        class="mb-2 text-xs font-semibold uppercase tracking-widest text-white"
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
      <div
        v-if="voiceStore.protocolUpdateRequired"
        class="mb-6 max-w-md bg-warning/15 px-4 py-3 text-sm text-warning"
        role="alert"
      >
        Voice signaling was updated. Refresh dSpeak before reconnecting.
      </div>
      <button
        @click="
          voiceStore.protocolUpdateRequired
            ? reloadForMediaUpdate()
            : joinThisChannel()
        "
        :disabled="voiceStore.connecting"
        class="btn btn-primary btn-lg disabled:opacity-100"
      >
        <Icon name="lucide:mic" class="size-6" />

        <span
          v-if="voiceStore.connecting"
          class="loading loading-spinner loading-sm mr-2"
        ></span>
        {{
          voiceStore.protocolUpdateRequired
            ? "Refresh to update voice"
            : voiceStore.connecting
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
import { useSettingsStore } from "~/stores/settings";
import { useIdentityStore } from "~/stores/identity";
import { useChannelsStore } from "~/stores/channels";

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
const viewMode = ref("overview");
const connectionPhaseLabel = computed(() => {
  const phase = voiceStore.sfuComposable?.connectionPhase;
  if (phase === "protocol-negotiating") return "Negotiating connection";
  if (phase === "topology-selecting") return "Selecting media route";
  if (phase === "transport-connecting") return "Connecting media";
  if (phase === "reconnecting") return "Reconnecting";
  return "Connecting";
});

function reloadForMediaUpdate() {
  window.location.reload();
}
const focusedTileKey = ref(null);
let tileFocusTimer = null;

const connectedUsers = computed(() => {
  return voiceStore.getDisplayUsersArray();
});
const videoFeeds = computed(() => {
  const currentUser = authStore.getUserData?.();
  const currentUserId = currentUser?.id;
  const local = Array.from(voiceStore.localVideoFeeds).map(
    ([source, feed]) => ({
      ...feed,
      source,
      key: `local-${source}`,
      userId: currentUserId ? String(currentUserId) : "local",
      local: true,
      label: "You",
      avatar: userAvatarSource(currentUser || { id: currentUserId }),
    }),
  );
  const remote = Array.from(voiceStore.remoteVideoFeeds).map(
    ([producerId, feed]) => {
      const user = voiceStore.getUserById(feed.userId) || { id: feed.userId };
      return {
        ...feed,
        source: feed.source,
        key: producerId,
        local: false,
        label: getUserDisplayName(user),
        avatar: userAvatarSource(user),
      };
    },
  );
  return [...local, ...remote].sort(
    (a, b) => Number(b.source === "screen") - Number(a.source === "screen"),
  );
});
const roomTiles = computed(() => {
  const representedUsers = new Set(
    videoFeeds.value.map((feed) => String(feed.userId)),
  );
  const feeds = videoFeeds.value.map((feed) => ({
    key: `feed-${feed.key}`,
    type: "feed",
    feed,
  }));
  const participants = connectedUsers.value
    .filter((user) => !representedUsers.has(String(user.id)))
    .map((user) => ({
      key: `participant-${user.id}`,
      type: "participant",
      user,
    }));
  return [...feeds, ...participants];
});
const displayedRoomTiles = computed(() => {
  if (viewMode.value !== "focused") return roomTiles.value;
  return [...roomTiles.value].sort(
    (a, b) =>
      Number(b.key === focusedTileKey.value) -
      Number(a.key === focusedTileKey.value),
  );
});
const ownCameraFeed = computed(
  () =>
    videoFeeds.value.find((feed) => feed.local && feed.source === "camera") ||
    null,
);

const settingsStore = useSettingsStore();

const isChannelModerator = computed(() => {
  const channel = props.channel;
  const userData = authStore.getUserData?.();
  if (!userData?.id || !channel) return false;
  const ownerId = channel.owner?.id || channel.owner;
  if (String(ownerId) === String(userData.id)) return true;
  const room = channelsStore.getRoomChannels(channel.room);
  const membership = room
    ?.find((c) => c.id === channel.id)
    ?.expand?.memberships?.find((m) => String(m.user) === String(userData.id));
  return (
    membership?.expand?.roles?.some((r) =>
      r.permissions?.includes("channel.moderate_voice"),
    ) || false
  );
});

function volumeUserForTile(tile) {
  if (tile.type === "participant") return tile.user;
  if (tile.type !== "feed" || tile.feed.local) return null;
  return voiceStore.getUserById(tile.feed.userId) || { id: tile.feed.userId };
}

function openTileVolumeMenu(tile) {
  const user = volumeUserForTile(tile);
  if (user) openVolumeMenu(user);
}

function focusTile(key) {
  if (viewMode.value === "focused" && focusedTileKey.value === key) {
    viewMode.value = "overview";
    return;
  }
  focusedTileKey.value = key;
  viewMode.value = "focused";
}

function cancelTileFocus() {
  if (tileFocusTimer) clearTimeout(tileFocusTimer);
  tileFocusTimer = null;
}

function scheduleTileFocus(key) {
  cancelTileFocus();
  tileFocusTimer = setTimeout(() => {
    tileFocusTimer = null;
    focusTile(key);
  }, 240);
}

watch(roomTiles, (tiles) => {
  if (
    focusedTileKey.value &&
    !tiles.some((tile) => tile.key === focusedTileKey.value)
  ) {
    focusedTileKey.value =
      tiles.find((tile) => tile.type === "feed")?.key || null;
    if (!focusedTileKey.value) viewMode.value = "overview";
  }
});
const remoteSystemAudioShares = computed(() => {
  const screenOwners = new Set(
    Array.from(voiceStore.remoteVideoFeeds)
      .filter(([, feed]) => feed.source === "screen")
      .map(([, feed]) => String(feed.userId)),
  );
  return Array.from(voiceStore.remoteAudioFeeds)
    .filter(
      ([, feed]) =>
        feed.source === "screen-audio" &&
        !screenOwners.has(String(feed.userId)),
    )
    .map(([key, feed]) => ({
      ...feed,
      key,
      label: getUserDisplayName(
        voiceStore.getUserById(feed.userId) || { id: feed.userId },
      ),
    }));
});

function setScreenReceiving(feed, receiving) {
  if (feed.local || feed.source !== "screen") return;
  voiceStore.setRemoteScreenReceiving(feed.key, receiving);
}

function setSystemAudioReceiving(feed, receiving) {
  voiceStore.setRemoteSystemAudioReceiving(feed.key, receiving);
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
  return Array.from(voiceStore.remoteAudioFeeds).some(
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
  } catch (_) {}
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
onUnmounted(() => {
  cancelTileFocus();
  document.removeEventListener("keydown", onVolumeDialogKeydown);
});
</script>

<style scoped>
.voice-channel {
  isolation: isolate;
}

.voice-connecting-status {
  color: #63c7f2;
}

.voice-stage {
  background: #050505;
}

.screen-feed-area {
  container-type: size;
}

.voice-room-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-auto-rows: minmax(0, 1fr);
  place-content: center;
  gap: 0.75rem;
}

.voice-room-grid:not(.voice-room-grid-focused)
  .voice-room-tile:last-child:nth-child(odd) {
  justify-self: center;
}

.voice-room-tile {
  min-width: 0;
  border: 1px solid rgb(255 255 255 / 12%);
  background: #000;
  cursor: default;
}

.voice-room-tile[role="button"] {
  cursor: pointer;
}

.voice-room-tile[role="button"]:focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: 2px;
}

.voice-room-grid-focused {
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  justify-content: center;
}

.voice-room-tile-focused {
  width: 100%;
  height: calc(100% - 9rem);
  flex: 0 0 100%;
}

.voice-room-grid-focused .voice-room-tile:not(.voice-room-tile-focused) {
  width: min(14rem, calc(50% - 0.375rem));
  height: 8rem;
  flex: 0 0 min(14rem, calc(50% - 0.375rem));
}

.participant-audio-tile-compact {
  min-height: 0;
}

.screen-feed-frame-single {
  width: 100%;
  max-width: 100%;
  max-height: 100%;
  aspect-ratio: 16 / 9;
  contain: size layout paint;
}

@supports (width: 1cqw) and (height: 1cqh) {
  .screen-feed-frame-single {
    width: min(100cqw, calc(100cqh * 16 / 9));
  }
}

@container (min-width: 36.75rem) {
  .voice-room-grid:not(.voice-room-grid-focused) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .voice-room-grid:not(.voice-room-grid-focused)
    .voice-room-tile:last-child:nth-child(odd) {
    grid-column: 1 / -1;
    width: calc(50% - 0.375rem);
  }
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

.voice-command-dock {
  display: flex;
  width: fit-content;
  max-width: 100%;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.voice-command-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
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
  margin-left: 0.5rem;
}

.shared-audio-status {
  display: grid;
  grid-template-columns: minmax(11rem, 1fr) minmax(12rem, 1.5fr) 1fr;
  align-items: center;
  gap: 1rem;
  border: 1px solid rgb(255 255 255 / 14%);
  background: #151619;
  padding: 1rem;
  color: #f2f3f5;
}

.shared-audio-heading {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.75rem;
}

.shared-audio-icon {
  display: grid;
  width: 2.5rem;
  height: 2.5rem;
  flex: 0 0 auto;
  place-items: center;
  background: var(--color-primary);
  color: var(--color-primary-content);
}

.shared-audio-control,
.shared-audio-meter {
  min-width: 0;
}

.shared-audio-volume-status {
  display: flex;
  min-width: 7.5rem;
  align-items: center;
  justify-content: flex-end;
}

.shared-audio-ducking-arrow {
  margin: 0 0.375rem;
  color: rgb(242 243 245 / 48%);
}

.shared-audio-ducking-value {
  color: var(--color-warning);
  font-weight: 700;
}

.shared-audio-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
  color: #f2f3f5;
  font-size: 0.75rem;
  font-weight: 600;
}

.shared-audio-detail {
  display: block;
  margin-top: 0.375rem;
  overflow: hidden;
  color: rgb(242 243 245 / 60%);
  font-size: 0.6875rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 64rem) {
  .shared-audio-status {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 30rem) {
  .voice-dock-button-leave {
    margin-left: 0;
  }

  .shared-audio-status {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
