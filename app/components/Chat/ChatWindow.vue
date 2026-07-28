<template>
  <div
    v-if="!channel?.isMedia"
    :class="['relative flex h-full flex-row bg-base-100', $attrs.class]"
  >
    <div class="flex-1 min-w-0 flex flex-col">
      <div class="bg-base-200 border-base-300 p-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <button
              v-if="showBackButton"
              @click="$emit('back')"
              class="btn btn-ghost btn-sm btn-circle md:hidden"
              aria-label="Back to channels"
            >
              <Icon name="lucide:chevron-left" class="h-5 w-5" />
            </button>

            <div
              class="flex flex-col sm:flex-row items-start sm:items-center gap-0 sm:gap-3"
            >
              <span
                v-if="channel?.isMedia"
                class="badge badge-warning badge-sm rounded-xs"
                >Voice Channel</span
              >
              <span v-else class="badge badge-info badge-sm rounded-xs"
                >Text Channel</span
              >
              <h1
                class="font-semibold text-md"
                :title="channel?.desc || 'No description'"
              >
                #{{ channel?.name || "Channel" }}
              </h1>
              <p class="text-sm text-base-content/65">
                {{ room?.name || "Room" }}
              </p>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <button
              class="btn btn-ghost btn-sm btn-square"
              @click="showSearch = !showSearch"
              :title="'Search messages'"
            >
              <Icon name="lucide:search" class="h-4 w-4" />
            </button>

            <button
              class="btn btn-ghost btn-sm btn-square"
              @click="showPinned = true"
              :title="'Pinned messages'"
            >
              <Icon name="lucide:pin" class="h-4 w-4" />
            </button>

            <button
              class="btn btn-ghost btn-sm btn-square"
              @click="showBookmarks = true"
              :title="'Saved messages'"
            >
              <Icon name="lucide:bookmark" class="h-4 w-4" />
            </button>

            <div
              v-if="onlineUsers?.length > 0"
              class="badge badge-ghost badge-sm"
            >
              {{ onlineUsers.length }} online
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="actionError"
        class="border-l-4 border-error bg-error/10 px-4 py-3 text-sm text-error"
        role="alert"
      >
        {{ actionError }}
      </div>

      <MessageSearch
        v-if="showSearch"
        :channel-id="channelId"
        :members="room?.members || []"
        @close="showSearch = false"
        @jump-to="jumpToMessage"
      />

      <div
        ref="messagesContainer"
        class="flex-1 overflow-y-auto p-4 space-y-4"
        @scroll="handleScroll"
      >
        <OfflineBanner />

        <div
          v-if="loading && messages.length === 0"
          class="flex justify-center py-8"
        >
          <div class="loading loading-spinner loading-lg"></div>
        </div>

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

        <div v-else class="space-y-4">
          <button
            v-if="hiddenMessageCount > 0"
            type="button"
            class="btn btn-ghost btn-sm mx-auto flex"
            @click="showOlderMessages"
          >
            Show {{ Math.min(MESSAGE_WINDOW_STEP, hiddenMessageCount) }} older
            messages
          </button>
          <ChatMessage
            v-for="message in messages"
            :key="message.id"
            :message="message"
            :room-members="room?.members || []"
            :permissions="room?.permissions || []"
            :is-room-owner="Boolean(room?.isOwner)"
            :reactions="getReactionsForMessage(message.id)"
            @show-details="handleShowDetails"
            @edit="openEditMessage"
            @delete="openDeleteMessage"
            @history="openMessageHistory"
            @reply="handleReplyToMessage"
            @bookmark="handleBookmarkMessage"
            @pin="handlePinMessage"
            @react="handleReaction"
            @open-reaction-picker="openReactionPicker"
            @open-thread="openThread"
            @jump-to="jumpToMessage"
            @open-lightbox="openImageLightbox"
          />
        </div>

        <div v-if="showScrollButton" class="fixed bottom-20 right-6 z-10">
          <button
            @click="scrollToBottom"
            class="btn btn-circle btn-primary shadow-lg"
            aria-label="Scroll to the latest message"
          >
            <Icon name="lucide:arrow-down" class="h-5 w-5" />
          </button>
        </div>
      </div>

      <ChatInput
        :channel-id="channelId"
        :connected="connected"
        :typing-users="typingUsers"
        :replying-to="replyingTo"
        @message-sent="handleMessageSent"
        @cancel-reply="cancelReply"
      />

      <UndoSend
        :visible="showUndoSend"
        :message-id="lastSentMessageId"
        :expires-at="lastSentUndoExpiresAt"
        @undo="handleUndoSend"
        @expired="showUndoSend = false"
      />

      <MessageDetailsModal
        :show="showDetailsModal"
        :message="selectedMessage"
        @close="closeDetailsModal"
      />

      <div
        v-if="editingMessage"
        ref="actionDialog"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-message-title"
        @click.self="closeAction"
        @keydown="handleActionDialogKeydown"
      >
        <div
          class="w-full max-w-xl border border-base-300 border-l-4 border-l-primary bg-base-100 p-5"
        >
          <h3 id="edit-message-title" class="text-xl font-bold">
            Edit message
          </h3>
          <textarea
            ref="actionFirstControl"
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
              type="button"
              class="btn btn-primary min-h-11"
              :disabled="actionPending || !editContent.trim()"
              @click="saveMessageEdit"
            >
              Save
            </button>
          </div>
        </div>
      </div>

      <div
        v-if="deletingMessage"
        ref="actionDialog"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-message-title"
        aria-describedby="delete-message-description"
        @click.self="closeAction"
        @keydown="handleActionDialogKeydown"
      >
        <div
          class="w-full max-w-lg border border-base-300 border-l-4 border-l-error bg-base-100 p-5"
        >
          <h3 id="delete-message-title" class="text-lg font-bold">
            {{
              deletingMessage.sender?.id === currentUserId
                ? "Unsend message?"
                : "Delete message?"
            }}
          </h3>
          <p id="delete-message-description" class="mt-3">
            This removes the message for everyone and cannot be undone.
          </p>
          <p v-if="actionError" class="mt-2 text-sm text-error" role="alert">
            {{ actionError }}
          </p>
          <div class="modal-action">
            <button
              ref="actionFirstControl"
              type="button"
              class="btn btn-ghost min-h-11"
              :disabled="actionPending"
              @click="closeAction"
            >
              Cancel
            </button>
            <button
              type="button"
              class="btn btn-error min-h-11"
              :disabled="actionPending"
              @click="confirmDeleteMessage"
            >
              Delete
            </button>
          </div>
        </div>
      </div>

      <div
        v-if="historyMessage"
        ref="actionDialog"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="message-history-title"
        @click.self="closeAction"
        @keydown="handleActionDialogKeydown"
      >
        <div
          class="max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto border border-base-300 border-l-4 border-l-primary bg-base-100 p-5"
        >
          <h3 id="message-history-title" class="text-lg font-bold">
            Revision history
          </h3>
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
            <button
              ref="actionFirstControl"
              type="button"
              class="btn btn-primary min-h-11"
              @click="closeAction"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>

    <ThreadSidebar
      ref="threadSidebar"
      :visible="showThreadSidebar"
      :parent-message="threadParentMessage"
      :channel-id="channelId"
      :permissions="room?.permissions || []"
      :is-room-owner="Boolean(room?.isOwner)"
      @close="closeThread"
      @reply-sent="handleThreadReplySent"
      @show-details="handleShowDetails"
      @edit="openEditMessage"
      @delete="openDeleteMessage"
      @history="openMessageHistory"
      @open-reaction-picker="openReactionPicker"
      @bookmark="handleBookmarkMessage"
      @pin="handlePinMessage"
    />

    <transition name="fade">
      <div
        v-if="showMemberList && !showThreadSidebar"
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

    <button
      v-if="!showMemberList && !showThreadSidebar"
      class="hidden md:flex fixed right-4 top-24 z-30 btn btn-circle btn-primary btn-sm shadow-lg"
      @click="toggleMemberList"
      :title="'Show member list'"
    >
      <Icon name="lucide:chevron-left" class="h-5 w-5" />
    </button>
  </div>

  <PinnedMessages
    ref="pinnedMessages"
    :visible="showPinned"
    :channel-id="channelId"
    @close="showPinned = false"
  />

  <BookmarksList :visible="showBookmarks" @close="showBookmarks = false" />

  <ImageLightbox
    :visible="showLightbox"
    :images="lightboxImages"
    :initial-index="lightboxIndex"
    @close="closeLightbox"
  />

  <div
    v-if="showReactionPicker && reactionPickerMessage"
    class="fixed inset-0 z-50 flex items-center justify-center bg-base-300/40 p-4"
    role="dialog"
    aria-modal="true"
    aria-label="Add a reaction"
    tabindex="-1"
    @click.self="closeReactionPicker"
    @keydown.escape="closeReactionPicker"
  >
    <div class="max-h-[min(32rem,calc(100vh-2rem))] max-w-full overflow-auto">
      <EmojiPicker @select="handleReactionSelect" />
    </div>
  </div>
