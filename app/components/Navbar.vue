<template>
  <header class="metro-navbar" style="height: var(--navbar-height)">
    <Transition name="room-banner">
      <div
        v-if="roomBannerUrl"
        class="room-banner pointer-events-none absolute inset-y-0 left-0 right-0 md:left-[72px]"
        :style="roomBannerStyle"
        aria-hidden="true"
      >
        <div class="room-banner-shade absolute inset-0" />
      </div>
    </Transition>

    <div class="metro-navbar-content">
      <div class="metro-navbar-start">
        <NuxtLink to="/" class="metro-navbar-brand" aria-label="dSpeak home">
          <img
            class="pointer-events-none size-11 select-none"
            src="/assets/logo/logo_96.png"
            alt=""
          />
        </NuxtLink>
      </div>

      <div class="metro-navbar-end">
        <div
          v-if="connectionWarning"
          class="metro-status metro-status--warning"
          role="status"
        >
          <Icon name="lucide:wifi-off" class="size-4" />
          <span class="hidden sm:inline">{{ connectionWarning }}</span>
        </div>

        <FriendsList />
        <NotificationCenter />

        <section
          v-if="profile"
          class="metro-call-dock"
          :class="{ 'metro-call-dock--connected': voiceStore.connected }"
          aria-label="Voice call controls"
        >
          <div v-if="voiceStore.connected" class="metro-call-channel">
            <span class="metro-status-dot" aria-hidden="true" />
            <div class="metro-call-channel-info">
              <button
                class="metro-call-channel-link"
                type="button"
                title="Return to the active voice channel"
                @click="navigateToVoiceChannel"
              >
                {{ currentVoiceChannel?.name || "Voice channel" }}
              </button>
              <div class="metro-call-connection">
                <button
                  class="metro-call-connection-link"
                  type="button"
                  :title="`${signalTooltip} • Open connection statistics`"
                  aria-label="Open connection statistics"
                  @click="rtcSummaryVisible = true"
                >
                  <span
                    class="metro-signal-bars"
                    :class="{
                      'metro-signal-bars--pending': signalIsConnecting,
                    }"
                    aria-hidden="true"
                  >
                    <span
                      v-for="level in 4"
                      :key="level"
                      class="metro-signal-bar"
                      :class="[barClass(level), signalColorClass]"
                      :style="{ height: `${3 + level * 1.5}px` }"
                    />
                  </span>
                  <span>{{ signalLabel }}</span>
                </button>
                <span v-if="elapsedText" aria-hidden="true">·</span>
                <span v-if="elapsedText" class="tabular-nums">{{
                  elapsedText
                }}</span>
              </div>
            </div>
          </div>

          <div
            v-if="voiceStore.connected"
            class="metro-divider hidden lg:block"
          />

          <div
            v-if="voiceStore.connected"
            class="hidden items-center gap-1 lg:flex"
          >
            <MediaSettingsContextMenu kind="camera">
              <button
                class="metro-call-icon"
                type="button"
                :class="{ 'metro-call-icon--active': voiceStore.cameraEnabled }"
                :aria-pressed="voiceStore.cameraEnabled"
                :aria-label="
                  voiceStore.cameraEnabled
                    ? 'Turn camera off'
                    : 'Turn camera on'
                "
                :title="
                  voiceStore.cameraEnabled
                    ? 'Turn camera off'
                    : 'Turn camera on'
                "
                @click="voiceStore.toggleCamera"
              >
                <Icon
                  :name="
                    voiceStore.cameraEnabled
                      ? 'lucide:video'
                      : 'lucide:video-off'
                  "
                  class="size-4"
                />
              </button>
            </MediaSettingsContextMenu>
            <button
              class="metro-call-icon"
              type="button"
              :class="{ 'metro-call-icon--active': voiceStore.screenSharing }"
              :aria-pressed="voiceStore.screenSharing"
              :aria-label="
                voiceStore.screenSharing
                  ? 'Stop sharing screen'
                  : 'Share screen'
              "
              :title="
                voiceStore.screenSharing
                  ? 'Stop sharing screen'
                  : 'Share screen'
              "
              @click="requestScreenShare"
            >
              <Icon name="lucide:monitor-up" class="size-4" />
            </button>
          </div>

          <div
            v-if="voiceStore.connected"
            class="metro-divider hidden sm:block"
          />

          <div class="flex items-center gap-1">
            <MediaSettingsContextMenu kind="microphone">
              <button
                class="metro-call-icon"
                type="button"
                :class="{ 'metro-call-icon--danger': voiceStore.micMuted }"
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
              class="metro-call-icon"
              type="button"
              :class="{ 'metro-call-icon--danger': voiceStore.deafened }"
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
              class="metro-call-icon metro-call-icon--danger"
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
            class="metro-call-menu"
            @toggle="syncCallMenuState"
          >
            <summary
              class="metro-call-icon"
              aria-label="More call controls"
              title="More call controls"
              :aria-expanded="callMenuOpen"
            >
              <Icon name="lucide:ellipsis" class="size-5" />
            </summary>
            <div class="metro-call-menu-content">
              <p class="metro-menu-heading">Media</p>
              <button
                class="metro-menu-row lg:hidden"
                type="button"
                @click="voiceStore.toggleCamera"
              >
                <Icon
                  :name="
                    voiceStore.cameraEnabled
                      ? 'lucide:video-off'
                      : 'lucide:video'
                  "
                />
                <span>{{
                  voiceStore.cameraEnabled
                    ? "Turn camera off"
                    : "Turn camera on"
                }}</span>
              </button>
              <button
                class="metro-menu-row lg:hidden"
                type="button"
                @click="requestScreenShare"
              >
                <Icon name="lucide:monitor-up" />
                <span>{{
                  voiceStore.screenSharing
                    ? "Stop screen sharing"
                    : "Share screen"
                }}</span>
              </button>
              <button
                class="metro-menu-row sm:hidden"
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
                class="metro-menu-row"
                type="button"
                @click="requestSystemAudioShare"
              >
                <Icon name="lucide:volume-2" />
                <span>{{
                  voiceStore.systemAudioSharing
                    ? "Stop system audio"
                    : "Share system audio only"
                }}</span>
              </button>
              <button
                class="metro-menu-row"
                type="button"
                :class="{ 'text-warning': voiceStore.broadcastAudioSharing }"
                @click="showBroadcastDialog"
              >
                <Icon name="lucide:radio" />
                <span>Broadcast</span>
                <span class="ml-auto text-xs font-semibold">{{
                  voiceStore.broadcastAudioSharing ? "Live" : "Off"
                }}</span>
              </button>

              <div
                v-if="voiceStore.screenSharing || voiceStore.systemAudioSharing"
                class="metro-audio-share-panel"
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
                  class="metro-range mt-2 w-full"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  :value="voiceStore.sharedAudioVolume"
                  :style="{
                    '--metro-range-progress': `${voiceStore.sharedAudioVolume}%`,
                  }"
                  @input="voiceStore.setSharedAudioVolume($event.target.value)"
                />
                <div
                  class="mt-2 flex items-center gap-2 text-xs"
                  aria-live="polite"
                >
                  <span class="font-medium">
                    {{
                      voiceStore.sharedAudioAttenuation.active
                        ? "Speech priority active"
                        : "Effective"
                    }}
                  </span>
                  <progress
                    class="metro-progress h-1.5 flex-1"
                    max="100"
                    :value="
                      Math.round(
                        (voiceStore.sharedAudioVolume *
                          voiceStore.sharedAudioAttenuation.effectivePercent) /
                          100,
                      )
                    "
                  ></progress>
                  <span class="tabular-nums">
                    {{
                      Math.round(
                        (voiceStore.sharedAudioVolume *
                          voiceStore.sharedAudioAttenuation.effectivePercent) /
                          100,
                      )
                    }}%
                  </span>
                </div>
                <p class="mt-1 text-xs text-base-content/60">
                  {{ voiceStore.sharedAudioAttenuation.reportingListeners }}/{{
                    voiceStore.sharedAudioAttenuation.expectedListeners
                  }}
                  listeners confirmed
                </p>
                <div
                  class="mt-2 flex items-center gap-2 text-xs text-base-content/60"
                >
                  <progress
                    class="metro-progress h-1.5 flex-1"
                    :class="
                      voiceStore.sharedAudioStats.dbfs >= -12
                        ? 'metro-progress--error'
                        : 'metro-progress--success'
                    "
                    max="1"
                    :value="voiceStore.sharedAudioStats.level"
                  ></progress>
                  <span
                    >{{
                      voiceStore.sharedAudioStats.kbps.toFixed(1)
                    }}
                    kbps</span
                  >
                </div>
              </div>

              <div class="metro-menu-separator" />
              <p class="metro-menu-heading">Connection</p>
              <button
                class="metro-menu-row"
                type="button"
                @click="rtcSummaryVisible = !rtcSummaryVisible"
              >
                <span
                  class="metro-signal-bars"
                  :class="{ 'metro-signal-bars--pending': signalIsConnecting }"
                  aria-hidden="true"
                >
                  <span
                    v-for="level in 5"
                    :key="level"
                    class="metro-signal-bar"
                    :class="[barClass(level), signalColorClass]"
                    :style="{ height: `${5 + level * 2}px` }"
                  />
                </span>
                <span>{{ signalLabel }}</span>
                <span
                  v-if="lastRttMs != null"
                  class="ml-auto text-xs text-base-content/60"
                  >{{ activeRouteLabel }} · {{ Math.round(lastRttMs) }} ms</span
                >
              </button>
              <button
                class="metro-menu-row"
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

        <div
          v-if="profile && voiceStore.connecting"
          class="metro-connection-warning"
          role="status"
          :title="voiceConnectionStatus.detail"
        >
          <span class="metro-spinner metro-spinner--xs" />
          <span>{{ voiceConnectionStatus.label }}</span>
        </div>

        <PresenceStatusSelector
          v-if="profile"
          :profile="profile"
          :profile-avatar="profileAvatar"
          :avatar-status-class="avatarStatusClass"
          :voice-connected="voiceStore.connected"
        />
      </div>
    </div>
  </header>
  <DesktopCapturePicker
    v-if="capturePickerOpen"
    :open="capturePickerOpen"
    :audio-only="capturePickerAudioOnly"
    :busy="capturePickerStarting"
    :error-message="capturePickerError"
    @close="closeCapturePicker"
    @select="selectDesktopCapture"
    @fallback="useBrowserCaptureFallback"
  />
  <BroadcastSetupDialog
    v-if="broadcastDialogOpen"
    @close="broadcastDialogOpen = false"
  />
