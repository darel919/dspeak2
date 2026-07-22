<template>
  <div
    class="min-h-screen-minus-navbar bg-base-200/35 px-4 py-6 text-base-content sm:px-6 lg:py-8"
  >
    <div
      class="mx-auto flex max-w-6xl flex-col overflow-hidden border border-base-300 bg-base-100 shadow-sm lg:min-h-[680px] lg:flex-row"
    >
      <aside
        class="border-b border-base-300 bg-base-200/55 px-4 py-4 lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r lg:px-4 lg:py-5"
      >
        <div class="flex items-center justify-between lg:block">
          <div>
            <div class="flex items-center gap-2 text-base font-bold">
              <Icon
                name="lucide:settings"
                class="size-4 text-primary"
              />Settings
            </div>
          </div>
          <button
            type="button"
            class="btn btn-ghost btn-sm lg:hidden"
            @click="goBack"
          >
            <Icon name="lucide:x" class="size-5" />
          </button>
        </div>
        <nav
          class="mt-4 grid grid-cols-2 gap-1 sm:grid-cols-4 lg:block lg:space-y-1"
          aria-label="Settings categories"
        >
          <button
            v-for="item in settingsNavigation"
            :key="item.id"
            type="button"
            class="flex min-w-0 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition lg:w-full lg:justify-start"
            :class="
              activeSection === item.id
                ? 'bg-primary/12 text-primary'
                : 'text-base-content/65 hover:bg-base-300/70 hover:text-base-content'
            "
            @click="activeSection = item.id"
          >
            <Icon :name="item.icon" class="size-4 shrink-0" /><span
              class="truncate"
              >{{ item.label }}</span
            >
          </button>
        </nav>
        <button
          type="button"
          class="btn btn-ghost btn-sm mt-5 hidden w-full justify-start gap-2 lg:flex"
          @click="goBack"
        >
          <Icon name="lucide:arrow-left" class="size-4" />Back
        </button>
      </aside>

      <main class="min-w-0 flex-1 px-4 py-6 sm:px-7 lg:px-8 lg:py-7">
        <div class="mx-auto max-w-3xl">
          <header class="mb-6 border-b border-base-300 pb-5">
            <h1 class="text-2xl font-bold tracking-tight">
              {{ activeSectionMeta.title }}
            </h1>
            <p class="mt-1 text-sm text-base-content/60">
              {{ activeSectionMeta.description }}
            </p>
          </header>

          <section v-if="activeSection === 'account'" class="space-y-5">
            <div class="settings-panel">
              <div v-if="profile" class="flex items-center gap-4 p-5">
                <div class="avatar shrink-0">
                  <div class="w-14 rounded-full bg-base-200">
                    <img :src="profile.avatar" alt="User avatar" />
                  </div>
                </div>
                <div class="min-w-0 flex-1">
                  <h2 class="truncate font-semibold">{{ profile.name }}</h2>
                  <p class="truncate text-sm text-base-content/60">
                    {{ profile.email }}
                  </p>
                </div>
                <span
                  class="hidden items-center gap-1.5 text-xs text-success sm:flex"
                  ><span class="size-2 rounded-full bg-success"></span>Signed
                  in</span
                >
              </div>
              <p v-else class="p-5 text-error">
                Profile information is unavailable.
              </p>
            </div>
            <div
              class="settings-panel flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <h2 class="text-sm font-semibold">Log out</h2>
                <p class="mt-1 text-xs text-base-content/60">
                  End the current session on this device.
                </p>
              </div>
              <button
                type="button"
                class="btn btn-error btn-outline btn-sm"
                @click="handleLogout"
              >
                <Icon name="lucide:log-out" class="size-4" />Log out
              </button>
            </div>
          </section>

          <section v-else-if="activeSection === 'voice'" class="space-y-6">
            <div class="settings-panel">
              <div class="settings-panel-heading">
                <div>
                  <h2>Devices</h2>
                  <p>Choose what dSpeak uses for calls.</p>
                </div>
                <button
                  type="button"
                  class="btn btn-sm btn-ghost"
                  :disabled="devicesLoading"
                  @click="refreshDevices"
                >
                  <span
                    v-if="devicesLoading"
                    class="loading loading-spinner loading-xs"
                  ></span
                  ><Icon
                    v-else
                    name="lucide:refresh-cw"
                    class="size-4"
                  />Refresh
                </button>
              </div>
              <div class="divide-y divide-base-300">
                <label class="settings-row"
                  ><span class="settings-row-label"
                    ><Icon name="lucide:mic" />Microphone</span
                  ><select
                    v-model="selectedDeviceId"
                    class="select select-bordered w-full max-w-md"
                    :disabled="devicesLoading || !devices.length"
                    @change="onDeviceChange"
                  >
                    <option value="">System default</option>
                    <option
                      v-for="d in devices"
                      :key="d.deviceId"
                      :value="d.deviceId"
                    >
                      {{ d.label || "Microphone" }}
                    </option>
                  </select></label
                >
                <label class="settings-row"
                  ><span class="settings-row-label"
                    ><Icon name="lucide:volume-2" />Speakers</span
                  ><select
                    v-model="selectedOutputId"
                    class="select select-bordered w-full max-w-md"
                    :disabled="
                      devicesLoading || !outputDevices.length || !canSetSinkId
                    "
                    @change="onOutputChange"
                  >
                    <option value="">System default</option>
                    <option
                      v-for="d in outputDevices"
                      :key="d.deviceId"
                      :value="d.deviceId"
                    >
                      {{ d.label || "Speaker" }}
                    </option>
                  </select></label
                >
                <label class="settings-row"
                  ><span class="settings-row-label"
                    ><Icon name="lucide:video" />Camera</span
                  ><select
                    v-model="selectedCameraId"
                    class="select select-bordered w-full max-w-md"
                    :disabled="devicesLoading || !videoDevices.length"
                    @change="onCameraDeviceChange"
                  >
                    <option value="">System default</option>
                    <option
                      v-for="d in videoDevices"
                      :key="d.deviceId"
                      :value="d.deviceId"
                    >
                      {{ d.label || "Camera" }}
                    </option>
                  </select></label
                >
              </div>
              <div
                v-if="devicesError || !canSetSinkId"
                class="border-t border-base-300 px-5 py-3 text-xs"
                :class="devicesError ? 'text-error' : 'text-base-content/60'"
              >
                {{
                  devicesError ||
                  "This browser does not support selecting a separate output device."
                }}
              </div>
            </div>

            <div class="settings-panel">
              <div class="settings-panel-heading">
                <div>
                  <h2>Voice processing</h2>
                  <p>Clean up your microphone before it is sent.</p>
                </div>
                <button
                  type="button"
                  class="btn btn-sm"
                  :class="micTestActive ? 'btn-error' : 'btn-outline'"
                  @click="toggleMicTest"
                >
                  <Icon
                    :name="micTestActive ? 'lucide:square' : 'lucide:play'"
                    class="size-4"
                  />{{ micTestActive ? "Stop test" : "Test mic" }}
                </button>
              </div>
              <div class="divide-y divide-base-300">
                <label
                  v-for="option in audioProcessingOptions"
                  :key="option.key"
                  class="settings-toggle-row"
                  ><span
                    ><strong>{{ option.label }}</strong
                    ><small>{{ option.description }}</small></span
                  ><span class="flex items-center gap-3"
                    ><span
                      v-if="!supported[option.key]"
                      class="text-xs text-base-content/50"
                      >Unavailable</span
                    ><input
                      type="checkbox"
                      class="toggle toggle-primary"
                      :checked="audio[option.key]"
                      :disabled="!supported[option.key]"
                      @change="
                        onToggle(option.key, $event.target.checked)
                      " /></span
                ></label>
              </div>
              <div
                class="flex flex-wrap items-center gap-3 border-t border-base-300 bg-base-200/50 px-5 py-4"
              >
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  :disabled="applyBusy || !voiceStore.connected"
                  @click="applyAudioSettings"
                >
                  <span
                    v-if="applyBusy"
                    class="loading loading-spinner loading-xs"
                  ></span
                  >Apply to current call</button
                ><span class="text-xs text-base-content/60">{{
                  voiceStore.connected
                    ? "Restarts your microphone with these settings."
                    : "Join a voice channel to apply live."
                }}</span
                ><span v-if="micTestActive" class="badge badge-warning"
                  >Other audio is muted during the test</span
                ><audio ref="micTestAudio" class="hidden" autoplay></audio>
              </div>
            </div>

            <div class="settings-panel">
              <div class="settings-panel-heading">
                <div>
                  <h2>Video quality</h2>
                  <p>Set separate limits for camera and screen sharing.</p>
                </div>
              </div>
              <div class="grid gap-4 p-5 md:grid-cols-2">
                <div
                  v-for="video in videoQualitySections"
                  :key="video.id"
                  class="rounded-xl border border-base-300 bg-base-200/45 p-4"
                >
                  <div class="mb-4 flex items-center gap-3">
                    <span
                      class="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary"
                      ><Icon :name="video.icon" class="size-5"
                    /></span>
                    <h3 class="font-semibold">{{ video.label }}</h3>
                  </div>
                  <label class="form-control"
                    ><span
                      class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-base-content/60"
                      >Resolution</span
                    ><select
                      class="select select-bordered w-full bg-base-100"
                      :value="video.settings.resolution"
                      @change="video.setResolution($event.target.value)"
                    >
                      <option
                        v-for="option in resolutionOptions"
                        :key="option.value"
                        :value="option.value"
                      >
                        {{ option.label }}
                      </option>
                    </select></label
                  >
                  <label class="form-control mt-4"
                    ><span
                      class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-base-content/60"
                      >Frame rate</span
                    ><select
                      class="select select-bordered w-full bg-base-100"
                      :value="video.settings.frameRate"
                      @change="video.setFrameRate($event.target.value)"
                    >
                      <option
                        v-for="fps in frameRateOptions"
                        :key="fps"
                        :value="fps"
                      >
                        {{ fps }} FPS
                      </option>
                    </select></label
                  >
                  <label class="form-control mt-4"
                    ><span
                      class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-base-content/60"
                      >Quality priority</span
                    ><select
                      class="select select-bordered w-full bg-base-100"
                      :value="video.settings.qualityPriority"
                      @change="video.setQualityPriority($event.target.value)"
                    >
                      <option value="framerate">Prioritize maximum FPS</option>
                      <option value="resolution">Prioritize resolution</option>
                    </select></label
                  >
                  <p class="mt-2 text-xs text-base-content/60">
                    {{
                      video.settings.qualityPriority === "resolution"
                        ? "Preserves resolution and may reduce cadence, never below 24 FPS."
                        : "Keeps cadence as close to the selected FPS as possible."
                    }}
                  </p>
                </div>
              </div>
              <p
                class="border-t border-base-300 px-5 py-3 text-xs text-base-content/60"
              >
                Resolution limits never upscale the source. Original preserves
                the source's full resolution.
              </p>
            </div>

            <div class="settings-panel">
              <div class="settings-panel-heading">
                <div>
                  <h2>Shared audio</h2>
                  <p>
                    Choose the preferred Opus quality ceiling for system audio.
                  </p>
                </div>
                <span v-if="voiceStore.connected" class="badge badge-outline"
                  >Effective
                  {{ voiceStore.effectiveSystemAudioBitrate }} kbps</span
                >
              </div>
              <label class="settings-row"
                ><span
                  ><strong class="block text-sm">Maximum bitrate</strong
                  ><small class="mt-1 block text-xs text-base-content/60"
                    >The voice channel's own limit still takes priority.</small
                  ></span
                ><select
                  class="select select-bordered w-full max-w-xs"
                  :value="systemAudioBitrate"
                  @change="setSystemAudioBitrate($event.target.value)"
                >
                  <option
                    v-for="kbps in systemAudioBitrateOptions"
                    :key="kbps"
                    :value="kbps"
                  >
                    {{ kbps }} kbps{{ kbps === 256 ? " · highest" : "" }}
                  </option>
                </select></label
              >
            </div>
          </section>

          <section v-else-if="activeSection === 'appearance'" class="space-y-6">
            <div class="settings-panel">
              <div class="settings-panel-heading">
                <div>
                  <h2>Surface mode</h2>
                  <p>Choose how Metro surfaces adapt to your display.</p>
                </div>
              </div>
              <div class="grid gap-2 p-5 sm:grid-cols-3">
                <button
                  v-for="mode in ['system', 'light', 'dark']"
                  :key="mode"
                  class="btn capitalize"
                  :class="
                    settingsStore.appearance.surfaceMode === mode
                      ? 'btn-primary'
                      : 'btn-outline'
                  "
                  @click="settingsStore.setAppearance({ surfaceMode: mode })"
                >
                  {{ mode }}
                </button>
              </div>
            </div>
            <div class="settings-panel">
              <div class="settings-panel-heading">
                <div>
                  <h2>Personal accent</h2>
                  <p>
                    Rooms temporarily replace this color with their own accent.
                  </p>
                </div>
              </div>
              <div class="grid grid-cols-3 gap-2 p-5 sm:grid-cols-6">
                <button
                  v-for="accent in ROOM_ACCENTS"
                  :key="accent"
                  class="h-20 border-4 text-xs capitalize text-white"
                  :class="
                    settingsStore.appearance.accent === accent
                      ? 'border-base-content'
                      : 'border-transparent'
                  "
                  :style="{ background: accentColor(accent) }"
                  @click="settingsStore.setAppearance({ accent })"
                >
                  {{ accent }}
                </button>
              </div>
            </div>
          </section>

          <section v-else-if="activeSection === 'notifications'">
            <NotificationSettings />
          </section>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup>
