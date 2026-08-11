<template>
  <div class="direct-messages-shell text-base-content">
    <aside
      class="direct-messages-sidebar"
      :class="selectedConversation && 'direct-messages-sidebar--hidden'"
      aria-label="Direct messages"
    >
      <header class="direct-messages-sidebar-header">
        <div class="direct-messages-sidebar-heading">
          <div class="direct-messages-sidebar-icon">
            <Icon name="lucide:message-circle" class="size-9" />
          </div>
          <h1>Messages</h1>
        </div>
        <NuxtLink
          to="/friends"
          class="metro-icon-btn metro-icon-btn--ghost"
          aria-label="Find friends"
          title="Find friends"
        >
          <Icon name="lucide:user-plus" class="size-5" />
        </NuxtLink>
      </header>

      <div class="direct-messages-sidebar-body">
        <div class="direct-messages-sidebar-section-label">
          <Icon name="lucide:message-square" class="size-3" />
          Conversations
        </div>
        <div class="direct-messages-sidebar-content">
          <div
            v-if="store.error && !store.conversations.length"
            class="direct-messages-sidebar-state"
            role="alert"
          >
            <p class="font-semibold">Couldn’t load messages</p>
            <p class="mt-1 text-sm text-base-content/60">{{ store.error }}</p>
            <button
              class="metro-btn metro-btn--secondary metro-btn--sm mt-4"
              type="button"
              @click="loadInbox"
            >
              Try again
            </button>
          </div>
          <div
            v-else-if="store.loading && !store.conversations.length"
            class="direct-messages-sidebar-state"
          >
            <span class="metro-spinner" aria-label="Loading messages"></span>
          </div>
          <div
            v-else-if="!store.conversations.length"
            class="direct-messages-sidebar-state"
          >
            <p class="font-semibold">No conversations yet</p>
            <p class="mt-1 text-sm leading-6 text-base-content/60">
              Start a private conversation with a friend.
            </p>
            <NuxtLink to="/friends" class="metro-btn metro-btn--sm mt-5">
              Find a friend
            </NuxtLink>
          </div>
          <nav v-else aria-label="Direct message conversations">
            <button
              v-for="conversation in store.conversations"
              :key="conversation.id"
              type="button"
              class="direct-message-row"
              :class="
                conversation.id === selectedConversationId &&
                'direct-message-row--active'
              "
              @click="selectConversation(conversation.id)"
            >
              <ProfileAvatar
                :src="conversation.friend?.avatar"
                :name="profileName(conversation.friend)"
                class="direct-message-row-avatar"
              />
              <span class="direct-message-row-copy">
                <span class="direct-message-row-heading">
                  <strong class="truncate">{{
                    profileName(conversation.friend)
                  }}</strong>
                  <time
                    v-if="conversation.last_message"
                    class="direct-message-row-time"
                    >{{ formatDate(conversation.last_message.created) }}</time
                  >
                </span>
                <span class="direct-message-row-preview">
                  <span class="truncate">
                    {{ conversationPreview(conversation.last_message) }}
                  </span>
                  <span
                    v-if="conversation.unread_count"
                    class="direct-message-unread"
                    >{{ conversation.unread_count }}</span
                  >
                </span>
              </span>
            </button>
          </nav>
        </div>
      </div>
    </aside>

    <section v-if="selectedConversation" class="direct-messages-thread">
      <header class="direct-messages-thread-header">
        <button
          class="metro-icon-btn md:hidden"
          type="button"
          aria-label="Back to conversations"
          @click="clearSelection"
        >
          <Icon name="lucide:chevron-left" class="size-5" />
        </button>
        <ProfileAvatar
          :src="selectedConversation.friend?.avatar"
          :name="profileName(selectedConversation.friend)"
          class="direct-messages-thread-avatar"
        />
        <div class="min-w-0">
          <h2>{{ profileName(selectedConversation.friend) }}</h2>
          <p v-if="selectedConversation.friend?.handle">
            @{{ selectedConversation.friend.handle }}
          </p>
        </div>
      </header>

      <div ref="messageList" class="direct-messages-stream" aria-live="polite">
        <div
          v-if="store.messagesLoading"
          class="grid h-full place-items-center"
        >
          <span class="metro-spinner" aria-label="Loading messages"></span>
        </div>
        <div
          v-else-if="!store.messages.length"
          class="direct-messages-stream-empty"
        >
          <p class="text-sm font-semibold text-base-content/70">
            Start a conversation
          </p>
          <p class="mt-1 text-sm text-base-content/55">
            Send a message to {{ profileName(selectedConversation.friend) }}.
          </p>
        </div>
        <div v-else class="direct-messages-stream-inner">
          <article
            v-for="message in store.messages"
            :key="message.id"
            class="direct-message"
            :class="isOwnMessage(message) && 'direct-message--own'"
          >
            <ProfileAvatar
              :src="message.sender?.avatar"
              :name="profileName(message.sender, 'User')"
              class="direct-message-avatar"
            />
            <div class="direct-message-column">
              <div class="direct-message-meta">
                <strong>{{
                  isOwnMessage(message)
                    ? "You"
                    : profileName(message.sender, "User")
                }}</strong>
                <time>{{ formatDate(message.created, true) }}</time>
                <span
                  v-if="isOwnMessage(message)"
                  class="direct-message-receipt"
                  :aria-label="messageReceiptLabel(message)"
                  :title="messageReceiptLabel(message)"
                >
                  <Icon
                    :name="
                      message.read_at
                        ? 'lucide:check-check'
                        : message.delivered_at
                          ? 'lucide:check-check'
                          : 'lucide:check'
                    "
                    class="size-3.5"
                  />
                  {{ messageReceiptLabel(message) }}
                </span>
              </div>
              <div class="direct-message-bubble">
                <InviteLinkCard
                  v-if="inviteLinkForMessage(message.content)"
                  :url="inviteLinkForMessage(message.content).url"
                />
                <ChatMarkdownRenderer v-else :content="message.content" />
              </div>
              <p
                v-if="message.status === 'failed'"
                class="mt-1 text-xs text-error"
              >
                {{ message.error || "Could not send" }}
              </p>
              <p
                v-else-if="message.status === 'pending'"
                class="mt-1 text-xs text-base-content/45"
              >
                Sending…
              </p>
            </div>
          </article>
        </div>
      </div>

      <form class="direct-messages-composer" @submit.prevent="sendMessage">
        <p v-if="store.error" class="mb-2 text-sm text-error" role="alert">
          {{ store.error }}
        </p>
        <div class="direct-messages-composer-row">
          <textarea
            v-model="draft"
            class="direct-messages-composer-input"
            maxlength="4000"
            rows="1"
            :placeholder="
              'Message ' + profileName(selectedConversation.friend, 'friend')
            "
            aria-label="Direct message"
            @keydown.enter.exact.prevent="sendMessage"
          ></textarea>
          <button
            class="metro-icon-btn metro-icon-btn--primary"
            type="submit"
            aria-label="Send message"
            title="Send message"
            :disabled="!draft.trim() || store.sending"
          >
            <span
              v-if="store.sending"
              class="metro-spinner metro-spinner--xs"
            ></span>
            <Icon v-else name="lucide:send" class="size-5" />
          </button>
        </div>
        <p class="direct-messages-composer-help">
          Press Enter to send · Shift+Enter for a new line
        </p>
      </form>
    </section>

    <section v-else class="direct-messages-empty-main hidden md:flex">
      <div class="direct-messages-empty-main-copy">
        <p class="text-sm font-semibold text-primary">Messages</p>
        <h2>Keep in touch with your friends</h2>
        <p>
          Select a conversation, or find a friend to start a private message.
        </p>
        <NuxtLink to="/friends" class="metro-btn metro-btn--sm mt-6">
          <Icon name="lucide:users" class="size-4" />
          Find friends
        </NuxtLink>
      </div>
    </section>
  </div>