</template>

<script setup>
import { defineAsyncComponent } from "vue";
import { useAuthStore } from "../stores/auth";
import { useRoomsStore } from "../stores/rooms";
import { useVoiceStore } from "../stores/voice";
import { useChannelsStore } from "../stores/channels";
import { useChatStore } from "../stores/chat";
import { useSettingsStore } from "../stores/settings";
import { useRtcStatsStore } from "../stores/rtc-stats";
import { useRuntimeStore } from "../stores/runtime";
import { usePresenceStatusStore } from "../stores/presenceStatus";
const BroadcastSetupDialog = defineAsyncComponent(
  () => import("./BroadcastSetupDialog.vue"),
);
const DesktopCapturePicker = defineAsyncComponent(
  () => import("./DesktopCapturePicker.vue"),
);
import { isScreenShareFpsBelowTarget } from "../shared/video-settings";
import {
  getActiveConnectionLabel,
  isConnectionPending,
} from "../shared/connection-quality";
import { getDesktopCaptureApi } from "../shared/desktop-capture";
import { useVoiceConnectionStatus } from "../composables/useVoiceConnectionStatus";

const authStore = useAuthStore();
const roomsStore = useRoomsStore();
const voiceStore = useVoiceStore();
const chatStore = useChatStore();
const channelsStore = useChannelsStore();
const settingsStore = useSettingsStore();
const rtcStatsStore = useRtcStatsStore();
const runtimeStore = useRuntimeStore();
const presenceStore = usePresenceStatusStore();
const route = useRoute();
const router = useRouter();
const config = useRuntimeConfig();
const { status: voiceConnectionStatus } = useVoiceConnectionStatus(voiceStore);