</template>

<script setup>
defineOptions({ inheritAttrs: false });
import { useChatStore } from "../../stores/chat";
import { useAuthStore } from "../../stores/auth";
import ChatMessage from "./ChatMessage.vue";
import ChatInput from "./ChatInput.vue";
import MessageDetailsModal from "./MessageDetailsModal.vue";
import MemberList from "../MemberList.vue";
import OfflineBanner from "./OfflineBanner.vue";
import ThreadSidebar from "./ThreadSidebar.vue";
import MessageSearch from "./MessageSearch.vue";
import PinnedMessages from "./PinnedMessages.vue";
import BookmarksList from "./BookmarksList.vue";
import ImageLightbox from "./ImageLightbox.vue";
import UndoSend from "./UndoSend.vue";
import EmojiPicker from "./EmojiPicker.vue";
import { STORAGE_KEYS } from "../../const/storage";
import { isPendingDuplicate } from "../../shared/chat-messages";
import { STARTUP_READINESS_KEY } from "../../shared/startup-readiness";

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
const startupReadiness = inject(STARTUP_READINESS_KEY, null);
const releaseInitialChatLoad =
  startupReadiness?.hold("Loading your conversation\u2026") || (() => {});
let initialChatLoadPending = true;
const messagesContainer = ref(null);
const showScrollButton = ref(false);
const isNearBottom = ref(true);
const showDetailsModal = ref(false);
const selectedMessage = ref(null);
const actionDialog = ref(null);
const actionFirstControl = ref(null);
let actionReturnFocus = null;
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
const MESSAGE_WINDOW_STEP = 100;
const messageWindowSize = ref(200);