</template>

<script setup>
import { useDirectMessagesStore } from "../stores/directMessages";
import ProfileAvatar from "../components/ProfileAvatar.vue";
import ChatMarkdownRenderer from "../components/Chat/MarkdownRenderer.vue";
import InviteLinkCard from "../components/Chat/InviteLinkCard.vue";
import { extractInviteLink } from "../shared/room-invite-link.js";

const store = useDirectMessagesStore();
const route = useRoute();
const router = useRouter();
const messageList = ref(null);
const draft = ref("");
const selectedConversationId = ref("");
const selectedConversation = computed(() =>
  store.conversations.find(
    (conversation) => conversation.id === selectedConversationId.value,
  ),
);

onMounted(async () => {
  await loadInbox();
  if (route.query.friendId) {
    try {
      const conversation = await store.openConversation(
        String(route.query.friendId),
      );
      await selectConversation(conversation.id);
    } catch {}
    return;
  }
  const requestedId = String(route.query.conversationId || "");
  const firstId = requestedId || store.conversations[0]?.id || "";
  if (firstId && store.conversations.some((item) => item.id === firstId))
    await selectConversation(firstId);
});

async function loadInbox() {
  try {
    await store.initialize();
  } catch {}
}

async function selectConversation(conversationId) {
  selectedConversationId.value = String(conversationId);
  draft.value = "";
  await store.fetchMessages(selectedConversationId.value);
  await router.replace({
    path: "/messages",
    query: { conversationId: selectedConversationId.value },
  });
  await nextTick();
  messageList.value?.scrollTo({ top: messageList.value.scrollHeight });
}

