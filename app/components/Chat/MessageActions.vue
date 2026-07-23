<template>
  <div class="dropdown dropdown-end">
    <label
      tabindex="0"
      class="btn btn-square btn-ghost btn-xs"
      aria-label="Message actions"
    >
      <Icon name="lucide:ellipsis-vertical" class="h-4 w-4" />
    </label>

    <ul
      tabindex="0"
      class="dropdown-content z-[1] menu w-52 border border-base-300 bg-base-100 p-2 shadow-xl"
    >
      <!-- <li v-if="!isOwnMessage">
        <button @click="handleMarkAsRead" :disabled="isRead">
          <Icon name="lucide:check" class="h-4 w-4" />
          {{ isRead ? 'Already read' : 'Mark as read' }}
        </button>
      </li>
       -->
      <li>
        <button @click="handleCopyMessage">
          <Icon name="lucide:copy" class="h-4 w-4" />
          Copy message
        </button>
      </li>
      <li v-if="canEdit">
        <button @click="$emit('edit', message)">
          <Icon name="lucide:pencil" class="h-4 w-4" />
          Edit message
        </button>
      </li>
      <li v-if="canViewHistory && message.edited_at">
        <button @click="$emit('history', message)">
          <Icon name="lucide:history" class="h-4 w-4" />
          Revision history
        </button>
      </li>
      <li v-if="canDelete">
        <button class="text-error" @click="$emit('delete', message)">
          <Icon name="lucide:trash-2" class="h-4 w-4" />
          {{ isOwnMessage ? "Unsend" : "Delete message" }}
        </button>
      </li>

      <!-- <li>
        <button @click="handleReportMessage">
          <Icon name="lucide:triangle-alert" class="h-4 w-4" />
          Report message
        </button>
      </li>
       -->
      <div class="divider my-1"></div>

      <li>
        <button @click="handleViewDetails">
          <Icon name="lucide:info" class="h-4 w-4" />
          Message details
        </button>
      </li>
    </ul>
  </div>
</template>

<script setup>
import { debugLog } from "../../shared/debug";
import { useChatStore } from "../../stores/chat";
import { useAuthStore } from "../../stores/auth";
import {
  canDeleteMessage,
  canEditMessage,
  canViewMessageHistory,
} from "~~/shared/message-policy.js";

const props = defineProps({
  message: {
    type: Object,
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
  "mark-read",
  "show-details",
  "report",
  "edit",
  "delete",
  "history",
]);

const chatStore = useChatStore();
const authStore = useAuthStore();

const isOwnMessage = computed(() => {
  const userData = authStore.getUserData();
  return userData && props.message.sender.id === userData.id;
});
const canEdit = computed(() =>
  canEditMessage(props.message, authStore.getUserData()?.id),
);
const canDelete = computed(() =>
  canDeleteMessage(
    props.message,
    authStore.getUserData()?.id,
    props.permissions,
    props.isRoomOwner,
  ),
);
const canViewHistory = computed(() =>
  canViewMessageHistory(props.permissions, props.isRoomOwner),
);

const isRead = computed(() => {
  const userData = authStore.getUserData();
  if (!userData) return false;

  return props.message.read_by && props.message.read_by.includes(userData.id);
});

async function handleMarkAsRead() {
  if (isRead.value || isOwnMessage.value) return;
  try {
    await chatStore.markMessageAsRead(props.message.id);
    emit("mark-read", props.message.id);
  } catch (error) {
    console.error("Failed to mark message as read:", error);
  }
}

async function handleCopyMessage() {
  try {
    await navigator.clipboard.writeText(props.message.content);

    debugLog("Message copied to clipboard");
  } catch (error) {
    console.error("Failed to copy message:", error);
  }
}

function handleReportMessage() {
  emit("report", props.message.id);
}

function handleViewDetails() {
  emit("show-details", props.message);
}
</script>