const showSearch = ref(false);
const showPinned = ref(false);
const pinnedMessages = ref(null);
const showBookmarks = ref(false);
const showThreadSidebar = ref(false);
const threadSidebar = ref(null);
const threadParentMessage = ref(null);
const replyingTo = ref(null);
const showUndoSend = ref(false);
const lastSentMessageId = ref("");
const lastSentUndoExpiresAt = ref(0);
const showLightbox = ref(false);
const lightboxImages = ref([]);
const lightboxIndex = ref(0);
const messageReactions = ref({});
let reactionLoadTimer = null;
let reactionChannelGeneration = 0;
const showReactionPicker = ref(false);
const reactionPickerMessage = ref(null);

const deduplicatedMessages = computed(() => {
  const all = chatStore.messages;
  return all.filter((message) => !isPendingDuplicate(message, all));
});
const hiddenMessageCount = computed(() =>
  Math.max(0, deduplicatedMessages.value.length - messageWindowSize.value),
);

const messagesWithReplyCount = computed(() => {
  const msgList = deduplicatedMessages.value;
  const replyCounts = {};
  for (const m of msgList) {
    if (m.reply_to) {
      const parentId =
        typeof m.reply_to === "string" ? m.reply_to : m.reply_to.id;
      replyCounts[parentId] = (replyCounts[parentId] || 0) + 1;
    }
  }
  return msgList
    .filter((m) => !m.reply_to)
    .map((m) => ({
      ...m,
      replyCount: m.replyCount || replyCounts[m.id] || 0,
    }));
});

