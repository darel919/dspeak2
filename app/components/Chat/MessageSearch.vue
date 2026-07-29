<template>
  <section
    class="absolute inset-y-0 right-0 z-30 flex w-full max-w-[26rem] flex-col border-l border-base-300 bg-base-100"
    aria-label="Message search"
  >
    <div class="border-b border-base-300 px-4 py-5">
      <div class="mb-5 flex items-start justify-between gap-4">
        <div>
          <p class="text-sm font-semibold text-primary">Current channel</p>
          <h2 class="text-2xl font-light">Search messages</h2>
        </div>
        <button
          class="btn btn-ghost btn-square h-11 min-h-11 w-11 min-w-11"
          @click="$emit('close')"
          aria-label="Close search"
        >
          <Icon name="lucide:x" class="h-5 w-5" />
        </button>
      </div>

      <div class="relative">
        <Icon
          name="lucide:search"
          class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-base-content/65"
        />
        <input
          v-model="searchQuery"
          type="search"
          aria-label="Search messages"
          placeholder="Search messages"
          class="input input-bordered h-11 w-full pl-10 focus-visible:outline-2 focus-visible:outline-primary"
          autocomplete="off"
          @keydown.enter="doSearch"
        />
      </div>

      <div class="mt-3 grid grid-cols-2 gap-2">
        <select
          v-model="filters.author"
          class="select select-bordered h-11 min-h-11 min-w-0 w-full focus-visible:outline-2 focus-visible:outline-primary"
          aria-label="Filter by author"
        >
          <option value="">All authors</option>
          <option v-for="member in members" :key="member.id" :value="member.id">
            {{ member.name || member.display_name || "Unknown" }}
          </option>
        </select>
        <select
          v-model="filters.has"
          class="select select-bordered h-11 min-h-11 min-w-0 w-full focus-visible:outline-2 focus-visible:outline-primary"
          aria-label="Filter by content type"
        >
          <option value="">Any content</option>
          <option value="attachment">Has attachments</option>
          <option value="link">Has links</option>
        </select>
        <span
          v-if="hasSearched && !loading"
          class="col-span-2 text-sm text-base-content/65"
          aria-live="polite"
        >
          {{ searchResults.length }}
          {{ searchResults.length === 1 ? "result" : "results" }}
        </span>
      </div>
    </div>

    <p v-if="searchError" class="px-4 pb-3 text-sm text-error" role="alert">
      {{ searchError }}
    </p>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div
        v-if="loading"
        class="flex min-h-24 items-center justify-center"
        aria-live="polite"
      >
        <span class="loading loading-spinner loading-sm text-primary"></span>
        <span class="sr-only">Searching messages</span>
      </div>

      <div
        v-else-if="searchResults.length === 0 && hasSearched"
        class="px-4 py-8 text-left"
      >
        <p class="font-semibold">No messages found</p>
        <p class="mt-1 text-sm text-base-content/65">
          Try fewer words or clear a filter.
        </p>
      </div>

      <button
        v-for="result in searchResults"
        :key="result.id"
        class="min-h-16 w-full cursor-pointer border-b border-base-200 px-4 py-3 text-left last:border-b-0 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
        :aria-label="`Jump to message from ${result.sender?.name || 'Unknown'}`"
        @click="handleJumpTo(result)"
      >
        <div class="flex items-center gap-2">
          <span class="text-sm font-semibold">
            {{ result.sender?.name || "Unknown" }}
          </span>
          <time class="ml-auto text-xs text-base-content/65">
            {{ formatTime(result.created) }}
          </time>
        </div>
        <p class="mt-1 truncate text-sm text-base-content/80">
          {{ getExcerpt(result.content) }}
        </p>
      </button>
    </div>
  </section>
</template>

<script setup>
import { useChatStore } from "../../stores/chat";
import { stripMarkdown } from "../../shared/markdown-parser";

const props = defineProps({
  channelId: {
    type: String,
    required: true,
  },
  members: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits(["close", "jump-to"]);
const chatStore = useChatStore();
const searchQuery = ref("");
const searchResults = ref([]);
const loading = ref(false);
const searchError = ref("");
const hasSearched = ref(false);
const filters = ref({ author: "", has: "" });
let searchTimer = null;
let searchGeneration = 0;

watch(searchQuery, scheduleSearch);
watch(filters, scheduleSearch, { deep: true });

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer);
  searchGeneration += 1;
});

function scheduleSearch() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(doSearch, 300);
}

function formatTime(iso) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getExcerpt(content) {
  if (!content) return "Image attachment";
  const stripped = stripMarkdown(content);
  return stripped.length > 100 ? `${stripped.slice(0, 100)}...` : stripped;
}

async function doSearch() {
  const hasFilters = Boolean(filters.value.author || filters.value.has);
  if (!searchQuery.value.trim() && !hasFilters) {
    searchGeneration += 1;
    searchResults.value = [];
    searchError.value = "";
    hasSearched.value = false;
    loading.value = false;
    return;
  }
  const generation = ++searchGeneration;
  loading.value = true;
  searchError.value = "";
  hasSearched.value = true;
  try {
    const result = await chatStore.searchMessages(
      props.channelId,
      searchQuery.value.trim(),
      {
        author: filters.value.author || undefined,
        has: filters.value.has || undefined,
      },
    );
    if (generation === searchGeneration)
      searchResults.value = result.messages || [];
  } catch (error) {
    console.error("Search failed:", error);
    if (generation === searchGeneration) {
      searchResults.value = [];
      searchError.value = "Search failed. Check your connection and try again.";
    }
  } finally {
    if (generation === searchGeneration) loading.value = false;
  }
}

function handleJumpTo(message) {
  emit("jump-to", message);
}
</script>
