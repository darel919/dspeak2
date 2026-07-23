<template>
  <div class="dropdown dropdown-end">
    <label tabindex="0" class="btn btn-ghost btn-xs btn-circle">
      <Icon name="lucide:ellipsis-vertical" class="h-4 w-4" />
    </label>

    <ul
      tabindex="0"
      class="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-52"
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
import { useChatStore } from "../../stores/chat";
import { useAuthStore } from "../../stores/auth";

const props = defineProps({
  message: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(["mark-read", "show-details", "report"]);

const chatStore = useChatStore();
const authStore = useAuthStore();

const isOwnMessage = computed(() => {
  const userData = authStore.getUserData();
  return userData && props.message.sender.id === userData.id;
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

    console.debug("Message copied to clipboard");
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