import NotificationSettings from "../components/NotificationSettings.vue";
import { useAuthStore } from "../stores/auth";
import { useSettingsStore } from "../stores/settings";
import { useVoiceStore } from "../stores/voice";
import { useRuntimeConfig } from "#app";
import { useChatUtils } from "../composables/useChatUtils";
import {
  AUDIO_CONSTRAINT_KEYS,
  SYSTEM_AUDIO_BITRATE_OPTIONS,
  VIDEO_FRAME_RATE_OPTIONS,
  VIDEO_RESOLUTION_OPTIONS,
} from "../const/media";
import { ROOM_ACCENTS } from "~~/shared/room-policy.js";

const authStore = useAuthStore();
const voiceStore = useVoiceStore();
const settingsStore = useSettingsStore();

const activeSection = ref("account");
const router = useRouter();
const settingsNavigation = [
  { id: "account", label: "Account", icon: "lucide:user-round" },
  { id: "voice", label: "Voice & Video", icon: "lucide:audio-lines" },
  { id: "appearance", label: "Appearance", icon: "lucide:palette" },
  { id: "notifications", label: "Notifications", icon: "lucide:bell" },
];
const sectionDetails = {
  account: {
    title: "My account",
    description: "Your identity and current dSpeak session.",
  },
  voice: {
    title: "Voice & video",
    description:
      "Configure capture devices, call processing, and media quality.",
  },
  appearance: {
    title: "Appearance",
    description: "Choose your Metro surface and personal accent.",
  },
  notifications: {
    title: "Notifications",
    description: "Choose how this browser alerts you about new activity.",
  },
};
const activeSectionMeta = computed(() => sectionDetails[activeSection.value]);
const audioProcessingOptions = [
  {
    key: "echoCancellation",
    label: "Echo cancellation",
    description: "Reduce feedback from your speakers.",
  },
  {
    key: "noiseSuppression",
    label: "Noise suppression",
    description: "Reduce steady background noise.",
  },
  {
    key: "autoGainControl",
    label: "Automatic gain",
    description: "Keep microphone loudness at a consistent level.",
  },
];

