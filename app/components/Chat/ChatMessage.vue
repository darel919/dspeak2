<template>
  <div
    ref="messageElement"
    :data-message-id="message.id"
    class="chat"
    :class="isOwnMessage ? 'chat-end' : 'chat-start'"
    @mouseenter="showActions = true"
    @mouseleave="showActions = false"
    @focusin="showActions = true"
    @focusout="showActions = false"
    @contextmenu.prevent="openContextMenu"
    tabindex="-1"
  >
    <div
      v-if="message.sender.id != authStore.getUserData()?.id"
      class="chat-image avatar"
    >
      <div class="w-10 rounded-full">
        <img
          :src="getAvatarUrl(identityStore.profileFor(message.sender).avatar)"
          :alt="identityStore.displayName(message.sender)"
        />
      </div>
    </div>

    <div class="chat-header flex items-center">
      <span v-if="!isOwnMessage">{{
        identityStore.displayName(message.sender)
      }}</span>
      <time class="ml-1 pb-1 text-xs text-base-content/65">{{
        formatChatDisplayTime(message.created)
      }}</time>

      <span
        v-if="message.pinned"
        class="ml-1 text-warning"
        title="Pinned message"
      >
        <Icon name="lucide:pin" class="size-3" />
      </span>

      <div
        class="ml-2 min-w-[32px] min-h-[32px] flex items-center justify-center"
        :class="isOwnMessage ? 'order-first mr-2 ml-0' : ''"
        style="transition: opacity 0.15s"
      >
        <div
          :style="
            showActions
              ? 'opacity:1;pointer-events:auto;'
              : 'opacity:0;pointer-events:none;'
          "
        >
          <MessageActions
            :message="message"
            :permissions="permissions"
            :is-room-owner="isRoomOwner"
            @mark-read="handleMarkRead"
            @show-details="handleShowDetails"
            @edit="$emit('edit', $event)"
            @delete="$emit('delete', $event)"
            @history="$emit('history', $event)"
            @reply="$emit('reply', $event)"
            @react="$emit('open-reaction-picker', $event)"
            @bookmark="$emit('bookmark', $event)"
            @pin="$emit('pin', $event)"
          />
        </div>
      </div>
    </div>

    <div
      v-if="typeof message.content === 'string'"
      class="chat-bubble"
      :class="isOwnMessage ? 'chat-bubble-primary' : 'chat-bubble-secondary'"
    >
      <button
        v-if="message.reply_to"
        type="button"
        class="mb-2 flex min-h-11 w-full items-center gap-2 border-b border-current/20 pb-2 text-left text-xs opacity-80 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        @click="$emit('jump-to', message.reply_to)"
        :aria-label="`Jump to message from ${getReplySenderName()}`"
      >
        <Icon name="lucide:corner-down-right" class="h-4 w-4 shrink-0" />
        <span class="truncate">Replying to {{ getReplySenderName() }}</span>
      </button>
      <div
        class="chat-message-content"
        v-html="renderContent(message.content)"
      ></div>

      <div
        v-if="message.attachments && message.attachments.length > 0"
        class="mt-2 flex flex-wrap gap-2"
      >
        <button
          v-for="(att, index) in message.attachments"
          :key="index"
          type="button"
          class="group relative min-h-11 min-w-11 border border-base-300 bg-base-100 p-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          :aria-label="`Open image: ${att.name || 'Attachment'}`"
          @click="openLightbox(index)"
        >
          <img
            :src="att.url || att.preview"
            :alt="att.name || 'Attachment'"
            class="max-h-[200px] max-w-[200px] object-contain transition-opacity group-hover:opacity-90"
          />
          <span
            v-if="isGif(att)"
            class="absolute top-1 left-1 badge badge-xs badge-accent font-semibold"
          >
            GIF
          </span>
        </button>
      </div>

      <LinkPreview v-if="linkPreview" :preview="linkPreview" />

      <span
        v-if="message.edited_at"
        class="ml-1 inline-flex align-middle text-base-content/65"
        title="Edited"
        aria-label="Edited"
      >
        <Icon name="lucide:pencil" class="size-3" />
      </span>
    </div>
    <div
      v-else
      class="chat-bubble chat-bubble-secondary border border-base-content/20 italic"
    >
      [Unsupported message type]
    </div>

    <div
      v-if="reactions.length > 0 || message.replyCount > 0"
      class="chat-footer message-engagement"
    >
      <div
        v-if="reactions.length > 0"
        class="message-reactions flex flex-wrap gap-1"
      >
        <button
          v-for="reaction in reactions"
          :key="reaction.emoji"
          class="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 border px-2 text-xs transition-colors"
          :class="
            reaction.hasReacted
              ? 'bg-primary/20 border-primary/40 text-primary'
              : 'bg-base-200 border-base-300 hover:bg-base-300'
          "
          :aria-pressed="reaction.hasReacted"
          @click="toggleReaction(reaction.emoji)"
        >
          <span>{{ reaction.emoji }}</span>
          <span>{{ reaction.count }}</span>
        </button>
        <button
          class="inline-flex min-h-11 min-w-11 items-center justify-center border border-base-300 bg-base-200 px-2 text-xs transition-colors hover:bg-base-300"
          aria-label="Add another reaction"
          @click="$emit('open-reaction-picker', message)"
        >
          <Icon name="lucide:plus" class="h-3 w-3" />
        </button>
      </div>

      <button
        v-if="message.replyCount > 0"
        class="message-thread-link inline-flex min-h-11 items-center gap-2 px-2 text-sm font-semibold text-primary hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        @click="$emit('open-thread', message)"
      >
        <Icon name="lucide:message-square" class="h-4 w-4" />
        {{ message.replyCount }}
        {{ message.replyCount === 1 ? "reply" : "replies" }}
      </button>
    </div>

    <div
      v-if="isOwnMessage && (isPending || isFailed || hasBeenReadByOthers)"
      class="chat-footer text-base-content/65"
    >
      <div class="flex items-center gap-1 text-xs">
        <template v-if="isPending">
          <Icon
            name="lucide:refresh-cw"
            class="h-6 w-6 text-warning animate-spin"
          />
        </template>
        <template v-else-if="isFailed">
          <Icon name="lucide:circle-alert" class="h-4 w-4 text-error" />
        </template>
        <template v-else>
          <span
            v-if="
              isOwnMessage &&
              props.roomMembers &&
              getStatusText() === 'Read by all'
            "
            style="
              position: relative;
              display: inline-block;
              width: 16px;
              height: 14px;
            "
          >
            <Icon name="lucide:circle-check" class="size-4" />
          </span>
          <Icon name="lucide:check" v-else class="h-4 w-4 text-info" />
        </template>
        <span>{{ getStatusText() }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useAuthStore } from "../../stores/auth";
