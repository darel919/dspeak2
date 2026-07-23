<template>
  <div v-if="!channel?.isMedia" class="flex flex-row h-full bg-base-100">
    <!-- Main Chat + MemberList Layout -->
    <div class="flex-1 flex flex-col">
      <!-- Chat Header -->
      <div class="bg-base-200 border-base-300 p-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <button
              v-if="showBackButton"
              @click="$emit('back')"
              class="btn btn-ghost btn-sm btn-circle md:hidden"
            >
              <Icon name="lucide:chevron-left" class="h-5 w-5" />
            </button>

            <div
              class="flex flex-col sm:flex-row items-start sm:items-center gap-0 sm:gap-3"
            >
              <!-- Channel type indicator -->
              <span
                v-if="channel?.isMedia"
                class="badge badge-warning badge-sm rounded-xs"
                >Voice Channel</span
              >
              <span v-else class="badge badge-info badge-sm rounded-xs"
                >Text Channel</span
              >
              <p
                class="font-semibold text-md"
                :title="channel?.desc || 'No description'"
              >
                #{{ channel?.name || "Channel" }}
              </p>
              <p class="text-sm opacity-40">{{ room?.name || "Room" }}</p>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <!-- Online members count for channel -->
            <div
              v-if="onlineUsers?.length > 0"
              class="badge badge-ghost badge-sm"
            >
              {{ onlineUsers.length }} online
            </div>
            <!-- Room members count -->
            <!-- <div v-if="room?.members" class="badge badge-outline badge-sm">
            {{ room.members.length }} members
          </div> -->
          </div>
        </div>
      </div>

      <!-- Messages Container -->
      <div
        ref="messagesContainer"
        class="flex-1 overflow-y-auto p-4 space-y-4"
        @scroll="handleScroll"
      >
        <OfflineBanner />

        <!-- Loading indicator -->
        <div
          v-if="loading && messages.length === 0"
          class="flex justify-center py-8"
        >
          <div class="loading loading-spinner loading-lg"></div>
        </div>

        <!-- Error message -->
        <div
          v-else-if="error && !offline && messages.length === 0"
          class="alert alert-error"
        >
          <Icon
            name="lucide:circle-x"
            class="stroke-current shrink-0 h-6 w-6"
          />
          <div>
            <h3 class="font-bold">Error loading messages</h3>
            <div class="text-xs">{{ error }}</div>
          </div>
          <button class="btn btn-sm btn-outline" @click="refreshMessages">
            Retry
          </button>
        </div>

        <!-- Empty state -->
        <div
          v-else-if="messages.length === 0 && !offline"
          class="text-center py-12"
        >
          <div class="text-base-content/50 mb-4">
            <Icon name="lucide:message-circle" class="h-16 w-16 mx-auto mb-4" />
            <p class="text-lg">No messages yet</p>
            <p class="text-sm">Start the conversation!</p>
          </div>
        </div>

        <!-- Messages -->
        <div v-else class="space-y-4">
          <ChatMessage
            v-for="message in messages"
            :key="message.id"
            :message="message"
            :room-members="room?.members || []"
            :permissions="room?.permissions || []"
            :is-room-owner="Boolean(room?.isOwner)"
            @show-details="handleShowDetails"
            @edit="openEditMessage"
            @delete="openDeleteMessage"
            @history="openMessageHistory"
          />
        </div>

        <!-- Scroll to bottom button -->
        <div v-if="showScrollButton" class="fixed bottom-20 right-6 z-10">
          <button
            @click="scrollToBottom"
            class="btn btn-circle btn-primary shadow-lg"
          >
            <Icon name="lucide:arrow-down" class="h-5 w-5" />
          </button>
        </div>
      </div>

      <!-- Chat Input -->
      <ChatInput
        :channel-id="channelId"
        :connected="connected"
        :typing-users="typingUsers"
        @message-sent="handleMessageSent"
      />

      <!-- Message Details Modal -->
      <MessageDetailsModal
        :show="showDetailsModal"
        :message="selectedMessage"
        @close="closeDetailsModal"
      />

      <div v-if="editingMessage" class="modal modal-open">
        <div class="modal-box">
          <h3 class="text-lg font-bold">Edit message</h3>
          <textarea
            v-model="editContent"
            class="textarea textarea-bordered mt-4 h-32 w-full"
            maxlength="4000"
            aria-label="Message content"
          ></textarea>
          <p v-if="actionError" class="mt-2 text-sm text-error" role="alert">
            {{ actionError }}
          </p>
          <div class="modal-action">
            <button
              class="btn btn-ghost"
              :disabled="actionPending"
              @click="closeAction"
            >
              Cancel
            </button>
            <button
              class="btn btn-primary"
              :disabled="actionPending || !editContent.trim()"
              @click="saveMessageEdit"
            >
              Save
            </button>
          </div>
        </div>
      </div>

      <div v-if="deletingMessage" class="modal modal-open">
        <div class="modal-box">
          <h3 class="text-lg font-bold">
            {{
              deletingMessage.sender?.id === currentUserId
                ? "Unsend message?"
                : "Delete message?"
            }}
          </h3>
          <p class="mt-3">
            This removes the message for everyone and cannot be undone.
          </p>
          <p v-if="actionError" class="mt-2 text-sm text-error" role="alert">
            {{ actionError }}
          </p>
          <div class="modal-action">
            <button
              class="btn btn-ghost"
              :disabled="actionPending"
              @click="closeAction"
            >
              Cancel
            </button>
            <button
              class="btn btn-error"
              :disabled="actionPending"
              @click="confirmDeleteMessage"
            >
              Delete
            </button>
          </div>
        </div>
      </div>

      <div v-if="historyMessage" class="modal modal-open">
        <div class="modal-box max-w-2xl">
          <h3 class="text-lg font-bold">Revision history</h3>
          <div v-if="historyLoading" class="mt-4 flex justify-center">
            <span class="loading loading-spinner"></span>
          </div>
          <p v-else-if="actionError" class="mt-4 text-error" role="alert">
            {{ actionError }}
          </p>
          <ol v-else class="mt-4 space-y-3">
            <li
              v-for="revision in messageHistory"
              :key="revision.id"
              class="border border-base-300 bg-base-200 p-3"
            >
              <div class="flex justify-between gap-4 text-xs opacity-70">
                <span>Revision {{ revision.revision }}</span>
                <time>{{ formatHistoryTime(revision.edited_at) }}</time>
              </div>
              <p class="mt-2 whitespace-pre-wrap break-words">
                {{ revision.content }}
              </p>
              <p class="mt-2 text-xs opacity-70">
                {{
                  revision.editor?.name ||
                  revision.editor?.email ||
                  "Unknown editor"
                }}
              </p>
            </li>
          </ol>
          <div class="modal-action">
            <button class="btn btn-primary" @click="closeAction">Close</button>
          </div>
        </div>
      </div>
    </div>

    <!-- MemberList Sidebar -->
    <transition name="fade">
      <div
        v-if="showMemberList"
        class="hidden md:flex flex-col w-[260px] min-w-[260px] border-l border-base-300 bg-base-100 h-full relative"
      >
        <button
          class="absolute top-2 right-2 btn btn-xs btn-circle btn-ghost z-10"
          @click="toggleMemberList"
          :title="'Hide member list'"
        >
          <Icon name="lucide:x" class="h-4 w-4" />
        </button>
        <MemberList
          :members="room?.members || []"
          :room="room"
          :room-id="room?.id || ''"
          :channel-id="channelId"
        />
      </div>
    </transition>
    <!-- Show button when hidden -->
    <button
      v-if="!showMemberList"
      class="hidden md:flex fixed right-4 top-24 z-30 btn btn-circle btn-primary btn-sm shadow-lg"
      @click="toggleMemberList"
      :title="'Show member list'"
    >
      <Icon name="lucide:chevron-left" class="h-5 w-5" />
    </button>
  </div>