function goBack() {
  if (window.history.length > 1) router.back();
  else router.push("/");
}

const audio = computed(() => settingsStore.audio);
const supported = computed(() => settingsStore.supported);
const cameraVideo = computed(() => settingsStore.cameraVideo);
const screenVideo = computed(() => settingsStore.screenVideo);
const systemAudioBitrate = computed(() => settingsStore.systemAudioBitrate);
const systemAudioBitrateOptions = SYSTEM_AUDIO_BITRATE_OPTIONS;
const resolutionOptions = VIDEO_RESOLUTION_OPTIONS;
const frameRateOptions = VIDEO_FRAME_RATE_OPTIONS;

function accentColor(value) {
  return {
    cobalt: "#0050ef",
    cyan: "#00aba9",
    violet: "#6a00ff",
    magenta: "#d80073",
    orange: "#e3a21a",
    lime: "#60a917",
  }[value];
}

function setCameraResolution(resolution) {
  settingsStore.setCameraVideoSettings({ resolution });
}
function setCameraFrameRate(frameRate) {
  settingsStore.setCameraVideoSettings({ frameRate: Number(frameRate) });
}
function setCameraQualityPriority(qualityPriority) {
  settingsStore.setCameraVideoSettings({ qualityPriority });
}
function setScreenResolution(resolution) {
  settingsStore.setScreenVideoSettings({ resolution });
}
function setScreenFrameRate(frameRate) {
  settingsStore.setScreenVideoSettings({ frameRate: Number(frameRate) });
}
function setScreenQualityPriority(qualityPriority) {
  settingsStore.setScreenVideoSettings({ qualityPriority });
}
function setSystemAudioBitrate(bitrate) {
  voiceStore.setSystemAudioBitrate(Number(bitrate));
}
const videoQualitySections = computed(() => [
  {
    id: "camera",
    label: "Camera",
    icon: "lucide:video",
    settings: cameraVideo.value,
    setResolution: setCameraResolution,
    setFrameRate: setCameraFrameRate,
    setQualityPriority: setCameraQualityPriority,
  },
  {
    id: "screen",
    label: "Screen share",
    icon: "lucide:monitor-up",
    settings: screenVideo.value,
    setResolution: setScreenResolution,
    setFrameRate: setScreenFrameRate,
    setQualityPriority: setScreenQualityPriority,
  },
]);

