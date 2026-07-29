<template>
  <dialog
    class="modal modal-open px-3 py-4"
    @click.self="emit('close')"
    @keydown.esc="emit('close')"
  >
    <section
      class="modal-box flex max-h-[80dvh] w-full max-w-sm flex-col overflow-hidden border border-base-content/10 bg-base-100 p-0"
    >
      <header
        class="flex items-center justify-between border-b border-base-content/10 px-5 py-4"
      >
        <h3 class="text-sm font-semibold">Local broadcast</h3>
        <button
          type="button"
          class="btn btn-square btn-ghost btn-sm"
          @click="emit('close')"
        >
          <Icon name="lucide:x" class="size-4" />
        </button>
      </header>
      <div class="overflow-y-auto px-5 py-5">
        <div v-if="!broadcastActive" class="space-y-4">
          <div
            class="rounded-lg border border-base-content/10 bg-base-200/50 p-3"
          >
            <p class="mb-2 text-xs font-medium text-base-content/60">
              1. Start VLC
            </p>
            <p class="mb-1 text-xs text-base-content/80">
              Run this command in your terminal:
            </p>
            <pre
              class="overflow-x-auto rounded bg-base-300 p-2 text-[11px] leading-relaxed text-base-content/90 select-all"
              >{{ vlcCommand }}</pre>
          </div>
          <div
            class="rounded-lg border border-base-content/10 bg-base-200/50 p-3"
          >
            <p class="mb-2 text-xs font-medium text-base-content/60">
              2. Connect
            </p>
            <p class="text-xs text-base-content/80">
              Once VLC is running, click <strong>Start broadcast</strong> below.
              dSpeak will connect to the local VLC stream and publish it to your
              voice channel.
            </p>
          </div>
          <div
            class="rounded-lg border border-base-content/10 bg-base-200/50 p-3"
          >
            <p class="mb-2 text-xs font-medium text-base-content/60">Pro tip</p>
            <p class="text-xs text-base-content/80">
              VLC plays the audio locally too. Keep the file on repeat (<kbd
                class="rounded bg-base-300 px-1 font-mono"
                >--repeat</kbd
              >) for uninterrupted broadcasting.
            </p>
          </div>
        </div>
        <div v-else class="space-y-3">
          <div
            class="flex items-center gap-2 rounded-lg border border-base-content/10 bg-base-200/50 px-3 py-2"
          >
            <span
              v-if="broadcastStatus === 'connecting'"
              class="loading loading-spinner loading-xs text-warning"
              aria-label="Connecting"
            ></span>
            <span
              v-else-if="broadcastStatus === 'live'"
              class="size-2 rounded-full bg-success"
              aria-label="Live"
            ></span>
            <span
              v-else
              class="size-2 rounded-full bg-error"
              aria-label="Error"
            ></span>
            <span class="text-xs font-medium">{{ statusLabel }}</span>
          </div>
          <div v-if="broadcastStatus === 'live'" class="space-y-1">
            <label class="text-[11px] font-medium text-base-content/60"
              >Input level</label
            >
            <div class="h-2 overflow-hidden rounded-full bg-base-300">
              <div
                class="h-full rounded-full bg-success transition-all duration-150"
                :style="{ width: levelPercent + '%' }"
              ></div>
            </div>
          </div>
          <p
            v-if="broadcastError"
            class="rounded bg-error/10 p-2 text-[11px] text-error"
          >
            {{ broadcastError }}
          </p>
        </div>
      </div>
      <footer
        class="flex items-center justify-end gap-2 border-t border-base-content/10 px-5 py-4"
      >
        <button
          v-if="!broadcastActive"
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="connecting"
          @click="startBroadcast"
        >
          <span
            v-if="connecting"
            class="loading loading-spinner loading-xs"
          ></span>
          <Icon v-else name="lucide:radio" class="size-4" />
          Start broadcast
        </button>
        <button
          v-else
          type="button"
          class="btn btn-error btn-sm"
          @click="stopBroadcast"
        >
          <Icon name="lucide:square" class="size-4" />
          Stop broadcast
        </button>
      </footer>
    </section>
  </dialog>
</template>

<script setup>
import { computed, ref, watch, onUnmounted } from "vue";
import { useVoiceStore } from "../stores/voice";
import { useSettingsStore } from "../stores/settings";

const emit = defineEmits(["close"]);
const voiceStore = useVoiceStore();
const settingsStore = useSettingsStore();

const broadcastPort = ref(19350);
const sessionToken = ref(generateToken());
const connecting = ref(false);
const broadcastError = ref(null);
const broadcastStatus = ref("idle");
const levelPercent = ref(0);

let meterInterval = null;

const broadcastActive = computed(() => voiceStore.broadcastAudioSharing);

const statusLabel = computed(() => {
  switch (broadcastStatus.value) {
    case "connecting":
      return "Connecting to VLC stream…";
    case "live":
      return "Broadcasting live";
    case "error":
      return "Broadcast error";
    default:
      return "Idle";
  }
});

const vlcCommand = computed(() => {
  const file = `"${settingsStore.lastBroadcastFile || "~/Music/track.wav"}"`;
  return `/Applications/VLC.app/Contents/MacOS/VLC \\
  --intf dummy \\
  --no-audio \\
  --repeat \\
  --no-video \\
  --sout '#transcode{acodec=vorbis,ab=128,channels=2,samplerate=48000}:http{mux=ogg,dst=127.0.0.1:${broadcastPort.value}/${sessionToken.value}}' \\
  ${file}`;
});

function generateToken() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

watch(broadcastActive, (active) => {
  if (active) {
    broadcastStatus.value = "live";
    broadcastError.value = null;
    startMeter();
  } else {
    broadcastStatus.value = "idle";
    broadcastError.value = null;
    stopMeter();
  }
});

function startMeter() {
  const sharedAudioStats = voiceStore.sharedAudioStats;
  meterInterval = setInterval(() => {
    levelPercent.value = Math.min(
      100,
      Math.round((sharedAudioStats.level || 0) * 100),
    );
  }, 200);
}

function stopMeter() {
  if (meterInterval) {
    clearInterval(meterInterval);
    meterInterval = null;
  }
  levelPercent.value = 0;
}

async function startBroadcast() {
  connecting.value = true;
  broadcastError.value = null;
  broadcastStatus.value = "connecting";

  try {
    if (!voiceStore.sfuComposable?.value) {
      throw new Error("Not connected to a voice channel");
    }
    const proxyUrl = `/api/broadcast/stream?port=${broadcastPort.value}&token=${sessionToken.value}`;
    await voiceStore.sfuComposable.value.startBroadcastProduction(proxyUrl);
    broadcastStatus.value = "live";
  } catch (err) {
    broadcastError.value = err.message || "Failed to start broadcast";
    broadcastStatus.value = "error";
  } finally {
    connecting.value = false;
  }
}

async function stopBroadcast() {
  try {
    await voiceStore.sfuComposable.value?.stopBroadcastProduction?.();
  } catch (_) {
    /* noop */
  }
  broadcastStatus.value = "idle";
  broadcastError.value = null;
}

onUnmounted(() => {
  stopMeter();
});
</script>
