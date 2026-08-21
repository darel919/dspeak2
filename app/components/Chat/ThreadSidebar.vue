<template>
  <Transition name="charm">
    <div
      v-if="visible"
      key="thread-sidebar"
      class="fixed inset-0 z-40 flex h-full w-full min-w-0 flex-col border-l border-base-300 bg-base-100 md:static md:w-[340px] md:min-w-[340px]"
      role="complementary"
      aria-label="Thread"
    >
      <div
        class="flex min-h-16 items-center justify-between border-b border-base-300 px-4"
      >
        <div>
          <p class="text-xs font-semibold uppercase tracking-wide text-primary">
            Conversation
          </p>
          <h2 class="text-xl font-light">{{ threadTitle }}</h2>
        </div>
        <button
          class="metro-icon-btn metro-icon-btn--ghost h-11 min-h-11 w-11 min-w-11"
          @click="close"
          aria-label="Close thread"
        >
          <Icon name="lucide:x" class="h-4 w-4" />
        </button>
      </div>

      <div v-if="loading" class="flex justify-center py-8 flex-1">
        <span class="metro-spinner"></span>
      </div>

      <template v-else-if="threadParent">
        <div
          class="border-b border-base-300 bg-base-200/40 p-4"
          tabindex="-1"
          @contextmenu.prevent="openContextMenu"
        >
          <div class="flex items-start gap-3">
            <div class="chat-image avatar flex-shrink-0">
              <div class="w-10 rounded-full">
                <img
                  :src="getAvatarUrl(threadParent.sender?.avatar)"
                  :alt="threadParent.sender?.name || 'User'"
                />
              </div>
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="text-sm font-semibold">
                  {{ threadParent.sender?.name || "Unknown" }}
                </span>
                <span class="text-xs text-base-content/40">
                  {{ formatTime(threadParent.created) }}
                </span>
              </div>
              <p class="text-sm mt-1 whitespace-pre-wrap break-words">
                {{ stripMarkdown(threadParent.content || "") }}
              </p>
            </div>
            <MessageActions
              :message="threadParent"
              :permissions="permissions"
              :is-room-owner="isRoomOwner"
              @show-details="$emit('show-details', $event)"
              @edit="$emit('edit', $event)"
              @delete="$emit('delete', $event)"
              @history="$emit('history', $event)"
              @reply="focusReplyComposer"
              @react="$emit('open-reaction-picker', $event)"
              @bookmark="$emit('bookmark', $event)"
              @pin="$emit('pin', $event)"
            />
          </div>
        </div>

        <div class="flex-1 space-y-1 overflow-y-auto py-2">
          <div
            v-if="threadReplies.length === 0"
            class="text-center py-8 text-sm text-base-content/50"
          >
            <p>No replies yet</p>
            <p class="mt-1">Be the first to reply</p>
          </div>

          <div
            v-for="reply in threadReplies"
            :key="reply.id"
            class="flex items-start gap-3 border-b border-base-200 px-4 py-3 last:border-b-0"
            tabindex="-1"
            @contextmenu.prevent="openContextMenu"
          >
            <div class="chat-image avatar flex-shrink-0">
              <div class="w-9 rounded-full">
                <img
                  :src="getAvatarUrl(reply.sender?.avatar)"
                  :alt="reply.sender?.name || 'User'"
                />
              </div>
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="text-xs font-semibold">
                  {{ reply.sender?.name || "Unknown" }}
                </span>
                <span class="text-xs text-base-content/40">
                  {{ formatTime(reply.created) }}
                </span>
              </div>
              <p class="text-sm mt-0.5 whitespace-pre-wrap break-words">
                {{ stripMarkdown(reply.content || "") }}
              </p>
            </div>
            <MessageActions
              :message="reply"
              :permissions="permissions"
              :is-room-owner="isRoomOwner"
              @show-details="$emit('show-details', $event)"
              @edit="$emit('edit', $event)"
              @delete="$emit('delete', $event)"
              @history="$emit('history', $event)"
              @reply="focusReplyComposer"
              @react="$emit('open-reaction-picker', $event)"
              @bookmark="$emit('bookmark', $event)"
              @pin="$emit('pin', $event)"
            />
          </div>
        </div>

        <div class="border-t border-base-300 p-4">
          <p v-if="replyError" class="mb-2 text-sm text-error" role="alert">
            {{ replyError }}
          </p>
          <form @submit.prevent="sendReply" class="flex gap-2">
            <input
              ref="replyInput"
              v-model="replyText"
              type="text"
              aria-label="Reply in thread"
              placeholder="Reply in thread..."
              class="metro-input h-11 min-h-11 min-w-0 flex-1"
              maxlength="4000"
              autocomplete="off"
            />
            <button
              type="submit"
              class="metro-btn metro-btn--primary btn-square h-11 min-h-11 w-11 min-w-11"
              :disabled="!replyText.trim() || sending"
              aria-label="Send reply"
            >
              <span
                v-if="sending"
                class="metro-spinner metro-spinner--xs"
              ></span>
              <Icon v-else name="lucide:send" class="h-4 w-4" />
            </button>
          </form>
        </div>
      </template>

      <div
        v-else
        class="flex-1 flex items-center justify-center text-sm text-base-content/40"
      >
        Select a message to view its thread
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { useChatStore } from "../../stores/chat";
import { useRuntimeConfig } from "#app";
import { stripMarkdown } from "../../shared/markdown-parser";
import { profileAssetUrl } from "../../shared/profile-assets";
import MessageActions from "./MessageActions.vue";
import { isExternalString } from "../../shared/types/boundary.ts";

