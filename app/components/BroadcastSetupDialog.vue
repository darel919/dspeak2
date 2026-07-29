<template>
  <aside
    aria-labelledby="broadcast-panel-title"
    class="pointer-events-none fixed inset-x-3 bottom-20 z-[70] flex justify-end sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[28rem]"
    @keydown.esc="emit('close')"
  >
    <section
      class="pointer-events-auto flex max-h-[min(72dvh,44rem)] w-full max-w-md flex-col overflow-hidden border border-base-content/15 bg-base-100 shadow-2xl"
    >
      <header
        class="flex items-center justify-between border-b border-base-content/10 px-5 py-4"
      >
        <div>
          <h3 id="broadcast-panel-title" class="text-sm font-semibold">
            DJ broadcast
          </h3>
          <p class="mt-0.5 text-[11px] text-base-content/55">
            Close this panel anytime. Your broadcast will keep playing.
          </p>
        </div>
        <button
          type="button"
          class="btn btn-square btn-ghost btn-sm"
          aria-label="Close DJ broadcast panel"
          @click="emit('close')"
        >
          <Icon name="lucide:x" class="size-4" />
        </button>
      </header>

      <div class="overflow-y-auto px-5 py-5">
        <div v-if="!broadcastActive" class="space-y-4">
          <label
            class="block cursor-pointer border border-dashed border-base-content/25 bg-base-200/40 p-4 transition-colors hover:border-primary/60 hover:bg-primary/5"
          >
            <span class="flex items-center gap-3">
              <span
                class="flex size-10 shrink-0 items-center justify-center bg-base-300"
              >
                <Icon name="lucide:music-2" class="size-5" />
              </span>
              <span class="min-w-0">
                <span class="block text-sm font-semibold">
                  {{
                    selectedFile ? selectedFile.name : "Choose an audio file"
                  }}
                </span>
                <span class="mt-0.5 block text-[11px] text-base-content/55">
                  {{
                    selectedFile
                      ? formatFileSize(selectedFile.size)
                      : "MP3, Ogg, WAV, M4A, or another browser-supported format"
                  }}
                </span>
              </span>
            </span>
            <input
              class="sr-only"
              type="file"
              accept="audio/*"
              aria-label="Choose audio file to broadcast"
              @change="selectFile"
            />
          </label>

          <div
            class="flex gap-3 border-l-2 border-primary bg-primary/8 px-3 py-2.5"
          >
            <Icon name="lucide:shield-check" class="mt-0.5 size-4 shrink-0" />
            <p class="text-xs leading-relaxed text-base-content/70">
              The file stays on this device. dSpeak plays it locally and sends
              only the resulting audio track to the voice channel.
            </p>
          </div>

          <p
            v-if="broadcastError"
            class="bg-error/10 p-2 text-[11px] text-error"
          >
            {{ broadcastError }}
          </p>
        </div>

        <div v-else class="space-y-3">
          <div
            class="flex items-center gap-2 border border-base-content/10 bg-base-200/50 px-3 py-2"
          >
            <span
              v-if="broadcastStatus === 'connecting'"
              class="loading loading-spinner loading-xs text-warning"
              aria-label="Connecting"
            ></span>
            <span
              v-else-if="broadcastStatus === 'live'"
              class="size-2 bg-success"
              aria-label="Live"
            ></span>
            <span v-else class="size-2 bg-error" aria-label="Error"></span>
            <span class="text-xs font-medium">{{ statusLabel }}</span>
            <span
              v-if="broadcastStatus === 'live'"
              class="ml-auto text-[11px] tabular-nums text-base-content/55"
            >
              {{ broadcastStats.dbfs.toFixed(0) }} dBFS ·
              {{ broadcastStats.kbps.toFixed(0) }} kbps
            </span>
          </div>

          <div class="border border-base-content/10 px-3 py-3">
            <p class="truncate text-xs font-semibold">
              {{ voiceStore.broadcastFileName }}
            </p>
            <div class="mt-3 h-2 overflow-hidden bg-base-300">
              <div
                class="h-full bg-success transition-all duration-150"
                :style="{ width: levelPercent + '%' }"
              ></div>
            </div>
            <div
              class="mt-1 flex justify-between text-[10px] text-base-content/45"
            >
              <span>Input level</span>
              <span>{{ levelPercent }}%</span>
            </div>
          </div>

          <p
            v-if="broadcastError"
            class="bg-error/10 p-2 text-[11px] text-error"
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
          :disabled="connecting || !selectedFile"
          @click.stop="startBroadcast()"
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
  </aside>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { useVoiceStore } from "../stores/voice";

const emit = defineEmits(["close"]);
const voiceStore = useVoiceStore();

const selectedFile = ref(null);
const connecting = ref(false);
const broadcastError = ref(null);
const broadcastStatus = ref("idle");

const broadcastActive = computed(() => voiceStore.broadcastAudioSharing);
const broadcastStats = computed(() => voiceStore.sharedAudioStats);
const levelPercent = computed(() =>
  Math.min(100, Math.round((broadcastStats.value.level || 0) * 100)),
);

const statusLabel = computed(() => {
  switch (broadcastStatus.value) {
    case "connecting":
      return "Publishing audio…";
    case "live":
      return "Broadcasting live";
    case "error":
      return "Broadcast error";
    default:
      return "Idle";
  }
});

watch(broadcastActive, (active) => {
  if (active) {
    broadcastStatus.value = "live";
    broadcastError.value = null;
  } else {
    broadcastStatus.value = "idle";
  }
});

function selectFile(event) {
  selectedFile.value = event.target.files?.[0] || null;
  broadcastError.value = null;
}

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function startBroadcast() {
  if (!selectedFile.value) return;
  connecting.value = true;
  broadcastError.value = null;
  broadcastStatus.value = "connecting";

  try {
    await voiceStore.startBroadcast(selectedFile.value);
    broadcastStatus.value = "live";
  } catch (error) {
    broadcastError.value =
      error?.message || "The selected audio file could not be broadcast";
    broadcastStatus.value = "error";
  } finally {
    connecting.value = false;
  }
}

async function stopBroadcast() {
  try {
    await voiceStore.stopBroadcast();
  } catch (error) {
    broadcastError.value =
      error?.message || "The broadcast could not be stopped";
    broadcastStatus.value = "error";
    return;
  }
  broadcastStatus.value = "idle";
  broadcastError.value = null;
}
</script>
