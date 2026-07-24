<script setup>
import { useAuthStore } from "../stores/auth";
import { useRoomsStore } from "../stores/rooms";
import { useVoiceStore } from "../stores/voice";
import { useChannelsStore } from "../stores/channels";
import { useChatStore } from "../stores/chat";
import { useSettingsStore } from "../stores/settings";
import { useRtcStatsStore } from "../stores/rtc-stats";
import { isScreenShareFpsBelowTarget } from "../shared/video-settings";
import { getActiveConnectionLabel } from "../shared/connection-quality";
import { useChatUtils } from "../composables/useChatUtils";

const authStore = useAuthStore();
const roomsStore = useRoomsStore();
const voiceStore = useVoiceStore();
const chatStore = useChatStore();
const channelsStore = useChannelsStore();
const settingsStore = useSettingsStore();
const rtcStatsStore = useRtcStatsStore();
const route = useRoute();
const router = useRouter();
const config = useRuntimeConfig();
const { getAvatarUrl } = useChatUtils();

const profile = computed(() => authStore.getUserData());
const profileAvatar = computed(() =>
  getAvatarUrl(profile.value?.avatar, config.public.baseApiPath),
);
const broadcastMode = computed(() => settingsStore.broadcastMode);
const presenceStatus = inject("presenceStatus", ref(null));
const rtcSummaryVisible = useState("rtc-summary-visible", () => false);
const callMenu = ref(null);
const callMenuOpen = ref(false);

const currentRoomId = computed(() =>
  route.path.startsWith("/room/") ? route.params.roomId : null,
);
const currentRoom = computed(() =>
  currentRoomId.value ? roomsStore.getRoomById(currentRoomId.value) : null,
);
const roomBannerUrl = computed(() =>
  roomAssetUrl(currentRoom.value?.headerImage),
);
const roomBannerStyle = computed(() => ({
  backgroundImage: roomBannerUrl.value
    ? `url(${JSON.stringify(roomBannerUrl.value)})`
    : undefined,
}));
const currentVoiceChannel = computed(() =>
  voiceStore.currentChannelId
    ? channelsStore.getChannelById(voiceStore.currentChannelId)
    : null,
);
const isDisconnected = computed(
  () => presenceStatus?.value === "permanently-disconnected",
);
const connectionWarning = computed(() => {
  if (chatStore.offline) return "Offline";
  if (isDisconnected.value || chatStore.error) return "Connection issue";
  return "";
});
const avatarStatusClass = computed(() => {
  if (voiceStore.error && !voiceStore.connected) return "avatar-offline";
  if (presenceStatus?.value === "connected") return "avatar-online";
  if (presenceStatus?.value) return "avatar-offline";
  return "";
});
const micUnavailable = computed(
  () =>
    voiceStore.connecting ||
    Boolean(
      voiceStore.connected &&
      voiceStore.sfuComposable &&
      !voiceStore.sfuComposable.transportReady,
    ),
);

const lastRttMs = computed(() => rtcStatsStore.metrics.rttMs);
const lastJitterMs = computed(() => rtcStatsStore.metrics.jitterMs);
const lastLoss = computed(() => rtcStatsStore.metrics.loss);
const signalLevel = computed(() =>
  rtcStatsStore.metrics.connected ? rtcStatsStore.metrics.score : 0,
);
const activeRouteLabel = computed(() => {
  const mode = rtcStatsStore.snapshot?.topology?.mode;
  return mode === "p2p-direct"
    ? "P2P"
    : mode === "p2p-mesh"
      ? "Mesh"
      : mode === "sfu-ipv4"
        ? "SFU IPv4"
        : "SFU";
});
const signalLabel = computed(() =>
  getActiveConnectionLabel(
    signalLevel.value,
    voiceStore.sfuComposable?.mediaConnectionState,
    rtcStatsStore.metrics.connected,
  ),
);
const signalColorClass = computed(() => {
  if (signalLevel.value >= 4) return "bg-success";
  if (signalLevel.value >= 2) return "bg-warning";
  if (signalLevel.value === 1) return "bg-error";
  return "bg-base-content/40";
});
const signalTooltip = computed(() => {
  const parts = [signalLabel.value];
  if (lastRttMs.value != null)
    parts.push(`RTT ${Math.round(lastRttMs.value)} ms`);
  if (lastJitterMs.value != null)
    parts.push(`Jitter ${Math.round(lastJitterMs.value)} ms`);
  if (lastLoss.value != null)
    parts.push(`Loss ${(lastLoss.value * 100).toFixed(1)}%`);
  return parts.join(" • ");
});

