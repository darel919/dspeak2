<template>
  <div
    v-if="streamActive"
    class="stream-now-playing flex items-center gap-3 rounded-box border border-primary/20 bg-primary/5 px-4 py-3"
  >
    <div class="relative shrink-0">
      <img
        v-if="albumArtUrl"
        :src="albumArtUrl"
        alt="Album art"
        class="size-12 rounded object-cover"
      />
      <div
        v-else
        class="flex size-12 items-center justify-center rounded bg-base-300 text-base-content/40"
      >
        <Icon name="lucide:music" class="size-6" />
      </div>
      <span class="absolute -right-1 -top-1 flex size-3">
        <span
          class="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75"
        ></span>
        <span
          class="relative inline-flex size-3 rounded-full bg-success"
        ></span>
      </span>
    </div>
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-medium">{{ title }}</p>
      <p class="truncate text-xs text-base-content/60">{{ artist }}</p>
    </div>
    <div class="shrink-0 text-xs text-success">Live</div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { useStreamStore } from "../stores/stream";

const streamStore = useStreamStore();

const streamActive = computed(() => streamStore.streamActive);
const title = computed(
  () => streamStore.streamMetadata?.title || "Unknown Track",
);
const artist = computed(
  () => streamStore.streamMetadata?.artist || "Unknown Artist",
);
const albumArtUrl = computed(
  () => streamStore.streamMetadata?.albumArtUrl || null,
);
</script>