const config = useRuntimeConfig();
const { getAvatarUrl } = useChatUtils();

const profile = computed(() => {
  const user = authStore.getUserData();
  if (!user) return null;
  return {
    ...user,
    avatar: getAvatarUrl(user.avatar, config.public.baseApiPath),
  };
});

async function handleLogout() {
  authStore.clearAuth();
  await nextTick();
  navigateTo("/");
}

function onToggle(key, checked) {
  settingsStore.setAudioSetting(key, checked);
}

const applyBusy = ref(false);
const micTestActive = ref(false);
let micTestStream = null;
const micTestAudio = ref(null);
async function applyAudioSettings() {
  console.debug("[Settings] Apply audio settings button pressed");
  console.debug(
    "[Settings] voiceStore.connected:",
    voiceStore.connected,
    "voiceStore.sfuComposable:",
    voiceStore.sfuComposable,
  );
  if (!voiceStore.connected || !voiceStore.sfuComposable) {
    console.warn(
      "[Settings] Not applying audio settings: connected =",
      voiceStore.connected,
      "sfuComposable =",
      voiceStore.sfuComposable,
    );
    return;
  }
  applyBusy.value = true;
  try {
    voiceStore.sfuComposable.stopAudioProduction();
    await voiceStore.sfuComposable.startAudioProduction();
  } catch (e) {
  } finally {
    applyBusy.value = false;
  }
}