const outboundVideoStats = computed(() => rtcStatsStore.outbound);
const outboundVideoLabels = computed(() =>
  outboundVideoStats.value
    .map((stat) => ({ source: stat.source, text: formatVideoQuality(stat) }))
    .filter((item) => item.text),
);
const screenShareFpsLow = computed(() => {
  const screen = outboundVideoStats.value.find(
    (stat) => stat.source === "screen",
  );
  return (
    voiceStore.screenSharing &&
    Boolean(screen) &&
    isScreenShareFpsBelowTarget(screen.fps, screen.targetFps)
  );
});

const elapsedText = ref("");
let elapsedTimer = null;

function formatVideoQuality(stat) {
  if (!stat?.width || !stat?.height) return "";
  const resolution = Math.min(stat.width, stat.height);
  const fps = stat.fps ? Math.round(stat.fps) : null;
  return `${resolution}p${fps ? `@${fps}fps` : ""}`;
}

function roomAssetUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//.test(path)) return path;
  return `${config.public.apiPath.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function formatElapsed(ms) {
  if (ms <= 0 || !Number.isFinite(ms)) return "";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value) => value.toString().padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

function updateElapsedTime() {
  elapsedText.value =
    voiceStore.connected && voiceStore.connectedAt
      ? formatElapsed(Date.now() - voiceStore.connectedAt)
      : "";
}

function startElapsedTimer() {
  if (elapsedTimer) return;
  updateElapsedTime();
  elapsedTimer = setInterval(updateElapsedTime, 1000);
}

function stopElapsedTimer() {
  if (elapsedTimer) clearInterval(elapsedTimer);
  elapsedTimer = null;
  elapsedText.value = "";
}

function navigateToVoiceChannel() {
  if (voiceStore.currentChannelId && voiceStore.currentRoomId) {
    router.push(
      `/room/${voiceStore.currentRoomId}/${voiceStore.currentChannelId}`,
    );
  }
}

function toggleBroadcastMode() {
  settingsStore.setBroadcastMode(!settingsStore.broadcastMode);
}

function barClass(level) {
  return signalLevel.value >= level ? "" : "opacity-25";
}

function closeCallMenu() {
  callMenu.value?.removeAttribute("open");
  callMenuOpen.value = false;
}

function syncCallMenuState(event) {
  callMenuOpen.value = event.currentTarget.open;
}

function dismissCallMenu(event) {
  if (event.type === "keydown" && event.key !== "Escape") return;
  if (event.type === "pointerdown" && callMenu.value?.contains(event.target))
    return;
  closeCallMenu();
}

watch(
  () => voiceStore.connected,
  (connected) => {
    if (connected) startElapsedTimer();
    else stopElapsedTimer();
  },
  { immediate: true },
);

onMounted(() => {
  rtcStatsStore.start();
  startElapsedTimer();
  document.addEventListener("pointerdown", dismissCallMenu);
  document.addEventListener("keydown", dismissCallMenu);
  window.addEventListener("blur", closeCallMenu);
});
onBeforeUnmount(() => {
  stopElapsedTimer();
  document.removeEventListener("pointerdown", dismissCallMenu);
  document.removeEventListener("keydown", dismissCallMenu);
  window.removeEventListener("blur", closeCallMenu);
});
</script>

<template>
  <header
    class="navbar navbar-surface room-navbar fixed top-0 left-0 z-50 w-full gap-3 px-3 sm:px-4"
    style="height: var(--navbar-height)"
  >
    <Transition name="room-banner">
      <div
        v-if="roomBannerUrl"
        class="room-banner pointer-events-none absolute inset-y-0 left-0 right-0 md:left-[72px]"
        :style="roomBannerStyle"
        aria-hidden="true"
      >
        <div class="room-banner-shade absolute inset-0"></div>
      </div>
    </Transition>

    <div class="relative z-10 flex min-w-0 items-center gap-3">
      <NuxtLink
        to="/"
        class="shrink-0 focus-visible:outline-2 focus-visible:outline-primary"
        aria-label="dSpeak home"
      >
        <img
          class="pointer-events-none size-11 select-none"
          src="/assets/logo/logo_96.png"
          alt=""
        />
      </NuxtLink>
    </div>

    <div class="relative z-10 ml-auto flex min-w-0 items-center gap-2">
      <div
        v-if="connectionWarning"
        class="flex items-center gap-2 text-xs font-semibold text-warning"
        role="status"
      >
        <Icon name="lucide:wifi-off" class="size-4" />
        <span class="hidden sm:inline">{{ connectionWarning }}</span>
      </div>

      <NotificationCenter />
      <section
        v-if="profile"
        class="call-dock"
        :class="voiceStore.connected && 'call-dock-connected'"
        aria-label="Voice call controls"
      >
        <div v-if="voiceStore.connected" class="call-channel">
          <span class="status-dot" aria-hidden="true"></span>
          <span class="min-w-0 text-left">
            <button
              class="channel-link block max-w-full truncate text-sm font-semibold"
              type="button"
              title="Return to the active voice channel"
              @click="navigateToVoiceChannel"
            >
              {{ currentVoiceChannel?.name || "Voice channel" }}
            </button>
            <span
              class="flex items-center gap-1.5 text-xs text-base-content/60"
            >
              <button
                class="connection-summary-link inline-flex items-center gap-1"
                type="button"
                :title="`${signalTooltip} • Open connection statistics`"
                aria-label="Open connection statistics"
                @click="rtcSummaryVisible = true"
              >
                <span class="flex items-end gap-px" aria-hidden="true">
                  <span
                    v-for="level in 4"
                    :key="level"
                    class="w-0.5 rounded-sm"
                    :class="[barClass(level), signalColorClass]"
                    :style="{ height: `${3 + level * 1.5}px` }"
                  ></span>
                </span>
                <span>{{ signalLabel }}</span>
              </button>
              <span v-if="elapsedText" aria-hidden="true">·</span>
              <span v-if="elapsedText" class="tabular-nums">{{
                elapsedText
              }}</span>
            </span>
          </span>
        </div>

        <div
          v-if="voiceStore.connected"
          class="call-divider hidden lg:block"
        ></div>

        <div
          v-if="voiceStore.connected"
          class="hidden items-center gap-1 lg:flex"
        >
          <MediaSettingsContextMenu kind="camera">
            <button
              class="call-icon"
              type="button"
              :class="voiceStore.cameraEnabled && 'call-icon-active'"
              :aria-pressed="voiceStore.cameraEnabled"
              :aria-label="
                voiceStore.cameraEnabled ? 'Turn camera off' : 'Turn camera on'
              "
              :title="
                voiceStore.cameraEnabled ? 'Turn camera off' : 'Turn camera on'
              "
              @click="voiceStore.toggleCamera"
            >
              <Icon
                :name="
                  voiceStore.cameraEnabled ? 'lucide:video' : 'lucide:video-off'
                "
                class="size-4"
              />
            </button>
          </MediaSettingsContextMenu>
          <button
            class="call-icon"
            type="button"
            :class="voiceStore.screenSharing && 'call-icon-active'"
            :aria-pressed="voiceStore.screenSharing"
            :aria-label="
              voiceStore.screenSharing ? 'Stop sharing screen' : 'Share screen'
            "
            :title="
              voiceStore.screenSharing ? 'Stop sharing screen' : 'Share screen'
            "
            @click="voiceStore.toggleScreenShare"
          >
            <Icon name="lucide:monitor-up" class="size-4" />
          </button>
        </div>

        <div
          v-if="voiceStore.connected"
          class="call-divider hidden sm:block"
        ></div>

        <div class="flex items-center gap-1">
          <MediaSettingsContextMenu kind="microphone">
            <button
              class="call-icon"
              type="button"
              :class="voiceStore.micMuted && 'call-icon-danger'"
              :disabled="micUnavailable"
              :aria-pressed="voiceStore.micMuted"
              :aria-label="
                voiceStore.micMuted ? 'Unmute microphone' : 'Mute microphone'
              "
              :title="
                voiceStore.micMuted ? 'Unmute microphone' : 'Mute microphone'
              "
              @click="voiceStore.toggleMic"
            >
              <Icon
                :name="voiceStore.micMuted ? 'lucide:mic-off' : 'lucide:mic'"
                class="size-4"
              />
            </button>
          </MediaSettingsContextMenu>
          <button
            class="call-icon"
            type="button"
            :class="voiceStore.deafened && 'call-icon-danger'"
            :disabled="voiceStore.connecting"
            :aria-pressed="voiceStore.deafened"
            :aria-label="voiceStore.deafened ? 'Undeafen' : 'Deafen'"
            :title="voiceStore.deafened ? 'Undeafen' : 'Deafen'"
            @click="voiceStore.toggleDeafen"
          >
            <Icon
              :name="
                voiceStore.deafened ? 'lucide:volume-x' : 'lucide:headphones'
              "
              class="size-4"
            />
          </button>
          <button
            v-if="voiceStore.connected"
            class="call-icon call-icon-danger"
            type="button"
            aria-label="Leave voice channel"
            title="Leave voice channel"
            @click="voiceStore.leaveVoiceChannel"
          >
            <Icon name="lucide:phone-off" class="size-4" />
          </button>
        </div>

        <details
          v-if="voiceStore.connected"
          ref="callMenu"
          class="dropdown dropdown-end"
          @toggle="syncCallMenuState"
        >
          <summary
            class="call-icon"
            aria-label="More call controls"
            title="More call controls"
            :aria-expanded="callMenuOpen"
          >
            <Icon name="lucide:ellipsis" class="size-5" />
          </summary>
          <div class="dropdown-content call-menu z-10 mt-3 w-72">
            <p class="menu-heading">Media</p>
            <button
              class="menu-row lg:hidden"
              type="button"
              @click="voiceStore.toggleCamera"
            >
              <Icon
                :name="
                  voiceStore.cameraEnabled ? 'lucide:video-off' : 'lucide:video'
                "
              />
              <span>{{
                voiceStore.cameraEnabled ? "Turn camera off" : "Turn camera on"
              }}</span>
            </button>
            <button
              class="menu-row lg:hidden"
              type="button"
              @click="voiceStore.toggleScreenShare"
            >
              <Icon name="lucide:monitor-up" />
              <span>{{
                voiceStore.screenSharing
                  ? "Stop screen sharing"
                  : "Share screen"
              }}</span>
            </button>
            <button
              class="menu-row sm:hidden"
              type="button"
              @click="voiceStore.toggleDeafen"
            >
              <Icon
                :name="
                  voiceStore.deafened ? 'lucide:volume-2' : 'lucide:volume-x'
                "
              />
              <span>{{ voiceStore.deafened ? "Undeafen" : "Deafen" }}</span>
            </button>
            <button
              class="menu-row"
              type="button"
              @click="voiceStore.toggleSystemAudioShare"
            >
              <Icon name="lucide:audio-lines" />
              <span>{{
                voiceStore.systemAudioSharing
                  ? "Stop system audio"
                  : "Share system audio only"
              }}</span>
            </button>
            <button
              class="menu-row"
              type="button"
              :class="broadcastMode && 'text-warning'"
              @click="toggleBroadcastMode"
            >
              <Icon name="lucide:radio" />
              <span>Broadcast mode</span>
              <span class="ml-auto text-xs font-semibold">{{
                broadcastMode ? "On" : "Off"
              }}</span>
            </button>

            <div
              v-if="voiceStore.screenSharing || voiceStore.systemAudioSharing"
              class="audio-share-panel"
            >
              <label
                for="shared-audio-volume"
                class="flex items-center justify-between text-xs font-medium"
              >
                <span>Shared audio volume</span>
                <span>{{ voiceStore.sharedAudioVolume }}%</span>
              </label>
              <input
                id="shared-audio-volume"
                class="range range-primary range-xs mt-2 w-full"
                type="range"
                min="0"
                max="100"
                step="1"
                :value="voiceStore.sharedAudioVolume"
                @input="voiceStore.setSharedAudioVolume($event.target.value)"
              />
              <div
                class="mt-2 flex items-center gap-2 text-xs text-base-content/60"
              >
                <progress
                  class="progress h-1.5 flex-1"
                  :class="
                    voiceStore.sharedAudioStats.dbfs >= -12
                      ? 'progress-error'
                      : 'progress-success'
                  "
                  max="1"
                  :value="voiceStore.sharedAudioStats.level"
                ></progress>
                <span
                  >{{ voiceStore.sharedAudioStats.kbps.toFixed(1) }} kbps</span
                >
              </div>
            </div>

            <div class="menu-separator"></div>
            <p class="menu-heading">Connection</p>
            <button
              class="menu-row"
              type="button"
              @click="rtcSummaryVisible = !rtcSummaryVisible"
            >
              <span class="flex items-end gap-0.5" aria-hidden="true">
                <span
                  v-for="level in 5"
                  :key="level"
                  class="w-1 rounded-sm"
                  :class="[barClass(level), signalColorClass]"
                  :style="{ height: `${5 + level * 2}px` }"
                ></span>
              </span>
              <span>{{ signalLabel }}</span>
              <span
                v-if="lastRttMs != null"
                class="ml-auto text-xs text-base-content/60"
                >{{ activeRouteLabel }} · {{ Math.round(lastRttMs) }} ms</span
              >
            </button>
            <button
              class="menu-row"
              type="button"
              @click="router.push('/rtc-debug')"
            >
              <Icon
                :name="
                  screenShareFpsLow
                    ? 'lucide:triangle-alert'
                    : 'lucide:activity'
                "
                :class="screenShareFpsLow && 'text-warning'"
              />
              <span>Connection details</span>
            </button>
            <div
              v-if="outboundVideoLabels.length"
              class="px-3 pb-2 text-xs text-base-content/60"
            >
              <span
                v-for="(quality, index) in outboundVideoLabels"
                :key="quality.source"
              >
                {{ index ? " · " : ""
                }}{{ quality.source === "screen" ? "Share" : "Camera" }}
                {{ quality.text }}
              </span>
            </div>
          </div>
        </details>
      </section>

      <div v-if="profile && voiceStore.connecting" class="connection-warning">
        <span class="loading loading-spinner loading-xs"></span>
        <span>Connecting…</span>
      </div>

      <NuxtLink
        v-if="profile"
        to="/settings"
        class="profile-button"
        aria-label="Open account settings"
      >
        <span class="hidden max-w-32 text-right md:block">
          <span class="block truncate text-sm font-semibold">{{
            profile?.name
          }}</span>
          <span class="block truncate text-xs text-base-content/60"
            >Account</span
          >
        </span>
        <span class="avatar relative select-none" :class="avatarStatusClass">
          <span
            class="size-10 overflow-hidden rounded-full ring-1 ring-base-content/15"
          >
            <img :src="profileAvatar" alt="" />
          </span>
          <span
            v-if="voiceStore.connected"
            class="absolute -right-0.5 -bottom-0.5 flex size-4 items-center justify-center rounded-full bg-success ring-2 ring-base-100"
          >
            <Icon name="lucide:mic" class="size-2.5 text-success-content" />
          </span>
        </span>
      </NuxtLink>
    </div>
  </header>
</template>

<style scoped>
.call-dock {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.375rem;
  border: 1px solid
    color-mix(in oklab, var(--color-base-content) 14%, transparent);
  background: var(--color-base-100);
  padding: 0.3rem;
}

.call-dock-connected {
  border-color: color-mix(in oklab, var(--color-success) 40%, transparent);
  background: color-mix(
    in oklab,
    var(--color-success) 9%,
    var(--color-base-100)
  );
}

.room-banner-shade {
  background: linear-gradient(
    90deg,
    var(--navbar-surface),
    color-mix(in oklab, var(--navbar-surface) 35%, transparent) 18%,
    transparent 38%,
    transparent 62%,
    color-mix(in oklab, var(--navbar-surface) 45%, transparent) 82%,
    var(--navbar-surface)
  );
}

.room-banner {
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
}

@media (prefers-reduced-motion: no-preference) {
  .room-navbar {
    transition: height 240ms cubic-bezier(0.1, 0.9, 0.2, 1);
  }

  .room-banner-enter-active,
  .room-banner-leave-active {
    transition: opacity 240ms cubic-bezier(0.1, 0.9, 0.2, 1);
  }

  .room-banner-enter-from,
  .room-banner-leave-to {
    opacity: 0;
  }
}

.call-channel {
  display: flex;
  min-width: 0;
  max-width: 15rem;
  align-items: center;
  gap: 0.625rem;
  padding: 0.25rem 0.55rem;
  transition: background-color 150ms ease;
}

.profile-button:hover,
.profile-button:focus-visible {
  background: color-mix(in oklab, var(--color-base-content) 8%, transparent);
  outline: none;
}

.channel-link:hover,
.channel-link:focus-visible,
.connection-summary-link:hover,
.connection-summary-link:focus-visible {
  text-decoration: underline;
  text-underline-offset: 0.18em;
  outline: none;
}

.status-dot {
  width: 0.55rem;
  height: 0.55rem;
  flex: none;
  border-radius: 999px;
  background: var(--color-success);
  box-shadow: 0 0 0 4px
    color-mix(in oklab, var(--color-success) 15%, transparent);
}

.call-divider {
  width: 1px;
  height: 1.75rem;
  background: color-mix(in oklab, var(--color-base-content) 14%, transparent);
}

.call-icon {
  display: inline-flex;
  width: 2.25rem;
  height: 2.25rem;
  flex: none;
  cursor: pointer;
  list-style: none;
  align-items: center;
  justify-content: center;
  color: color-mix(in oklab, var(--color-base-content) 78%, transparent);
  transition:
    background-color 150ms ease,
    color 150ms ease,
    transform 150ms ease;
}

.call-icon::-webkit-details-marker {
  display: none;
}
.call-icon:hover,
.call-icon:focus-visible {
  background: color-mix(in oklab, var(--color-base-content) 10%, transparent);
  color: var(--color-base-content);
  outline: none;
}
.call-icon:active {
  transform: scale(0.94);
}
.call-icon:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}
.call-icon-active {
  background: var(--color-primary);
  color: var(--color-primary-content);
}
.call-icon-danger {
  background: color-mix(in oklab, var(--color-error) 18%, transparent);
  color: var(--color-error);
}
.call-icon-danger:hover,
.call-icon-danger:focus-visible {
  background: var(--color-error);
  color: var(--color-error-content);
}

.call-menu {
  overflow: hidden;
  border: 1px solid
    color-mix(in oklab, var(--color-base-content) 14%, transparent);
  background: var(--color-base-100);
  padding: 0.45rem;
  color: var(--color-base-content);
  box-shadow: 0 16px 40px color-mix(in oklab, black 25%, transparent);
}

.menu-heading {
  padding: 0.35rem 0.75rem;
  color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.menu-row {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 0.75rem;
  border-radius: 0.6rem;
  padding: 0.6rem 0.75rem;
  text-align: left;
  font-size: 0.875rem;
}
.menu-row :deep(svg) {
  width: 1rem;
  height: 1rem;
  flex: none;
}
.menu-row:hover,
.menu-row:focus-visible {
  background: color-mix(in oklab, var(--color-base-content) 8%, transparent);
  outline: none;
}
.menu-separator {
  height: 1px;
  margin: 0.4rem;
  background: color-mix(in oklab, var(--color-base-content) 12%, transparent);
}
.audio-share-panel {
  margin: 0.35rem;
  border-radius: 0.65rem;
  background: color-mix(in oklab, var(--color-base-content) 6%, transparent);
  padding: 0.75rem;
}
.profile-button {
  display: flex;
  flex: none;
  align-items: center;
  gap: 0.7rem;
  border-radius: 0.75rem;
  padding: 0.25rem;
  transition: background-color 150ms ease;
}
.connection-warning {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  border: 1px solid var(--color-warning);
  border-radius: 0.7rem;
  background: var(--color-warning);
  padding: 0.55rem 0.75rem;
  color: var(--color-warning-content);
  font-size: 0.8rem;
  font-weight: 600;
}

@media (max-width: 639px) {
  .call-channel {
    max-width: 8.5rem;
  }
  .call-dock {
    gap: 0.2rem;
  }
}
</style>
