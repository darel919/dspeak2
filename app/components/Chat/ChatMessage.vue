<template>
  <div
    ref="messageElement"
    class="chat"
    :class="isOwnMessage ? 'chat-end' : 'chat-start'"
    @mouseenter="showActions = true"
    @mouseleave="showActions = false"
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
      <!-- Message Actions: always render, but toggle visibility -->
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
          />
        </div>
      </div>
    </div>

    <div
      v-if="typeof message.content === 'string'"
      class="chat-bubble"
      :class="isOwnMessage ? 'chat-bubble-primary' : 'chat-bubble-secondary'"
      style="white-space: pre-wrap; word-break: break-word"
    >
      {{ message.content }}
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
import { useChatUtils } from "../../composables/useChatUtils";
import { hasReader, readerIds } from "../../shared/read-receipts";

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
});

const emit = defineEmits([
  "message-read",
  "show-details",
  "edit",
  "delete",
  "history",
]);

const authStore = useAuthStore();
const identityStore = useIdentityStore();
const chatStore = useChatStore();
const showActions = ref(false);
const messageElement = ref(null);
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
</script>
