<template>
  <div
    ref="messageElement"
    :data-message-id="message.id"
    class="metro-message"
    :class="{ 'metro-message--own': isOwnMessage }"
    @mouseenter="showActions = true"
    @mouseleave="showActions = false"
    @focusin="showActions = true"
    @focusout="showActions = false"
    @contextmenu.prevent="openContextMenu"
    tabindex="-1"
  >
    <div class="metro-message-meta">
      <template v-if="!isOwnMessage">
        <span class="metro-message-avatar">
          <img
            v-if="getAvatarUrl(identityStore.profileFor(message.sender).avatar)"
            :src="getAvatarUrl(identityStore.profileFor(message.sender).avatar)"
            :alt="identityStore.displayName(message.sender)"
            class="metro-message-avatar-img"
          />
          <span v-else class="metro-message-avatar-fallback">
            {{
              identityStore
                .displayName(message.sender)
                .slice(0, 1)
                .toUpperCase()
            }}
          </span>
        </span>
        <span class="metro-message-sender">
          {{ identityStore.displayName(message.sender) }}
        </span>
      </template>
      <span v-else class="metro-message-sender metro-message-sender--own"
        >You</span
      >

      <time class="metro-message-time">{{
        formatChatDisplayTime(message.created)
      }}</time>

      <span
        v-if="message.pinned"
        class="metro-message-pin"
        title="Pinned message"
        aria-label="Pinned message"
      >
        <Icon name="lucide:pin" class="size-3" />
      </span>

      <span
        v-if="message.edited_at"
        class="metro-message-edited"
        title="Edited"
        aria-label="Edited"
      >
        <Icon name="lucide:pencil" class="size-3" />
      </span>

      <div class="metro-message-actions">
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
      class="metro-message-content"
      :class="{ 'metro-message-content--own': isOwnMessage }"
    >
      <button
        v-if="message.reply_to"
        type="button"
        class="metro-reply-preview"
        @click="$emit('jump-to', message.reply_to)"
        :aria-label="`Replied to ${getReplySenderName()}${replyPreviewText ? ': ' + replyPreviewText : ''}`"
      >
        <Icon
          name="lucide:corner-down-right"
          class="mt-0.5 h-4 w-4 shrink-0 self-start"
        />
        <div class="metro-reply-preview-body">
          <span class="truncate font-semibold leading-tight">{{
            getReplySenderName()
          }}</span>
          <span
            v-if="replyPreviewText"
            class="truncate leading-tight opacity-60"
            >{{ replyPreviewText }}</span
          >
          <span v-else class="truncate italic leading-tight opacity-40"
            >View message</span
          >
        </div>
      </button>
      <ChatMarkdownRenderer :content="message.content" />

      <div
        v-if="message.attachments && message.attachments.length > 0"
        class="mt-2 flex flex-wrap gap-2"
      >
        <button
          v-for="(att, index) in message.attachments"
          :key="index"
          type="button"
          class="metro-message-attachment"
          :aria-label="`Open image: ${att.name || 'Attachment'}`"
          @click="openLightbox(index)"
        >
          <img
            :src="att.url || att.preview"
            :alt="att.name || 'Attachment'"
            class="metro-message-attachment-img"
          />
          <span
            v-if="isGif(att)"
            class="absolute top-1 left-1 bg-accent px-1 py-0.5 text-[10px] font-semibold text-white"
          >
            GIF
          </span>
        </button>
      </div>

      <LinkPreview v-if="linkPreview" :preview="linkPreview" />
    </div>
    <div
      v-else
      class="metro-message-content metro-message-content--empty border border-base-content/20 italic"
    >
      [Unsupported message type]
    </div>

    <div
      v-if="reactions.length > 0 || message.replyCount > 0"
      class="metro-message-engagement"
    >
      <div v-if="reactions.length > 0" class="flex flex-wrap gap-1">
        <button
          v-for="reaction in reactions"
          :key="reaction.emoji"
          class="metro-reaction"
          :class="{ 'metro-reaction--active': reaction.hasReacted }"
          :aria-pressed="reaction.hasReacted"
          @click="toggleReaction(reaction.emoji)"
        >
          <span>{{ reaction.emoji }}</span>
          <span>{{ reaction.count }}</span>
        </button>
        <button
          class="metro-reaction-btn"
          aria-label="Add another reaction"
          @click="$emit('open-reaction-picker', message)"
        >
          <Icon name="lucide:plus" class="h-3 w-3" />
        </button>
      </div>

      <button
        v-if="message.replyCount > 0"
        class="metro-thread-link"
        @click="$emit('open-thread', message)"
      >
        <Icon name="lucide:message-square" class="h-4 w-4" />
        {{ message.replyCount }}
        {{ message.replyCount === 1 ? "reply" : "replies" }}
      </button>
    </div>

    <div
      v-if="isOwnMessage && (isPending || isFailed || hasBeenReadByOthers)"
      class="metro-message-status"
    >
      <template v-if="isPending">
        <Icon name="lucide:refresh-cw" class="h-4 w-4 text-warning" />
      </template>
      <template v-else-if="isFailed">
        <Icon name="lucide:circle-alert" class="h-4 w-4 text-error" />
      </template>
      <template v-else>
        <Icon name="lucide:circle-check" class="size-4" />
      </template>
      <span>{{ getStatusText() }}</span>
    </div>
  </div>