const messages = computed(() =>
  messagesWithReplyCount.value.slice(-messageWindowSize.value),
);
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

onUnmounted(() => {
  clearTimeout(reactionLoadTimer);
  releaseInitialChatReadiness();
});

watch(
  () => props.channelId,
  async (newChannelId, oldChannelId) => {
    if (newChannelId !== oldChannelId) {
      reactionChannelGeneration += 1;
      messageReactions.value = {};
      messageWindowSize.value = 200;
      showThreadSidebar.value = false;
      threadParentMessage.value = null;
      replyingTo.value = null;
      showSearch.value = false;
      await initializeChat();
    }
  },
);

watch(
  messages,
  (newMessages, oldMessages) => {
    nextTick(() => {
      if (isNearBottom.value) {
        scrollToBottom();
      }
    });

    if (newMessages?.length) {
      const newIds = newMessages
        .filter(
          (m) =>
            m.id &&
            !m.id.startsWith("pending_") &&
            !messageReactions.value[m.id],
        )
        .map((m) => m.id);
      if (newIds.length > 0) {
        clearTimeout(reactionLoadTimer);
        reactionLoadTimer = setTimeout(() => {
          loadVisibleReactions();
        }, 500);
      }
    }
  },
  { deep: true },
);

watch(
  () => chatStore.reactionChanged,
  async (reactionEvent) => {
    if (reactionEvent?.messageId) {
      try {
        await loadReactions([reactionEvent.messageId]);
      } catch {}
    }
  },
);

watch(
  () => chatStore.pinChanged,
  async (pinEvent) => {
    if (String(pinEvent?.channelId) !== String(props.channelId)) return;
    await pinnedMessages.value?.refresh();
  },
);

async function initializeChat() {
  if (!props.channelId) {
    releaseInitialChatReadiness();
    return;
  }

  try {
    await chatStore.connectToChannel(
      props.channelId,
      props.channel?.name,
      props.room?.id,
    );

    await loadVisibleReactions();

    nextTick(() => {
      scrollToBottom();
    });
  } catch (error) {
    console.error("Failed to initialize chat:", error);
  } finally {
    await nextTick();
    releaseInitialChatReadiness();
  }
}

async function loadVisibleReactions() {
  const reactionMessageIds = messages.value
    .map((message) => message.id)
    .filter((id) => id && !id.startsWith("pending_"))
    .slice(0, 200);
  if (reactionMessageIds.length) await loadReactions(reactionMessageIds);
}

async function loadReactions(reactionMessageIds) {
  const generation = reactionChannelGeneration;
  const channelId = props.channelId;
  const apiPath = useRuntimeConfig().public.apiPath;
  const query = new URLSearchParams({
    channelId,
    messageIds: reactionMessageIds.join(","),
  });
  const response = await fetch(`${apiPath}/chat/reactions?${query}`, {
    credentials: "include",
  });
  if (!response.ok)
    throw new Error(`Failed to load reactions: ${response.status}`);
  const data = await response.json();
  if (
    generation !== reactionChannelGeneration ||
    String(channelId) !== String(props.channelId)
  )
    return;
  const currentUserIdVal = currentUserId.value;
  for (const messageId of reactionMessageIds) {
    messageReactions.value[messageId] = (
      data.reactionsByMessage?.[messageId] || []
    ).map((reaction) => ({
      ...reaction,
      hasReacted: reaction.users?.some(
        (user) => String(user.id) === String(currentUserIdVal),
      ),
    }));
  }
}

function releaseInitialChatReadiness() {
  if (!initialChatLoadPending) return;
  initialChatLoadPending = false;
  releaseInitialChatLoad();
}

function handleScroll() {
  if (!messagesContainer.value) return;

  const { scrollTop, scrollHeight, clientHeight } = messagesContainer.value;
  if (scrollTop < 80 && hiddenMessageCount.value > 0) showOlderMessages();
  const scrollFromBottom = scrollHeight - scrollTop - clientHeight;

  isNearBottom.value = scrollFromBottom < 100;
  showScrollButton.value = scrollFromBottom > 200;
}