function clearSelection() {
  selectedConversationId.value = "";
  router.replace({ path: "/messages" });
}

async function sendMessage() {
  if (!draft.value.trim() || store.sending) return;
  const content = draft.value;
  draft.value = "";
  try {
    await store.sendMessage(content);
    await nextTick();
    messageList.value?.scrollTo({
      top: messageList.value.scrollHeight,
      behavior: "smooth",
    });
  } catch {
    draft.value = content;
  }
}

function isOwnMessage(message) {
  const currentUserId = useAuthStore().getUserData()?.id;
  return String(message.sender?.id) === String(currentUserId);
}

function profileName(profile, fallback = "Friend") {
  return profile?.display_name || profile?.name || profile?.handle || fallback;
}

function inviteLinkForMessage(content) {
  return extractInviteLink(
    content,
    import.meta.client ? window.location.origin : undefined,
  );
}

function conversationPreview(message) {
  if (!message?.content) return "Start a conversation";
  return inviteLinkForMessage(message.content)
    ? "Room invite"
    : message.content;
}

function messageReceiptLabel(message) {
  if (message.read_at) return "Read";
  if (message.delivered_at) return "Delivered";
  return "Sent";
}

function formatDate(value, includeTime = false) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    ...(includeTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(date);
}
</script>

<style scoped>
.direct-messages-shell {
  display: flex;
  width: 100%;
  height: calc(100dvh - var(--navbar-height));
  min-height: 0;
  background: var(--color-base-100);
}

.direct-messages-sidebar {
  display: flex;
  width: 17.5rem;
  min-width: 17.5rem;
  flex-direction: column;
  border-right: 1px solid var(--metro-border);
  background: var(--color-base-200);
}

.direct-messages-sidebar--hidden {
  display: none;
}

.direct-messages-sidebar-header {
  position: relative;
  display: flex;
  min-height: 10.5rem;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem;
}

.direct-messages-sidebar-heading {
  display: flex;
  width: 100%;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}

.direct-messages-sidebar-icon {
  display: grid;
  width: 5rem;
  height: 5rem;
  place-items: center;
  background: var(--color-base-300);
  color: var(--color-base-content);
}

.direct-messages-sidebar-heading h1 {
  max-width: 100%;
  overflow: hidden;
  font-size: 1.125rem;
  font-weight: 600;
  line-height: 1.2;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.direct-messages-sidebar-header > .metro-icon-btn {
  position: absolute;
  top: 1rem;
  right: 1rem;
}

.direct-messages-sidebar-body {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
}

.direct-messages-sidebar-section-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.75rem;
  color: color-mix(in oklab, var(--color-base-content) 60%, transparent);
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
}

.direct-messages-sidebar-content {
  padding: 0 0.5rem 1rem;
}

.direct-messages-sidebar-state {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 1.25rem 0.5rem;
}

.direct-message-row {
  display: flex;
  width: 100%;
  min-height: 4rem;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.5rem;
  border: 0;
  border-left: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    background-color 180ms cubic-bezier(0.1, 0.9, 0.2, 1),
    border-color 180ms cubic-bezier(0.1, 0.9, 0.2, 1);
}

.direct-message-row:hover,
.direct-message-row:focus-visible {
  background: color-mix(in oklab, var(--color-base-content) 7%, transparent);
  outline: none;
}

.direct-message-row:focus-visible {
  box-shadow: inset 0 0 0 2px var(--metro-accent);
}

.direct-message-row--active {
  background: var(--metro-accent);
  color: var(--metro-accent-content);
}

.direct-message-row--active .direct-message-row-preview,
.direct-message-row--active .direct-message-row-time {
  color: color-mix(in oklab, var(--metro-accent-content) 72%, transparent);
}

.direct-message-row-avatar {
  width: 2.75rem;
  height: 2.75rem;
  flex: none;
  border-radius: 999px;
}

.direct-message-row-copy {
  display: block;
  min-width: 0;
  flex: 1;
}

.direct-message-row-heading,
.direct-message-row-preview {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.direct-message-row-heading {
  font-size: 0.875rem;
}

.direct-message-row-preview {
  margin-top: 0.25rem;
  color: var(--metro-muted);
  font-size: 0.75rem;
}

.direct-message-row-time {
  flex: none;
  color: color-mix(in oklab, var(--color-base-content) 48%, transparent);
  font-size: 0.6875rem;
  font-weight: 400;
}

.direct-message-unread {
  display: inline-flex;
  min-width: 1.25rem;
  min-height: 1.25rem;
  align-items: center;
  justify-content: center;
  flex: none;
  background: var(--metro-accent);
  color: var(--metro-accent-content);
  font-size: 0.6875rem;
  font-weight: 600;
}

.direct-message-row--active .direct-message-unread {
  background: var(--metro-accent-content);
  color: var(--metro-accent);
}

.direct-messages-thread {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  background: var(--color-base-100);
}

.direct-messages-thread-header {
  display: flex;
  min-height: 4.5rem;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--metro-border);
  background: var(--color-base-200);
}