const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
  parentMessage: {
    type: Object,
    default: null,
  },
  channelId: {
    type: String,
    required: true,
  },
  permissions: {
    type: Array,
    default: () => [],
  },
  isRoomOwner: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits([
  "close",
  "reply-sent",
  "show-details",
  "edit",
  "delete",
  "history",
  "open-reaction-picker",
  "bookmark",
  "pin",
]);

const chatStore = useChatStore();
const config = useRuntimeConfig();
const replies = ref([]);
const replyText = ref("");
const loading = ref(false);
const sending = ref(false);
const replyError = ref("");
const threadParent = ref(null);
const replyInput = ref(null);
let threadRequestGeneration = 0;
const threadTitle = computed(() => {
  if (threadParent.value?.sender?.name) {
    return `${threadParent.value.sender.name}'s thread`;
  }
  return "Thread";
});

const threadReplies = computed(() => {
  const parentId = threadParent.value?.id;
  if (!parentId) return [];
  const merged = new Map(replies.value.map((reply) => [reply.id, reply]));
  for (const message of chatStore.messages) {
    const replyTo = isExternalString(message.reply_to)
      ? message.reply_to
      : message.reply_to?.id;
    if (String(replyTo) === String(parentId)) merged.set(message.id, message);
  }
  return [...merged.values()].sort(
    (left, right) => Date.parse(left.created) - Date.parse(right.created),
  );
});

watch(
  () => props.parentMessage,
  (msg) => {
    if (msg) {
      threadParent.value = msg;
      fetchThreadReplies(msg.id);
    } else {
      threadRequestGeneration += 1;
      threadParent.value = null;
      replies.value = [];
    }
  },
  { immediate: true },
);

watch(
  () => props.visible,
  (val) => {
    if (val && props.parentMessage && !threadParent.value) {
      threadParent.value = props.parentMessage;
      fetchThreadReplies(props.parentMessage.id);
    }
  },
);

function getAvatarUrl(avatar) {
  return profileAssetUrl(avatar) || "";
}

function formatTime(iso) {
  try {
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) return "";
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function openContextMenu(event) {
  const buttons = Array.from(
    event.currentTarget?.getElementsByTagName("button") || [],
  );
  buttons
    .find((button) => button.dataset.messageActionsTrigger !== undefined)
    ?.click();
}

function focusReplyComposer() {
  replyInput.value?.focus();
}

async function fetchThreadReplies(messageId) {
  if (!messageId) return;
  const requestGeneration = ++threadRequestGeneration;
  loading.value = true;
  replyError.value = "";
  try {
    const apiPath = config.public.apiPath;
    const response = await fetch(
      `${apiPath}/chat/thread?messageId=${encodeURIComponent(messageId)}`,
      { credentials: "include" },
    );
    if (!response.ok)
      throw new Error(`Thread load failed (${response.status})`);
    const data = await response.json();
    if (requestGeneration !== threadRequestGeneration) return;
    threadParent.value = data.parent;
    replies.value = data.replies || [];
  } catch (error) {
    if (requestGeneration !== threadRequestGeneration) return;
    replyError.value = error.message || "Thread load failed";
  } finally {
    if (requestGeneration === threadRequestGeneration) loading.value = false;
  }
}

async function sendReply() {
  if (!replyText.value.trim() || sending.value || !threadParent.value) return;
  sending.value = true;
  replyError.value = "";
  const content = replyText.value.trim();
  try {
    await chatStore.sendMessage(props.channelId, content, {
      replyTo: threadParent.value.id,
    });
    replyText.value = "";
    emit("reply-sent");
  } catch (error) {
    replyText.value = content;
    replyError.value = error.message || "Reply could not be sent";
  } finally {
    sending.value = false;
  }
}

function refresh() {
  if (!threadParent.value) return Promise.resolve();
  return fetchThreadReplies(threadParent.value.id);
}

defineExpose({ refresh });

function close() {
  emit("close");
}
</script>
