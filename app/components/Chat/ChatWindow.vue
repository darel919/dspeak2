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
              class="btn btn-ghost btn-sm btn-circle"
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
        <ChatErrorBanner
          :channel-id="props.channelId"
          :channel-name="props.channel?.name"
          :room-id="props.room?.id"
        />

        <!-- Loading indicator -->
        <div v-if="loading" class="flex justify-center py-8">
          <div class="loading loading-spinner loading-lg"></div>
        </div>

        <!-- Error message -->
        <div v-else-if="error" class="alert alert-error">
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
        <div v-else-if="messages.length === 0" class="text-center py-12">
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
            @message-read="handleMessageRead"
            @show-details="handleShowDetails"
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
    </div>

    <!-- MemberList Sidebar -->
    <transition name="fade">
      <div
        v-if="showMemberList"
        class="hidden md:flex flex-col w-64 min-w-[16rem] max-w-xs border-l border-base-300 bg-base-100 h-full relative"
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
import ChatErrorBanner from "./ChatErrorBanner.vue";
import { STORAGE_KEYS } from "../../const/storage";

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
const authStore = useAuthStore();
const currentUserId = computed(() => authStore.getUserData()?.id);

const messages = computed(() => {
  const all = chatStore.messages;
  const sentIds = new Set(
    all.filter((m) => m.status !== "pending").map((m) => m.id),
  );

  return all.filter((msg, idx, arr) => {
    if (msg.status !== "pending") return true;

    return !arr.some(
      (other) =>
        other.status !== "pending" &&
        other.sender?.id === msg.sender?.id &&
        other.content === msg.content &&
        Math.abs(new Date(other.created) - new Date(msg.created)) < 15000,
    );
  });
});
const loading = computed(() => chatStore.loading);
const error = computed(() => chatStore.error);
const connected = computed(() => chatStore.connected);
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

function handleMessageRead(messageId) {
  console.debug("Message marked as read:", messageId);
}

function handleShowDetails(message) {
  selectedMessage.value = message;
  showDetailsModal.value = true;
}

function closeDetailsModal() {
  showDetailsModal.value = false;
  selectedMessage.value = null;
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