async function showOlderMessages() {
  const container = messagesContainer.value;
  const previousHeight = container?.scrollHeight || 0;
  messageWindowSize.value += MESSAGE_WINDOW_STEP;
  await nextTick();
  if (container)
    container.scrollTop += Math.max(0, container.scrollHeight - previousHeight);
}

function scrollToBottom() {
  if (!messagesContainer.value) return;

  messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  isNearBottom.value = true;
  showScrollButton.value = false;
}

async function handleMessageSent(result) {
  nextTick(() => {
    scrollToBottom();
  });

  replyingTo.value = null;

  if (showThreadSidebar.value && threadParentMessage.value) {
    await nextTick();
    await threadSidebar.value?.refresh();
  }

  if (result && result.id && !result.id.startsWith("pending_")) {
    const expiresAt = new Date(result.created).getTime() + 3000;
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return;
    lastSentMessageId.value = result.id;
    lastSentUndoExpiresAt.value = expiresAt;
    showUndoSend.value = true;
  }
}

function handleUndoSend() {
  showUndoSend.value = false;
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
  prepareActionDialog();
  editingMessage.value = message;
  editContent.value = message.content;
  nextTick(() => actionFirstControl.value?.focus());
}

function openDeleteMessage(message) {
  prepareActionDialog();
  deletingMessage.value = message;
  nextTick(() => actionFirstControl.value?.focus());
}

async function openMessageHistory(message) {
  prepareActionDialog();
  historyMessage.value = message;
  historyLoading.value = true;
  nextTick(() => actionFirstControl.value?.focus());
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
    if (showThreadSidebar.value) await threadSidebar.value?.refresh();
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
    const deletedMessageId = deletingMessage.value.id;
    await chatStore.deleteMessage(deletedMessageId);
    if (String(threadParentMessage.value?.id) === String(deletedMessageId)) {
      closeThread();
    } else if (showThreadSidebar.value) {
      await threadSidebar.value?.refresh();
    }
    closeAction();
  } catch (cause) {
    actionError.value = cause.message;
  } finally {
    actionPending.value = false;
  }
}

function prepareActionDialog() {
  const activeElement = document.activeElement;
  actionReturnFocus =
    activeElement?.closest('[role="menu"]')?.previousElementSibling ||
    activeElement;
  editingMessage.value = null;
  deletingMessage.value = null;
  historyMessage.value = null;
  editContent.value = "";
  messageHistory.value = [];
  actionError.value = "";
}

function closeAction() {
  editingMessage.value = null;
  deletingMessage.value = null;
  historyMessage.value = null;
  editContent.value = "";
  messageHistory.value = [];
  actionError.value = "";
  nextTick(() => actionReturnFocus?.focus());
}

function handleActionDialogKeydown(event) {
  if (event.key === "Escape" && !actionPending.value) {
    event.preventDefault();
    closeAction();
    return;
  }
  if (event.key !== "Tab") return;
  const controls = Array.from(
    actionDialog.value?.querySelectorAll(
      'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) || [],
  );
  if (controls.length === 0) return;
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function formatHistoryTime(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString()
    : "Unavailable";
}

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

function handleReplyToMessage(message) {
  replyingTo.value = message;
}

function cancelReply() {
  replyingTo.value = null;
}

function openThread(message) {
  threadParentMessage.value = message;
  showThreadSidebar.value = true;
  showMemberList.value = false;
}

function closeThread() {
  showThreadSidebar.value = false;
  threadParentMessage.value = null;
}

function handleThreadReplySent() {
  if (threadParentMessage.value) {
    threadSidebar.value?.refresh();
    refreshMessageReplyCount(threadParentMessage.value.id);
  }
}

function refreshMessageReplyCount(messageId) {
  const count = chatStore.messages.filter(
    (m) =>
      m.reply_to &&
      (typeof m.reply_to === "string"
        ? m.reply_to === messageId
        : m.reply_to.id === messageId || m.reply_to === messageId),
  ).length;
  const msg = chatStore.messages.find((m) => m.id === messageId);
  if (msg) {
    msg.replyCount = count;
  }
}

function getReactionsForMessage(messageId) {
  const reactions = messageReactions.value[messageId] || [];
  const currentUserIdVal = currentUserId.value;
  return reactions.map((r) => ({
    ...r,
    hasReacted: r.users
      ? r.users.some((u) => String(u.id) === String(currentUserIdVal))
      : r.hasReacted || false,
  }));
}

async function handleReaction({ messageId, emoji }) {
  actionError.value = "";
  try {
    const apiPath = useRuntimeConfig().public.apiPath;
    const response = await fetch(`${apiPath}/chat/reaction`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId, emoji }),
    });
    await requireSuccessfulResponse(response, "Reaction failed");
    const data = await response.json();
    const currentUserIdVal = currentUserId.value;
    messageReactions.value[messageId] = (data.reactions || []).map((r) => ({
      ...r,
      hasReacted: r.users
        ? r.users.some((u) => String(u.id) === String(currentUserIdVal))
        : false,
    }));
  } catch (err) {
    actionError.value = err.message || "Reaction failed";
  }
}