</template>

<script setup>
import { useAuthStore } from "../../stores/auth";
import { useIdentityStore } from "../../stores/identity";
import { useChatStore } from "../../stores/chat";
import MessageActions from "./MessageActions.vue";
import ChatMarkdownRenderer from "./MarkdownRenderer.vue";
import LinkPreview from "./LinkPreview.vue";
import { useChatUtils } from "../../composables/useChatUtils";
import { hasReader, readerIds } from "../../shared/read-receipts";

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

const replyTargetMessage = computed(() => {
  if (!props.message.reply_to) return null;
  const replyTo = props.message.reply_to;
  if (typeof replyTo === "object") return replyTo;
  return chatStore.messages.find((m) => m.id === replyTo) || null;
});

function stripMarkdown(text) {
  if (!text) return "";
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/```[\s\S]*?```/g, "[code block]")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/>\s?(.*)/g, "$1")
    .replace(/#{1,6}\s/g, "")
    .replace(/\n+/g, " ")
    .trim();
}

const replyPreviewText = computed(() => {
  const target = replyTargetMessage.value;
  if (!target || !target.content) return "";
  let text = stripMarkdown(target.content);
  if (text.length > 100) {
    text = text.slice(0, 97) + "...";
  }
  return text;
});

function getReplySenderName() {
  const target = replyTargetMessage.value;
  if (target && target.sender) {
    return target.sender.name || "Unknown";
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
.metro-message {
  display: flex;
  flex-direction: column;
  gap: var(--metro-space-1);
  padding: var(--metro-space-2) var(--metro-space-4);
  border-top: 1px solid var(--metro-border);
  transition: background-color 180ms cubic-bezier(0.1, 0.9, 0.2, 1);
}

.metro-message:hover {
  background: color-mix(in oklab, var(--color-base-content) 4%, transparent);
}

.metro-message:focus-visible {
  outline: 2px solid var(--metro-accent);
  outline-offset: -2px;
}

.metro-message--own {
}

.metro-message-meta {
  display: flex;
  align-items: center;
  gap: var(--metro-space-2);
}

.metro-message-avatar {
  display: inline-flex;
  width: 2rem;
  height: 2rem;
  flex: none;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: var(--color-base-300);
}

.metro-message-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.metro-message-avatar-fallback {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-base-content);
}

.metro-message-sender {
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.35;
  color: var(--color-base-content);
}

.metro-message-sender--own {
  color: var(--metro-accent);
}

.metro-message-time {
  font-size: 0.75rem;
  font-weight: 400;
  line-height: 1.4;
  color: var(--metro-muted);
}

.metro-message-pin,
.metro-message-edited {
  display: inline-flex;
  align-items: center;
  color: var(--metro-muted);
}

.metro-message-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
}

.metro-message-content {
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--color-base-content);
}

.metro-message-content--own {
}