import { useIdentityStore } from "../../stores/identity";
import { useChatStore } from "../../stores/chat";
import MessageActions from "./MessageActions.vue";
import LinkPreview from "./LinkPreview.vue";
import { useChatUtils } from "../../composables/useChatUtils";
import { hasReader, readerIds } from "../../shared/read-receipts";
import { parseMarkdown } from "../../shared/markdown-parser";
import {
  extractUrls,
  fetchLinkPreview,
  isImageUrl,
  isGifUrl,
} from "../../shared/link-preview";

const { formatChatDisplayTime, getAvatarUrl } = useChatUtils();

const props = defineProps({
  message: {
    type: Object,
    required: true,
  },
  roomMembers: {
    type: Array,
    default: () => [],
  },
  permissions: {
    type: Array,
    default: () => [],
  },
  isRoomOwner: {
    type: Boolean,
    default: false,
  },
  reactions: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits([
  "message-read",
  "show-details",
  "edit",
  "delete",
  "history",
  "reply",
  "bookmark",
  "pin",
  "react",
  "open-reaction-picker",
  "open-thread",
  "jump-to",
  "open-lightbox",
]);

const authStore = useAuthStore();
const identityStore = useIdentityStore();
const chatStore = useChatStore();
const showActions = ref(false);
const messageElement = ref(null);
const linkPreview = ref(null);
let visibilityObserver = null;
let readVisibilityTimer = null;

const isOwnMessage = computed(() => {
  const userData = authStore.getUserData();
  return userData && props.message.sender.id === userData.id;
});

const isPending = computed(() => {
  return props.message.status === "pending";
});

const isFailed = computed(() => {
  return props.message.status === "failed";
});

const hasBeenReadByOthers = computed(() => {
  if (!isOwnMessage.value) return false;
  return readerIds(props.message.read_by).some(
    (id) => id !== String(props.message.sender.id),
  );
});

const shouldAutoMarkAsRead = computed(() => {
  const userData = authStore.getUserData();
  if (!userData || isOwnMessage.value) return false;
  return !hasReader(props.message.read_by, userData.id);
});

onMounted(() => {
  if (!messageElement.value) return;
  visibilityObserver = new IntersectionObserver(handleVisibility, {
    threshold: 0.5,
  });
  visibilityObserver.observe(messageElement.value);
  fetchLinkPreviewForMessage();
});

onUnmounted(() => {
  if (visibilityObserver) visibilityObserver.disconnect();
  if (readVisibilityTimer) clearTimeout(readVisibilityTimer);
});

function handleVisibility(entries) {
  const visible = entries.some((entry) => entry.isIntersecting);
  if (!visible || !shouldAutoMarkAsRead.value) {
    if (readVisibilityTimer) clearTimeout(readVisibilityTimer);
    readVisibilityTimer = null;
    return;
  }
  if (readVisibilityTimer) return;
  readVisibilityTimer = setTimeout(() => {
    readVisibilityTimer = null;
    if (shouldAutoMarkAsRead.value) markAsRead();
  }, 1000);
}

function markAsRead() {
  chatStore.markMessageAsRead(props.message.id);
}

function handleMarkRead(messageId) {
  emit("message-read", messageId);
}

function handleShowDetails(message) {
  emit("show-details", message);
}

function openContextMenu() {
  showActions.value = true;
  nextTick(() => {
    messageElement.value
      ?.querySelector("[data-message-actions-trigger]")
      ?.click();
  });
}

function getStatusText() {
  if (isPending.value) {
    return "Pending";
  }
  if (isFailed.value) {
    return "Not saved — copy this message before resetting local data";
  }
  const readBy = readerIds(props.message.read_by);
  const senderId = String(props.message.sender.id);
  const others = readBy.filter((id) => id && id !== senderId);
  const otherMemberIds = new Set(
    props.roomMembers
      .map((member) => String(member.id))
      .filter((id) => id !== senderId),
  );
  if (others.length === 0) return "";
  if (
    otherMemberIds.size > 0 &&
    [...otherMemberIds].every((id) => others.includes(id))
  ) {
    return "Read by all";
  }
  return `Read by ${others.length}`;
}

function renderContent(content) {
  if (!content) return "";

  let html = parseMarkdown(content);

  html = html.replace(
    /@(everyone|here)\b/g,
    '<span class="mention-everyone bg-warning/20 text-warning px-1 rounded font-semibold">@$1</span>',
  );

  html = html.replace(
    /@(\w+)/g,
    '<span class="mention-user bg-primary/10 text-primary px-1 rounded">@$1</span>',
  );
  return html;
}

function getReplySenderName() {
  if (!props.message.reply_to) return "";
  const replyTo = props.message.reply_to;
  if (typeof replyTo === "object" && replyTo.sender) {
    return replyTo.sender.name || "Unknown";
  }
  return "a message";
}

function toggleReaction(emoji) {
  emit("react", { messageId: props.message.id, emoji });
}

function openLightbox(index) {
  emit("open-lightbox", {
    message: props.message,
    attachmentIndex: index,
  });
}

function isGif(attachment) {
  if (!attachment) return false;
  const url = attachment.url || attachment.preview || "";
  const mime = attachment.mime_type || "";
  if (mime === "image/gif") return true;
  return url.toLowerCase().endsWith(".gif");
}

async function fetchLinkPreviewForMessage() {
  if (!props.message.content || props.message.attachments?.length > 0) return;
  const urls = extractUrls(props.message.content);
  const imageOrGifUrls = urls.filter((url) => isImageUrl(url) || isGifUrl(url));
  if (imageOrGifUrls.length > 0) {
    return;
  }
  if (urls.length > 0) {
    const preview = await fetchLinkPreview(urls[0]);
    if (preview) {
      linkPreview.value = preview;
    }
  }
}
</script>

<style scoped>
.message-engagement {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem;
  margin-top: 0.25rem;
}

.chat-end .message-engagement {
  justify-content: flex-end;
}

.chat-message-content :deep(.chat-quote) {
  border-left: 3px solid var(--color-primary, oklch(0.5 0.2 240));
  padding-left: 0.75rem;
  margin: 0.25rem 0;
  color: var(--color-base-content, inherit);
  opacity: 0.8;
}

.chat-message-content :deep(.chat-inline-code) {
  background: var(--color-base-300, oklch(0.8 0 0));
  padding: 0.1rem 0.3rem;
  border-radius: 0.25rem;
  font-size: 0.875em;
}

.chat-message-content :deep(.chat-code-block) {
  background: var(--color-base-300, oklch(0.8 0 0));
  padding: 0.75rem;
  border-radius: 0.5rem;
  overflow-x: auto;
  margin: 0.5rem 0;
}

.chat-message-content :deep(del) {
  text-decoration: line-through;
  opacity: 0.7;
}

.chat-message-content :deep(.mention-everyone) {
  background: oklch(0.8 0.15 80 / 0.2);
  color: oklch(0.7 0.2 80);
}

.chat-message-content :deep(.mention-user) {
  background: oklch(0.6 0.2 240 / 0.1);
  color: oklch(0.6 0.2 240);
}
</style>
