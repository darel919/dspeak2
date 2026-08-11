<template>
  <div ref="rootRef" class="relative">
    <button
      ref="triggerRef"
      data-message-actions-trigger
      type="button"
      class="metro-icon-btn metro-icon-btn--ghost min-h-11 min-w-11"
      aria-label="Message actions"
      aria-haspopup="menu"
      :aria-expanded="isOpen"
      @click="toggleMenu"
      @keydown.down.prevent="openMenu"
    >
      <Icon name="lucide:ellipsis-vertical" class="h-4 w-4" />
    </button>

    <ul
      v-if="isOpen"
      ref="menuRef"
      class="metro-pane metro-message-actions-menu absolute right-0 top-full z-30 w-52 border border-base-300 bg-base-100 p-2"
      role="menu"
      aria-label="Message actions"
      @click="closeMenu(false)"
      @keydown="handleMenuKeydown"
    >
      <li role="none">
        <button role="menuitem" @click="handleReply">
          <Icon name="lucide:corner-down-right" class="h-4 w-4" />
          Reply
        </button>
      </li>
      <li role="none">
        <button role="menuitem" @click="handleReaction">
          <Icon name="lucide:smile-plus" class="h-4 w-4" />
          Add reaction
        </button>
      </li>
      <li role="none">
        <button role="menuitem" @click="handleCopyMessage">
          <Icon name="lucide:copy" class="h-4 w-4" />
          Copy message
        </button>
      </li>
      <li role="none">
        <button role="menuitem" @click="handleCopyLink">
          <Icon name="lucide:link" class="h-4 w-4" />
          Copy link
        </button>
      </li>
      <li v-if="canEdit" role="none">
        <button role="menuitem" @click="$emit('edit', message)">
          <Icon name="lucide:pencil" class="h-4 w-4" />
          Edit message
        </button>
      </li>
      <li v-if="canViewHistory && message.edited_at" role="none">
        <button role="menuitem" @click="$emit('history', message)">
          <Icon name="lucide:history" class="h-4 w-4" />
          Revision history
        </button>
      </li>
      <li role="none">
        <button role="menuitem" @click="handleBookmark">
          <Icon name="lucide:bookmark" class="h-4 w-4" />
          {{ isBookmarked ? "Remove bookmark" : "Save message" }}
        </button>
      </li>
      <li v-if="canPin" role="none">
        <button role="menuitem" @click="handlePin">
          <Icon name="lucide:pin" class="h-4 w-4" />
          {{ message.pinned ? "Unpin message" : "Pin message" }}
        </button>
      </li>
      <li v-if="canDelete" role="none">
        <button
          role="menuitem"
          class="text-error"
          @click="$emit('delete', message)"
        >
          <Icon name="lucide:trash-2" class="h-4 w-4" />
          {{ isOwnMessage ? "Unsend" : "Delete message" }}
        </button>
      </li>

      <li class="my-1 border-t border-base-300" role="separator"></li>

      <li role="none">
        <button role="menuitem" @click="handleViewDetails">
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
} from "~~/shared/message-policy.ts";

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
  "reply",
  "react",
  "bookmark",
  "pin",
]);

const chatStore = useChatStore();
const authStore = useAuthStore();
const rootRef = ref(null);
const triggerRef = ref(null);
const menuRef = ref(null);
const isOpen = ref(false);

onMounted(() => document.addEventListener("pointerdown", handleOutsidePointer));
onUnmounted(() =>
  document.removeEventListener("pointerdown", handleOutsidePointer),
);

function menuItems() {
  return [...(menuRef.value?.querySelectorAll('[role="menuitem"]') || [])];
}

async function openMenu() {
  isOpen.value = true;
  await nextTick();
  menuItems()[0]?.focus();
}

function closeMenu(restoreFocus = true) {
  if (!isOpen.value) return;
  isOpen.value = false;
  if (restoreFocus) nextTick(() => triggerRef.value?.focus());
}

function toggleMenu() {
  if (isOpen.value) closeMenu();
  else openMenu();
}

function handleOutsidePointer(event) {
  if (isOpen.value && !rootRef.value?.contains(event.target)) closeMenu(false);
}

function handleMenuKeydown(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    closeMenu();
    return;
  }
  const items = menuItems();
  const index = items.indexOf(document.activeElement);
  let nextIndex = null;
  if (event.key === "ArrowDown") nextIndex = (index + 1) % items.length;
  if (event.key === "ArrowUp")
    nextIndex = (index - 1 + items.length) % items.length;
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = items.length - 1;
  if (nextIndex === null || !items.length) return;
  event.preventDefault();
  items[nextIndex]?.focus();
}

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
const canPin = computed(() => {
  return props.isRoomOwner || props.permissions?.includes("message.moderate");
});
const isBookmarked = computed(() => {
  return props.message._bookmarked === true;
});

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

async function handleCopyLink() {
  try {
    const url = `${window.location.origin}/room/${props.message.room_channel}?messageId=${props.message.id}`;
    await navigator.clipboard.writeText(url);
    debugLog("Message link copied to clipboard");
  } catch (error) {
    console.error("Failed to copy link:", error);
  }
}

function handleReply() {
  emit("reply", props.message);
}

function handleReaction() {
  emit("react", props.message);
}

async function handleBookmark() {
  emit("bookmark", props.message);
}

async function handlePin() {
  emit("pin", props.message);
}

function handleReportMessage() {
  emit("report", props.message.id);
}

function handleViewDetails() {
  emit("show-details", props.message);
}
</script>