async function toggleMicTest() {
  if (micTestActive.value) {
    stopMicTest();
    return;
  }

  if (voiceStore.sfuComposable && voiceStore.connected) {
    voiceStore.sfuComposable.applyOutputDeviceToAll("none");

    voiceStore.sfuComposable.stopAudioProduction();
  }

  let constraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  try {
    const { useSettingsStore } = await import("../stores/settings");
    const settings = useSettingsStore();
    constraints = { ...constraints, ...settings.audio };
    if (settings.micDeviceId)
      constraints.deviceId = { exact: settings.micDeviceId };
  } catch (_) {}

  const sanitizedConstraints = {};
  for (const key of AUDIO_CONSTRAINT_KEYS) {
    if (typeof constraints[key] !== "undefined") {
      sanitizedConstraints[key] = constraints[key];
    }
  }
  try {
    micTestStream = await navigator.mediaDevices.getUserMedia({
      audio: sanitizedConstraints,
    });
    const audioEl = micTestAudio.value;
    if (audioEl) {
      audioEl.srcObject = micTestStream;
      audioEl.classList.remove("hidden");
      audioEl.muted = false;
      audioEl.volume = 1.0;
      audioEl.play();
    }
    micTestActive.value = true;
  } catch (e) {
    alert("Failed to start mic test: " + (e && e.message ? e.message : e));
    micTestActive.value = false;
  }
}

