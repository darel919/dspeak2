<template>
  <div
    class="stream-setup rounded-box border border-base-content/20 bg-base-300 p-4"
  >
    <h3
      class="mb-3 text-sm font-semibold text-base-content/70 uppercase tracking-wide"
    >
      DJ Stream
    </h3>

    <div
      v-if="loading"
      class="flex items-center gap-2 text-sm text-base-content/60"
    >
      <span class="loading loading-spinner loading-sm"></span>
      Loading stream settings...
    </div>

    <template v-else-if="streamKey">
      <div class="mb-3">
        <label for="stream-key" class="mb-1 text-xs text-base-content/60"
          >Stream Key</label
        >
        <div class="flex gap-2">
          <input
            id="stream-key"
            :value="streamKey"
            class="input input-bordered input-sm flex-1 font-mono text-xs"
            readonly
            @click="copyStreamKey"
          />
          <button
            class="btn btn-sm btn-ghost"
            title="Copy"
            @click="copyStreamKey"
          >
            <Icon name="lucide:copy" class="size-4" />
          </button>
        </div>
      </div>

      <div class="mb-3">
        <label for="rtmp-url" class="mb-1 text-xs text-base-content/60"
          >RTMP URL</label
        >
        <div class="flex gap-2">
          <input
            id="rtmp-url"
            :value="rtmpUrl"
            class="input input-bordered input-sm flex-1 font-mono text-xs"
            readonly
            @click="copyRtmpUrl"
          />
          <button
            class="btn btn-sm btn-ghost"
            title="Copy"
            @click="copyRtmpUrl"
          >
            <Icon name="lucide:copy" class="size-4" />
          </button>
        </div>
      </div>

      <div class="mb-3 flex items-center gap-2 text-sm">
        <span
          class="inline-block size-2 rounded-full"
          :class="streamActive ? 'bg-success' : 'bg-base-content/30'"
        ></span>
        <span class="text-base-content/80">
          {{ streamActive ? "Live" : "Waiting for stream..." }}
        </span>
      </div>

      <div class="flex gap-2">
        <button
          v-if="streamActive"
          class="btn btn-error btn-sm"
          @click="stopStream"
        >
          <Icon name="lucide:square" class="size-4" />
          Stop Stream
        </button>
        <button class="btn btn-ghost btn-sm" @click="rotateKey">
          <Icon name="lucide:refresh-cw" class="size-4" />
          Regenerate Key
        </button>
      </div>
    </template>

    <div v-else class="text-sm text-base-content/60">
      No stream key configured. Click to generate.
      <button class="btn btn-primary btn-sm mt-2" @click="fetchKey">
        Generate Stream Key
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { useStreamStore } from "../stores/stream";
import { useRuntimeConfig } from "#app";

const props = defineProps({
  channelId: { type: String, required: true },
});

const streamStore = useStreamStore();
const config = useRuntimeConfig();
const streamKey = ref(null);
const loading = ref(false);
const rtmpUrl = ref("");

const streamActive = computed(() => streamStore.streamActive);

async function fetchKey() {
  loading.value = true;
  try {
    const result = await streamStore.fetchStreamKey(props.channelId);
    streamKey.value = result.streamKey;
    rtmpUrl.value = result.rtmpUrl;
  } catch (err) {
    console.error("[StreamSetup] Failed to fetch stream key:", err);
  } finally {
    loading.value = false;
  }
}

async function rotateKey() {
  if (
    !confirm(
      "Regenerating the key will disconnect any active stream. Continue?",
    )
  )
    return;
  loading.value = true;
  try {
    const result = await streamStore.rotateStreamKey(props.channelId);
    streamKey.value = result.streamKey;
    rtmpUrl.value = result.rtmpUrl;
  } catch (err) {
    console.error("[StreamSetup] Failed to rotate stream key:", err);
  } finally {
    loading.value = false;
  }
}

async function stopStream() {
  try {
    const response = await fetch(
      `${config.public.apiPath}/stream/stop/${props.channelId}`,
      { method: "POST" },
    );
    if (!response.ok) {
      console.error("[StreamSetup] Stop stream failed:", response.status);
    }
  } catch (err) {
    console.error("[StreamSetup] Stop stream error:", err);
  }
}

function copyStreamKey() {
  navigator.clipboard.writeText(streamKey.value).catch(() => {});
}

function copyRtmpUrl() {
  navigator.clipboard.writeText(rtmpUrl.value).catch(() => {});
}

onMounted(() => {
  fetchKey();
});
</script>
