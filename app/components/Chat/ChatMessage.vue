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
          :src="getAvatarUrl(message.sender.avatar)"
          :alt="message.sender.name"
        />
      </div>
    </div>

    <div class="chat-header flex items-center">
      <span v-if="!isOwnMessage">{{ message.sender.name }}</span>
      <time class="text-xs opacity-50 ml-1 pb-1">{{
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
            @mark-read="handleMarkRead"
            @show-details="handleShowDetails"
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
    </div>
    <div v-else class="chat-bubble chat-bubble-secondary opacity-50 italic">
      [Unsupported message type]
    </div>

    <div
      v-if="isPending || (isOwnMessage ? hasBeenReadByOthers : isRead)"
      class="chat-footer opacity-50"
    >
      <div class="flex items-center gap-1 text-xs">
        <template v-if="isPending">
          <Icon
            name="lucide:refresh-cw"
            class="h-6 w-6 text-warning animate-spin"
          />
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
const hasBeenReadByOthers = computed(() => {
  if (!isOwnMessage.value || !props.message.read_by) return false;
  const readBy = Array.isArray(props.message.read_by)
    ? [...new Set(props.message.read_by)]
    : [];
  return readBy.some((id) => id !== props.message.sender.id);
});

import { useAuthStore } from "../../stores/auth";
import { useChatStore } from "../../stores/chat";
import { useRuntimeConfig } from "#app";
import MessageActions from "./MessageActions.vue";
import { useChatUtils } from "../../composables/useChatUtils";

const { formatChatDisplayTime } = useChatUtils();

const props = defineProps({
  message: {
    type: Object,
    required: true,
  },
  roomMembers: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits(["message-read", "show-details"]);

const authStore = useAuthStore();
const chatStore = useChatStore();
const config = useRuntimeConfig();
const showActions = ref(false);
const messageElement = ref(null);

const isOwnMessage = computed(() => {
  const userData = authStore.getUserData();
  return userData && props.message.sender.id === userData.id;
});

const isPending = computed(() => {
  return props.message.status === "pending";
});

const showReadStatus = computed(() => {
  return isOwnMessage.value && !isPending.value;
});

const isRead = computed(() => {
  const userData = authStore.getUserData();
  if (!userData || !props.message.read_by) return false;
  const readBy = Array.isArray(props.message.read_by)
    ? [...new Set(props.message.read_by)]
    : [];
  if (isOwnMessage.value) {
    const others = readBy.filter((id) => id !== props.message.sender.id);
    return others.length > 0;
  }

  return (
    readBy.includes(userData.id) && userData.id !== props.message.sender.id
  );
});

const shouldAutoMarkAsRead = computed(() => {
  const userData = authStore.getUserData();
  if (!userData || isOwnMessage.value) return false;

  return !props.message.read_by || !props.message.read_by.includes(userData.id);
});

onMounted(() => {
  if (shouldAutoMarkAsRead.value && messageElement.value) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && shouldAutoMarkAsRead.value) {
            setTimeout(() => {
              if (entry.isIntersecting && shouldAutoMarkAsRead.value) {
                markAsRead();
              }
            }, 1000);
          }
        });
      },
      { threshold: 0.5 },
    );

    observer.observe(messageElement.value);

    onUnmounted(() => {
      observer.disconnect();
    });
  }
});

async function markAsRead() {
  try {
    await chatStore.markMessageAsRead(props.message.id);
    emit("message-read", props.message.id);
  } catch (error) {
    console.error("Failed to mark message as read:", error);
  }
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
  const userData = authStore.getUserData();
  if (!userData) return "Sent";
  let readBy = Array.isArray(props.message.read_by)
    ? props.message.read_by
    : [];
  readBy = readBy.map((entry) =>
    typeof entry === "object" && entry !== null ? entry.id : entry,
  );
  const isOwn = isOwnMessage.value;
  if (isOwn) {
    const others = readBy.filter((id) => id && id !== props.message.sender.id);
    const totalOthers = props.roomMembers.filter(
      (m) => m.id !== props.message.sender.id,
    ).length;
    if (others.length === 0) return "";
    if (totalOthers > 0 && others.length === totalOthers) return `Read by all`;
    return `Read by ${others.length}`;
  } else {
    if (
      readBy.includes(userData.id) &&
      userData.id !== props.message.sender.id
    ) {
      return "Read";
    }
    return "";
  }
}

function getAvatarUrl(avatarPath) {
  if (!avatarPath) return "/favicon-32x32.png";

  if (avatarPath.startsWith("http")) return avatarPath;

  const apiPath = config.public.baseApiPath;
  return `${apiPath}/${avatarPath}`;
}
</script>