.direct-messages-thread-header h2 {
  overflow: hidden;
  font-size: 1rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.direct-messages-thread-header p {
  margin-top: 0.25rem;
  color: var(--metro-muted);
  font-size: 0.75rem;
}

.direct-messages-thread-avatar {
  width: 2.75rem;
  height: 2.75rem;
  flex: none;
  border-radius: 999px;
}

.direct-messages-stream {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
}

.direct-messages-stream-inner {
  display: flex;
  width: min(100%, 54rem);
  margin: 0 auto;
  flex-direction: column;
  gap: 1.25rem;
  padding: 1.5rem;
}

.direct-messages-stream-empty {
  padding: 2rem 1.5rem;
}

.direct-message {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}

.direct-message--own {
  flex-direction: row-reverse;
}

.direct-message-avatar {
  width: 2rem;
  height: 2rem;
  flex: none;
  border-radius: 999px;
}

.direct-message-column {
  display: flex;
  min-width: 0;
  max-width: min(44rem, 82%);
  flex-direction: column;
  align-items: flex-start;
}

.direct-message--own .direct-message-column {
  align-items: flex-end;
}

.direct-message-meta {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  color: var(--metro-muted);
  font-size: 0.75rem;
}

.direct-message-receipt {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  color: color-mix(in srgb, var(--color-primary) 80%, transparent);
  font-size: 0.6875rem;
  font-weight: 600;
}

.direct-message-meta strong {
  color: var(--color-base-content);
  font-weight: 600;
}

.direct-message-bubble {
  margin-top: 0.25rem;
  max-width: 100%;
  padding: 0.7rem 0.9rem;
  border: 1px solid var(--metro-border);
  background: var(--color-base-200);
  font-size: 0.875rem;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.direct-message--own .direct-message-bubble {
  border-color: var(--metro-accent);
  background: var(--metro-accent);
  color: var(--metro-accent-content);
}

.direct-messages-composer {
  padding: 1rem 1.5rem 1.25rem;
  border-top: 1px solid var(--metro-border);
  background: var(--color-base-100);
}

.direct-messages-composer-row {
  display: flex;
  align-items: flex-end;
  gap: 0.75rem;
  width: min(100%, 54rem);
  margin: 0 auto;
}

.direct-messages-composer-input {
  display: block;
  min-height: 2.75rem;
  max-height: 9rem;
  min-width: 0;
  flex: 1;
  resize: vertical;
  padding: 0.75rem;
  border: 1px solid var(--metro-border);
  outline: none;
  background: var(--color-base-200);
  color: var(--color-base-content);
  font: inherit;
  font-size: 0.875rem;
  line-height: 1.4;
}

.direct-messages-composer-input:focus {
  border-color: var(--metro-accent);
  box-shadow: 0 0 0 1px var(--metro-accent);
}

.direct-messages-composer-help {
  width: min(100%, 54rem);
  margin: 0.5rem auto 0;
  color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
  font-size: 0.6875rem;
}

.direct-messages-empty-main {
  min-width: 0;
  flex: 1;
  align-items: flex-start;
  padding: clamp(3rem, 8vw, 7rem);
  background: var(--color-base-100);
}

.direct-messages-empty-main-copy {
  max-width: 30rem;
  padding-left: 1.5rem;
  border-left: 3px solid var(--metro-accent);
}

.direct-messages-empty-main-copy h2 {
  margin-top: 0.5rem;
  font-size: clamp(1.5rem, 3vw, 2.25rem);
  font-weight: 300;
  line-height: 1.15;
}

.direct-messages-empty-main-copy p:not(:first-child) {
  margin-top: 0.75rem;
  max-width: 42ch;
  color: var(--metro-muted);
  line-height: 1.5;
}

@media (max-width: 767px) {
  .direct-messages-sidebar {
    width: 100%;
    min-width: 0;
    border-right: 0;
  }

  .direct-messages-thread-header {
    padding: 0 1rem;
  }

  .direct-messages-stream-inner {
    padding: 1rem;
  }

  .direct-messages-composer {
    padding: 0.75rem 1rem 1rem;
  }
}

@media (min-width: 768px) {
  .direct-messages-sidebar--hidden {
    display: flex;
  }
}
</style>