function openReactionPicker(message) {
  reactionPickerMessage.value = message;
  showReactionPicker.value = true;
}

function closeReactionPicker() {
  showReactionPicker.value = false;
  reactionPickerMessage.value = null;
}

async function handleReactionSelect(emoji) {
  const message = reactionPickerMessage.value;
  if (message && emoji) {
    await handleReaction({ messageId: message.id, emoji });
  }
  closeReactionPicker();
}

async function handleBookmarkMessage(message) {
  actionError.value = "";
  try {
    const apiPath = useRuntimeConfig().public.apiPath;
    const isBookmarked = message._bookmarked;
    if (isBookmarked) {
      const response = await fetch(`${apiPath}/chat/bookmark`, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: message.id }),
      });
      await requireSuccessfulResponse(response, "Bookmark update failed");
      message._bookmarked = false;
    } else {
      const response = await fetch(`${apiPath}/chat/bookmark`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: message.id }),
      });
      await requireSuccessfulResponse(response, "Bookmark update failed");
      message._bookmarked = true;
    }
  } catch (err) {
    actionError.value = err.message || "Bookmark update failed";
  }
}

async function handlePinMessage(message) {
  actionError.value = "";
  try {
    const apiPath = useRuntimeConfig().public.apiPath;
    if (message.pinned) {
      const response = await fetch(`${apiPath}/chat/unpin`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: message.id }),
      });
      await requireSuccessfulResponse(response, "Pin update failed");
      message.pinned = false;
    } else {
      const response = await fetch(`${apiPath}/chat/pin`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId: message.id,
          channelId: props.channelId,
        }),
      });
      await requireSuccessfulResponse(response, "Pin update failed");
      message.pinned = true;
    }
  } catch (err) {
    actionError.value = err.message || "Pin update failed";
  }
}

async function requireSuccessfulResponse(response, fallback) {
  if (response.ok) return response;
  throw new Error(`${fallback} (${response.status})`);
}

function jumpToMessage(message) {
  showSearch.value = false;

  const index = chatStore.messages.findIndex((m) => m.id === message.id);
  if (index !== -1) {
    messageWindowSize.value = Math.max(messageWindowSize.value, index + 1);
    nextTick(() => {
      const container = messagesContainer.value;
      if (container) {
        const messageEl = container.querySelector(
          `[data-message-id="${message.id}"]`,
        );
        if (messageEl) {
          messageEl.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
    });
  }
}

function openImageLightbox({ message, attachmentIndex }) {
  const attachments = message.attachments || [];
  if (attachments.length > 0) {
    lightboxImages.value = attachments.map((att) => ({
      url: att.url || att.preview,
      name: att.name || "Image",
    }));
    lightboxIndex.value = attachmentIndex || 0;
    showLightbox.value = true;
  }
}

function closeLightbox() {
  showLightbox.value = false;
  lightboxImages.value = [];
}
</script>