.metro-message-content :deep(.chat-quote) {
  border-left: 3px solid var(--metro-accent);
  padding-left: var(--metro-space-3);
  margin: var(--metro-space-1) 0;
  opacity: 0.8;
}

.metro-message-content :deep(.chat-inline-code) {
  background: var(--color-base-300);
  padding: 0.1rem 0.3rem;
  border-radius: 0;
  font-size: 0.875em;
}

.metro-message-content :deep(.chat-code-block) {
  background: var(--color-base-300);
  padding: var(--metro-space-3);
  border-radius: 0;
  overflow-x: auto;
  margin: var(--metro-space-2) 0;
}

.metro-message-content :deep(del) {
  text-decoration: line-through;
  opacity: 0.7;
}

.metro-message-content :deep(.mention-everyone) {
  background: oklch(0.8 0.15 80 / 0.2);
  color: oklch(0.7 0.2 80);
}

.metro-message-content :deep(.mention-user) {
  background: oklch(0.6 0.2 240 / 0.1);
  color: oklch(0.6 0.2 240);
}

.metro-reply-preview {
  display: flex;
  width: 100%;
  min-height: var(--metro-control-size);
  align-items: stretch;
  gap: var(--metro-space-2);
  margin-bottom: var(--metro-space-2);
  border-bottom: 1px solid var(--metro-border);
  padding-bottom: var(--metro-space-2);
  text-align: left;
  font-size: 0.75rem;
  opacity: 0.8;
  background: none;
  border-top: none;
  border-left: none;
  border-right: none;
  color: inherit;
  cursor: pointer;
  transition: opacity 150ms ease;
}

.metro-reply-preview:hover {
  opacity: 1;
}

.metro-reply-preview:focus-visible {
  outline: 2px solid var(--metro-accent);
  outline-offset: 2px;
}

.metro-reply-preview-body {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  border-left: 2px solid
    color-mix(in oklab, var(--metro-accent) 30%, transparent);
  padding-left: var(--metro-space-2);
}

.metro-message-attachment {
  position: relative;
  display: inline-block;
  min-width: var(--metro-control-size);
  min-height: var(--metro-control-size);
  border: 1px solid var(--metro-border);
  background: var(--color-base-100);
  padding: 0.25rem;
  cursor: pointer;
  transition: opacity 150ms ease;
}

.metro-message-attachment:hover {
  opacity: 0.9;
}

.metro-message-attachment:focus-visible {
  outline: 2px solid var(--metro-accent);
  outline-offset: 2px;
}

.metro-message-attachment-img {
  max-height: 200px;
  max-width: 200px;
  object-fit: contain;
}

.metro-message-engagement {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--metro-space-1);
}

.metro-message--own .metro-message-engagement {
  justify-content: flex-end;
}

.metro-reaction-btn {
  display: inline-flex;
  min-height: var(--metro-control-size);
  min-width: var(--metro-control-size);
  align-items: center;
  justify-content: center;
  gap: var(--metro-space-1);
  padding: 0 var(--metro-space-2);
  font-size: 0.75rem;
  border: 1px solid var(--metro-border);
  border-radius: 0;
  background: var(--color-base-200);
  color: var(--color-base-content);
  cursor: pointer;
  transition:
    background-color 180ms cubic-bezier(0.1, 0.9, 0.2, 1),
    color 180ms cubic-bezier(0.1, 0.9, 0.2, 1);
}

.metro-reaction-btn:hover {
  background: var(--color-base-300);
}

.metro-reaction-btn--active {
  background: color-mix(in oklab, var(--metro-accent) 20%, transparent);
  border-color: color-mix(in oklab, var(--metro-accent) 40%, transparent);
  color: var(--metro-accent);
}

.metro-thread-link {
  display: inline-flex;
  min-height: var(--metro-control-size);
  align-items: center;
  gap: var(--metro-space-2);
  padding: 0 var(--metro-space-2);
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--metro-accent);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: background-color 150ms ease;
}

.metro-thread-link:hover {
  background: var(--color-base-200);
}

.metro-message-status {
  display: flex;
  align-items: center;
  gap: var(--metro-space-1);
  font-size: 0.75rem;
  color: var(--metro-muted);
}
</style>
