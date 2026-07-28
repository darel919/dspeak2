<template>
  <div class="stream-setup">
    <div
      v-if="loading"
      class="flex items-center gap-2 py-8 text-sm text-base-content/50"
    >
      <span class="loading loading-spinner loading-sm"></span>
      Loading stream settings...
    </div>

    <template v-else-if="streamKey">
      <div class="space-y-5">
        <div>
          <p class="mb-2 text-xs font-medium text-base-content/40">
            Stream key
          </p>
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded bg-base-200 px-3 py-2.5 text-left font-mono text-xs text-base-content/80 transition-colors hover:bg-base-content/5"
            @click="copyStreamKey"
          >
            <span class="min-w-0 flex-1 truncate">{{ streamKey }}</span>
            <Icon
              name="lucide:copy"
              class="size-3.5 shrink-0 text-base-content/30"
            />
          </button>
        </div>

        <div>
          <p class="mb-2 text-xs font-medium text-base-content/40">RTMP URL</p>
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded bg-base-200 px-3 py-2.5 text-left font-mono text-xs text-base-content/80 transition-colors hover:bg-base-content/5"
            @click="copyRtmpUrl"
          >
            <span class="min-w-0 flex-1 truncate">{{ rtmpUrl }}</span>
            <Icon
              name="lucide:copy"
              class="size-3.5 shrink-0 text-base-content/30"
            />
          </button>
        </div>

        <div class="flex items-center gap-2.5 pt-1">
          <span
            class="inline-block size-1.5 rounded-full"
            :class="streamActive ? 'bg-success' : 'bg-base-content/20'"
          ></span>
          <span class="text-xs text-base-content/60">
            {{ streamActive ? "Stream is live" : "Waiting for stream..." }}
          </span>
        </div>

        <div class="flex items-center gap-2 pt-1">
          <button
            v-if="streamActive"
            class="btn btn-error btn-sm"
            @click="stopStream"
          >
            <Icon name="lucide:stop-circle" class="size-4" />
            Stop stream
          </button>
          <button class="btn btn-ghost btn-sm" @click="rotateKey">
            <Icon name="lucide:refresh-cw" class="size-4" />
            Regenerate key
          </button>
        </div>
      </div>
    </template>

    <div v-else class="py-6 text-center">
      <p class="mb-4 text-sm text-base-content/50">
        No stream key configured for this channel.
      </p>
      <button class="btn btn-primary btn-sm" @click="fetchKey">
        Generate stream key
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
