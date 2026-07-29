<template>
  <div
    v-if="visible"
    class="modal modal-open"
    role="dialog"
    aria-modal="true"
    aria-labelledby="pinned-messages-title"
    @click.self="close"
  >
    <div class="modal-box max-w-lg">
      <h3
        id="pinned-messages-title"
        class="text-lg font-bold flex items-center gap-2"
      >
        <Icon name="lucide:pin" class="h-5 w-5" />
        Pinned messages
      </h3>

      <div v-if="loading" class="mt-4 flex justify-center">
        <span class="loading loading-spinner"></span>
      </div>

      <div
        v-else-if="pinnedList.length === 0"
        class="mt-6 text-center py-8 text-base-content/50"
      >
        <Icon name="lucide:pin-off" class="h-12 w-12 mx-auto mb-3" />
        <p>No pinned messages in this channel</p>
      </div>

      <div v-else class="mt-4 space-y-3">
        <div
          v-for="pin in pinnedList"
          :key="pin.id"
          class="border border-base-300 bg-base-200 p-3 rounded-lg"
        >
          <div class="flex items-center gap-2 mb-2">
            <span class="text-xs font-semibold">
              {{ pin.expand?.message?.sender?.name || "Unknown" }}
            </span>
            <span class="text-xs text-base-content/40">
              {{ formatTime(pin.expand?.message?.created) }}
            </span>
          </div>
          <p class="text-sm whitespace-pre-wrap break-words">
            {{ getExcerpt(pin.expand?.message?.content) }}
          </p>
          <div
            class="flex items-center gap-2 mt-2 text-xs text-base-content/40"
          >
            <Icon name="lucide:user" class="h-3 w-3" />
            <span v-if="pin.pinned_by">
              Pinned by {{ pin.pinned_by.name || "Unknown" }}
            </span>
            <span>{{ formatTime(pin.pinned_at) }}</span>
          </div>
        </div>
      </div>

      <div class="modal-action">
        <button class="btn" @click="close">Close</button>
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
  channelId: {
    type: String,
    required: true,
  },
});

const emit = defineEmits(["close"]);

const chatStore = useChatStore();
const pinnedList = ref([]);
const loading = ref(false);

watch(
  () => props.visible,
  (val) => {
    if (val) fetchPinned();
  },
);

async function fetchPinned() {
  loading.value = true;
  try {
    const result = await chatStore.fetchPinned(props.channelId);
    pinnedList.value = result.pinned || [];
  } catch (error) {
    console.error("Failed to fetch pinned messages:", error);
    pinnedList.value = [];
  } finally {
    loading.value = false;
  }
}

function refresh() {
  if (!props.visible) return;
  return fetchPinned();
}

defineExpose({ refresh });

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