const profile = computed(() => authStore.getUserData());
const profileAvatar = computed(() => profile.value?.avatar || "");
const broadcastDialogOpen = ref(false);
const capturePickerOpen = ref(false);
const capturePickerAudioOnly = ref(false);
const capturePickerStarting = ref(false);
const capturePickerError = ref("");
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
  voiceStore.currentRoomId && voiceStore.currentChannelId
    ? channelsStore.getRoomChannelById(
        voiceStore.currentRoomId,
        voiceStore.currentChannelId,
      )
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
  if (presenceStore.effectiveStatus === "online") return "avatar-online";
  if (presenceStore.effectiveStatus === "idle") return "avatar-idle";
  if (presenceStore.effectiveStatus === "dnd") return "avatar-dnd";
  return "avatar-offline";
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
const signalIsConnecting = computed(() =>
  isConnectionPending(
    voiceStore.sfuComposable?.mediaConnectionState,
    voiceStore.connecting,
  ),
);
const signalLevel = computed(() =>
  !signalIsConnecting.value && rtcStatsStore.metrics.connected
    ? rtcStatsStore.metrics.score
    : 0,
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
  if (signalIsConnecting.value) return "bg-warning";
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

const outboundVideoStats = computed(() =>
  rtcStatsStore.outbound.filter((stat) => stat.kind === "video"),
);
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

function showBroadcastDialog() {
  broadcastDialogOpen.value = true;
}

async function requestScreenShare() {
  try {
    if (voiceStore.screenSharing) {
      await voiceStore.toggleScreenShare();
      return;
    }
    if (runtimeStore.isTauri || (await getDesktopCaptureApi())) {
      capturePickerAudioOnly.value = false;
      capturePickerError.value = "";
      capturePickerOpen.value = true;
      return;
    }
    await voiceStore.toggleScreenShare();
  } catch (error) {
    console.error("[Navbar] Screen share error:", error);
  }
}

async function requestSystemAudioShare() {
  try {
    if (voiceStore.systemAudioSharing) {
      await voiceStore.toggleSystemAudioShare();
      return;
    }
    const api = await getDesktopCaptureApi();
    if (runtimeStore.isTauri || api) {
      capturePickerAudioOnly.value = true;
      capturePickerError.value = "";
      capturePickerOpen.value = true;
      return;
    }
    await voiceStore.toggleSystemAudioShare();
  } catch (error) {
    console.error("[Navbar] System audio share error:", error);
  }
}

async function selectDesktopCapture(selection) {
  capturePickerStarting.value = true;
  capturePickerError.value = "";
  try {
    if (capturePickerAudioOnly.value)
      await voiceStore.toggleSystemAudioShare(selection);
    else await voiceStore.toggleScreenShare(selection);
    capturePickerOpen.value = false;
  } catch (error) {
    capturePickerError.value =
      error?.message || "Native desktop sharing could not be started.";
    console.error("[Navbar] Desktop capture selection error:", error);
  } finally {
    capturePickerStarting.value = false;
  }
}

async function useBrowserCaptureFallback() {
  capturePickerStarting.value = true;
  capturePickerError.value = "";
  try {
    if (capturePickerAudioOnly.value)
      await voiceStore.toggleSystemAudioShare(null, {
        explicitBrowserFallback: true,
      });
    else
      await voiceStore.toggleScreenShare(null, {
        explicitBrowserFallback: true,
      });
    capturePickerOpen.value = false;
  } catch (error) {
    capturePickerError.value =
      error?.message || "Browser capture could not be started.";
    console.error("[Navbar] Browser capture fallback error:", error);
  } finally {
    capturePickerStarting.value = false;
  }
}

function closeCapturePicker() {
  capturePickerOpen.value = false;
  capturePickerError.value = "";
}

function barClass(level) {
  if (signalIsConnecting.value) return "";
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

<style scoped>
.metro-navbar {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 50;
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--metro-space-3);
  padding: 0 var(--metro-space-3);
  padding-inline-end: var(--metro-space-4);
  background: var(--navbar-surface);
  border-bottom: 1px solid var(--metro-border);
}

@media (min-width: 640px) {
  .metro-navbar {
    padding-inline: var(--metro-space-4);
  }
}

.metro-navbar-content {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: var(--metro-space-3);
}

.metro-navbar-start {
  display: flex;
  align-items: center;
  gap: var(--metro-space-3);
  flex-shrink: 0;
}

.metro-navbar-end {
  display: flex;
  align-items: center;
  gap: var(--metro-space-2);
  margin-left: auto;
  min-width: 0;
}

.metro-navbar-brand {
  display: flex;
  align-items: center;
}

.room-banner {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
}

@media (min-width: 768px) {
  .room-banner {
    left: 72px;
  }
}

.room-banner-shade {
  position: absolute;
  inset: 0;
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

@media (prefers-reduced-motion: no-preference) {
  .metro-navbar {
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

.metro-call-dock {
  display: flex;
  box-sizing: border-box;
  height: var(--metro-control-size);
  min-width: 0;
  align-items: center;
  gap: var(--metro-space-1);
  border: 1px solid var(--metro-border);
  background: var(--color-base-100);
  padding: 0;
}

.metro-call-dock--connected {
  border-color: color-mix(in oklab, var(--color-success) 40%, transparent);
  background: color-mix(
    in oklab,
    var(--color-success) 9%,
    var(--color-base-100)
  );
}

.metro-call-channel {
  display: flex;
  box-sizing: border-box;
  height: 100%;
  min-width: 0;
  width: 12rem;
  max-width: 12rem;
  flex: 0 1 12rem;
  align-items: center;
  gap: var(--metro-space-2);
  padding: 0 var(--metro-space-2);
  transition: background-color 150ms ease;
}

.metro-status-dot {
  width: 0.55rem;
  height: 0.55rem;
  flex: none;
  background: var(--color-success);
  box-shadow: 0 0 0 4px
    color-mix(in oklab, var(--color-success) 15%, transparent);
}

.metro-call-channel-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.metro-call-channel-link {
  display: block;
  max-width: 100%;
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.1;
  overflow-wrap: anywhere;
  white-space: normal;
  background: none;
  border: none;
  padding: 0;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.metro-call-channel-link:hover,
.metro-call-channel-link:focus-visible,
.metro-call-connection-link:hover,
.metro-call-connection-link:focus-visible {
  text-decoration: underline;
  text-underline-offset: 0.18em;
  outline: none;
}

.metro-call-connection {
  display: flex;
  align-items: center;
  gap: var(--metro-space-1);
  white-space: nowrap;
  font-size: 0.75rem;
  color: color-mix(in oklab, var(--color-base-content) 60%, transparent);
}

.metro-call-connection-link {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  background: none;
  border: none;
  padding: 0;
  color: inherit;
  cursor: pointer;
}

.metro-signal-bars {
  display: flex;
  align-items: flex-end;
  gap: 1px;
}

.metro-signal-bars--pending .metro-signal-bar {
  animation: metro-signal-alert 800ms steps(1, end) infinite;
}

@keyframes metro-signal-alert {
  0%,
  49% {
    background-color: var(--color-warning);
  }
  50%,
  100% {
    background-color: var(--color-error);
  }
}

@media (prefers-reduced-motion: reduce) {
  .metro-signal-bars--pending .metro-signal-bar {
    animation: none;
    background-color: var(--color-warning);
  }
}

.metro-signal-bar {
  width: 0.125rem;
  border-radius: 0.125rem;
}

.metro-divider {
  width: 1px;
  height: 1.75rem;
  background: var(--metro-border);
}

.metro-call-icon {
  display: inline-flex;
  width: var(--metro-control-size);
  height: var(--metro-control-size);
  flex: none;
  align-items: center;
  justify-content: center;
  color: color-mix(in oklab, var(--color-base-content) 78%, transparent);
  background: transparent;
  border: none;
  cursor: pointer;
  transition:
    background-color 150ms ease,
    color 150ms ease;
}

.metro-call-icon::-webkit-details-marker {
  display: none;
}

.metro-call-icon:hover,
.metro-call-icon:focus-visible {
  background: color-mix(in oklab, var(--color-base-content) 10%, transparent);
  color: var(--color-base-content);
  outline: none;
}

.metro-call-icon:active {
  transform: scale(0.94);
}

.metro-call-icon:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.metro-call-icon--active {
  background: var(--metro-accent);
  color: var(--metro-accent-content);
}

.metro-call-icon--danger {
  background: color-mix(in oklab, var(--color-error) 18%, transparent);
  color: var(--color-error);
}

.metro-call-icon--danger:hover,
.metro-call-icon--danger:focus-visible {
  background: var(--color-error);
  color: var(--color-error-content);
}

.metro-call-menu {
  position: relative;
  flex: none;
}

.metro-call-menu-content {
  position: absolute;
  top: calc(100% + var(--metro-space-3));
  right: 0;
  z-index: 10;
  width: 18rem;
  border: 1px solid var(--metro-border);
  background: var(--color-base-100);
  padding: var(--metro-space-2);
  color: var(--color-base-content);
  box-shadow: var(--metro-overlay-shadow);
}

.metro-menu-heading {
  padding: var(--metro-space-1) var(--metro-space-3);
  color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.metro-menu-row {
  display: flex;
  width: 100%;
  align-items: center;
  gap: var(--metro-space-3);
  padding: var(--metro-space-2) var(--metro-space-3);
  text-align: left;
  font-size: 0.875rem;
  background: transparent;
  border: none;
  cursor: pointer;
}

.metro-menu-row :deep(svg) {
  width: 1rem;
  height: 1rem;
  flex: none;
}

.metro-menu-row:hover,
.metro-menu-row:focus-visible {
  background: color-mix(in oklab, var(--color-base-content) 8%, transparent);
  outline: none;
}

.metro-menu-separator {
  height: 1px;
  margin: var(--metro-space-1) var(--metro-space-2);
  background: var(--metro-border);
}

.metro-audio-share-panel {
  margin: var(--metro-space-1);
  padding: var(--metro-space-3);
  background: color-mix(in oklab, var(--color-base-content) 6%, transparent);
}

.metro-range {
  appearance: none;
  width: 100%;
  height: 4px;
  background: var(--metro-border);
  border-radius: 0;
}

.metro-range::-webkit-slider-thumb {
  appearance: none;
  width: 16px;
  height: 16px;
  background: var(--metro-accent);
  border-radius: 50%;
  cursor: pointer;
}

.metro-range::-moz-range-thumb {
  width: 16px;
  height: 16px;
  background: var(--metro-accent);
  border: none;
  border-radius: 50%;
  cursor: pointer;
}

.metro-progress {
  appearance: none;
  width: 100%;
  height: 4px;
  background: var(--metro-border);
  border-radius: 0;
}

.metro-progress::-webkit-progress-bar {
  background: var(--metro-border);
}

.metro-progress::-webkit-progress-value {
  background: var(--metro-accent);
}

.metro-progress::-moz-progress-bar {
  background: var(--metro-accent);
}

.metro-progress--error::-webkit-progress-value {
  background: var(--color-error);
}

.metro-progress--error::-moz-progress-bar {
  background: var(--color-error);
}

.metro-progress--success::-webkit-progress-value {
  background: var(--color-success);
}

.metro-progress--success::-moz-progress-bar {
  background: var(--color-success);
}

.metro-connection-warning {
  display: flex;
  align-items: center;
  gap: var(--metro-space-2);
  padding: var(--metro-space-2) var(--metro-space-3);
  background: var(--color-warning);
  color: var(--color-warning-content);
  font-size: 0.8rem;
  font-weight: 600;
}

@media (max-width: 639px) {
  .metro-call-channel {
    width: 12rem;
    max-width: 12rem;
  }
  .metro-call-dock {
    gap: var(--metro-space-1);
  }
}

@media (max-width: 1100px) {
  .metro-navbar-end {
    gap: var(--metro-space-1);
  }

  .metro-call-channel {
    width: 12rem;
    max-width: 12rem;
  }

  .metro-call-dock {
    padding: 0;
  }
}

@media (max-width: 899px) {
  .metro-call-channel {
    padding-inline: var(--metro-space-1);
  }

  .metro-call-dock .metro-divider {
    display: none;
  }
}
</style>