</template>

<script setup>
import { useChatStore } from "../../stores/chat";
import { useAuthStore } from "../../stores/auth";
import ChatMessage from "./ChatMessage.vue";
import ChatInput from "./ChatInput.vue";
import MessageDetailsModal from "./MessageDetailsModal.vue";
import MemberList from "../MemberList.vue";
import OfflineBanner from "./OfflineBanner.vue";
import { STORAGE_KEYS } from "../../const/storage";
import { isPendingDuplicate } from "../../shared/chat-messages";

const showMemberList = ref(true);

onMounted(() => {
  const saved = localStorage.getItem(STORAGE_KEYS.chatMemberListVisible);
  showMemberList.value = saved === null ? true : saved === "true";
});

watch(showMemberList, (val) => {
  localStorage.setItem(
    STORAGE_KEYS.chatMemberListVisible,
    val ? "true" : "false",
  );
});

function toggleMemberList() {
  showMemberList.value = !showMemberList.value;
}

const props = defineProps({
  channelId: {
    type: String,
    required: true,
  },
  channel: {
    type: Object,
    default: null,
  },
  room: {
    type: Object,
    default: null,
  },
  showBackButton: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["back"]);

const chatStore = useChatStore();
const router = useRouter();
const messagesContainer = ref(null);
const showScrollButton = ref(false);
const isNearBottom = ref(true);
const showDetailsModal = ref(false);
const selectedMessage = ref(null);
const editingMessage = ref(null);
const deletingMessage = ref(null);
const historyMessage = ref(null);
const editContent = ref("");
const messageHistory = ref([]);
const actionPending = ref(false);
const historyLoading = ref(false);
const actionError = ref("");
const authStore = useAuthStore();
const currentUserId = computed(() => authStore.getUserData()?.id);

const messages = computed(() => {
  const all = chatStore.messages;
  return all.filter((message) => !isPendingDuplicate(message, all));
});
const loading = computed(() => chatStore.loading);
const error = computed(() => chatStore.error);
const connected = computed(() => chatStore.connected);
const offline = computed(() => chatStore.offline);
const typingUsers = computed(() => chatStore.typingUsers);
const onlineUsers = computed(() => chatStore.onlineUsers);

function getDisplayName(member) {
  if (member.id === currentUserId.value) return "You";
  const onlineUserIds = new Set(onlineUsers.value.map((user) => user.id));
  const isOnline = onlineUserIds.has(member.id);
  const firstName = member.name?.split(" ")[0] || member.name || "Unknown";
  return isOnline ? `${firstName} (online)` : firstName;
}

onMounted(async () => {
  await initializeChat();
});

onUnmounted(() => {});

watch(
  () => props.channelId,
  async (newChannelId, oldChannelId) => {
    if (newChannelId !== oldChannelId) {
      await initializeChat();
    }
  },
);

watch(
  messages,
  () => {
    nextTick(() => {
      if (isNearBottom.value) {
        scrollToBottom();
      }
    });
  },
  { deep: true },
);

async function initializeChat() {
  if (!props.channelId) return;

  try {
    await chatStore.connectToChannel(
      props.channelId,
      props.channel?.name,
      props.room?.id,
    );

    nextTick(() => {
      scrollToBottom();
    });
  } catch (error) {
    console.error("Failed to initialize chat:", error);
  }
}

function handleScroll() {
  if (!messagesContainer.value) return;

  const { scrollTop, scrollHeight, clientHeight } = messagesContainer.value;
  const scrollFromBottom = scrollHeight - scrollTop - clientHeight;

  isNearBottom.value = scrollFromBottom < 100;
  showScrollButton.value = scrollFromBottom > 200;
}

function scrollToBottom() {
  if (!messagesContainer.value) return;

  messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  isNearBottom.value = true;
  showScrollButton.value = false;
}

function handleMessageSent() {
  nextTick(() => {
    scrollToBottom();
  });
}

function handleShowDetails(message) {
  selectedMessage.value = message;
  showDetailsModal.value = true;
}

function closeDetailsModal() {
  showDetailsModal.value = false;
  selectedMessage.value = null;
}

function openEditMessage(message) {
  closeAction();
  editingMessage.value = message;
  editContent.value = message.content;
}

function openDeleteMessage(message) {
  closeAction();
  deletingMessage.value = message;
}

async function openMessageHistory(message) {
  closeAction();
  historyMessage.value = message;
  historyLoading.value = true;
  try {
    messageHistory.value = await chatStore.fetchMessageHistory(message.id);
  } catch (cause) {
    actionError.value = cause.message;
  } finally {
    historyLoading.value = false;
  }
}

async function saveMessageEdit() {
  if (!editingMessage.value || actionPending.value) return;
  actionPending.value = true;
  actionError.value = "";
  try {
    await chatStore.editMessage(editingMessage.value.id, editContent.value);
    closeAction();
  } catch (cause) {
    actionError.value = cause.message;
  } finally {
    actionPending.value = false;
  }
}

async function confirmDeleteMessage() {
  if (!deletingMessage.value || actionPending.value) return;
  actionPending.value = true;
  actionError.value = "";
  try {
    await chatStore.deleteMessage(deletingMessage.value.id);
    closeAction();
  } catch (cause) {
    actionError.value = cause.message;
  } finally {
    actionPending.value = false;
  }
}

function closeAction() {
  editingMessage.value = null;
  deletingMessage.value = null;
  historyMessage.value = null;
  editContent.value = "";
  messageHistory.value = [];
  actionError.value = "";
}

function formatHistoryTime(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString()
    : "Unavailable";
}

function handleMessageClick(message) {}

async function refreshMessages() {
  if (!props.channelId) return;

  try {
    await chatStore.fetchMessages(props.channelId);
    nextTick(() => {
      scrollToBottom();
    });
  } catch (error) {
    console.error("Failed to refresh messages:", error);
  }
}
</script>
