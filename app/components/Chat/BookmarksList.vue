<template>
  <div
    v-if="visible"
    class="metro-modal modal-open"
    role="dialog"
    aria-modal="true"
    aria-labelledby="bookmarks-title"
    @click.self="close"
  >
    <div class="metro-flyout max-w-lg">
      <h3
        id="bookmarks-title"
        class="text-lg font-bold flex items-center gap-2"
      >
        <Icon name="lucide:bookmark" class="h-5 w-5" />
        Saved messages
      </h3>

      <div v-if="loading" class="mt-4 flex justify-center">
        <span class="metro-spinner"></span>
      </div>

      <div
        v-else-if="bookmarkList.length === 0"
        class="mt-6 text-center py-8 text-base-content/50"
      >
        <Icon name="lucide:bookmark-minus" class="h-12 w-12 mx-auto mb-3" />
        <p>No saved messages yet</p>
        <p class="text-sm mt-1">
          Right-click a message and select Save message to add bookmarks
        </p>
      </div>

      <div v-else class="mt-4 space-y-3">
        <div
          v-for="bm in bookmarkList"
          :key="bm.id"
          class="border border-base-300 bg-base-200 p-3 rounded-lg"
        >
          <div class="flex items-center gap-2 mb-2">
            <span class="text-xs font-semibold">
              {{ bm.expand?.message?.sender?.name || "Unknown" }}
            </span>
            <span class="text-xs text-base-content/40">
              {{ formatTime(bm.expand?.message?.created) }}
            </span>
          </div>
          <p class="text-sm whitespace-pre-wrap break-words">
            {{ getExcerpt(bm.expand?.message?.content) }}
          </p>
          <div class="flex items-center gap-2 mt-2">
            <span class="text-xs text-base-content/40">
              Saved {{ formatTime(bm.saved_at) }}
            </span>
          </div>
        </div>
      </div>

      <div class="flex justify-end gap-3">
        <button class="metro-btn" @click="close">Close</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useChatStore } from "../../stores/chat";
import { stripMarkdown } from "../../shared/markdown-parser";

const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["close"]);

const chatStore = useChatStore();
const bookmarkList = ref([]);
const loading = ref(false);

watch(
  () => props.visible,
  (val) => {
    if (val) fetchBookmarks();
  },
);

async function fetchBookmarks() {
  loading.value = true;
  try {
    const result = await chatStore.fetchBookmarks();
    bookmarkList.value = result.bookmarks || [];
  } catch (error) {
    console.error("Failed to fetch bookmarks:", error);
    bookmarkList.value = [];
  } finally {
    loading.value = false;
  }
}

function formatTime(iso) {
  try {
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) return "";
    return date.toLocaleString();
  } catch {
    return "";
  }
}

function getExcerpt(content) {
  if (!content) return "";
  const stripped = stripMarkdown(content);
  return stripped.length > 150 ? stripped.slice(0, 150) + "..." : stripped;
}

function close() {
  emit("close");
}
</script>
