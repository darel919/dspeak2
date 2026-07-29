<template>
  <div v-if="history.length" class="stream-history">
    <h4
      class="mb-2 text-xs font-semibold text-base-content/50 uppercase tracking-wide"
    >
      Recently Played
    </h4>
    <div class="space-y-1">
      <div
        v-for="(entry, index) in history"
        :key="index"
        class="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-base-300/50"
      >
        <Icon
          name="lucide:music"
          class="size-3 shrink-0 text-base-content/40"
        />
        <span class="truncate font-medium">{{ entry.title }}</span>
        <span class="shrink-0 text-base-content/40">&middot;</span>
        <span class="shrink-0 text-base-content/50">{{ entry.artist }}</span>
        <span
          v-if="entry.playedAt"
          class="ml-auto shrink-0 text-base-content/30"
        >
          {{ timeAgo(entry.playedAt) }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { useStreamStore } from "../stores/stream";

const streamStore = useStreamStore();
const history = computed(() => streamStore.playHistory);

function timeAgo(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
</script>