function stopMicTest() {
  if (voiceStore.sfuComposable && voiceStore.connected) {
    voiceStore.sfuComposable.applyOutputDeviceToAll();

    voiceStore.sfuComposable.startAudioProduction();
  }
  if (micTestStream) {
    micTestStream.getTracks().forEach((track) => track.stop());
    micTestStream = null;
  }
  const audioEl = micTestAudio.value;
  if (audioEl) {
    audioEl.srcObject = null;
    audioEl.classList.add("hidden");
  }
  micTestActive.value = false;
}

const devices = ref([]);
const outputDevices = ref([]);
const videoDevices = ref([]);
const devicesLoading = ref(false);
const devicesError = ref("");
const selectedDeviceId = ref("");

onMounted(() => {
  selectedDeviceId.value = settingsStore.micDeviceId || "";
  selectedOutputId.value = settingsStore.outputDeviceId || "";
  selectedCameraId.value = settingsStore.cameraDeviceId || "";
  refreshDevices();
});

async function refreshDevices() {
  devicesLoading.value = true;
  devicesError.value = "";
  try {
    if (!navigator.mediaDevices?.enumerateDevices) {
      devicesError.value = "Media devices not supported in this browser.";
      devices.value = [];
      return;
    }

    const labelsKnown = (await navigator.mediaDevices.enumerateDevices()).some(
      (d) => d.label,
    );
    if (!labelsKnown) {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (_) {
        /* ignore */
      }
    }
    const list = await navigator.mediaDevices.enumerateDevices();
    devices.value = list.filter((d) => d.kind === "audioinput");
    outputDevices.value = list.filter((d) => d.kind === "audiooutput");
    videoDevices.value = list.filter((d) => d.kind === "videoinput");
  } catch (e) {
    devicesError.value = "Failed to enumerate devices.";
  } finally {
    devicesLoading.value = false;
  }
}

function onDeviceChange() {
  const id = selectedDeviceId.value || null;
  settingsStore.setMicDeviceId(id);
}

const canSetSinkId =
  typeof document !== "undefined" &&
  typeof document.createElement("audio").setSinkId === "function";
const selectedOutputId = ref("");
const selectedCameraId = ref("");
function onCameraDeviceChange() {
  settingsStore.setCameraDeviceId(selectedCameraId.value || null);
}
function onOutputChange() {
  const id = selectedOutputId.value || null;
  settingsStore.setOutputDeviceId(id);

  if (voiceStore.sfuComposable && voiceStore.connected) {
    voiceStore.sfuComposable.applyOutputDeviceToAll();
  }
}
</script>
