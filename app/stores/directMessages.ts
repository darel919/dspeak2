import { defineStore } from "pinia";
import { useRuntimeConfig } from "#app";
import { useAuthStore } from "./auth";
import { apiErrorMessage } from "../shared/api-errors.ts";
import { deviceHeaders } from "../shared/device-identity";
import { openRealtimeChannel } from "../shared/realtime-channel.ts";
import type {
  DirectConversation,
  DirectMessage,
  DirectMessageApiResponse,
  DirectMessageFetchOptions,
  DirectMessageRealtimePayload,
  DirectMessageSender,
} from "../shared/types/direct-messages.ts";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export const useDirectMessagesStore = defineStore("directMessages", () => {
  const conversations = ref<DirectConversation[]>([]);
  const messages = ref<DirectMessage[]>([]);
  const currentConversationId = ref("");
  const loading = ref(false);
  const messagesLoading = ref(false);
  const sending = ref(false);
  const error = ref("");
  const config = useRuntimeConfig();
  let initializedUserId = "";
  let realtimeHandle: Awaited<
    ReturnType<typeof openRealtimeChannel<DirectMessageRealtimePayload>>
  > = null;
  let initialization: Promise<DirectConversation[]> | null = null;
  let stopAuthWatcher: (() => void) | null = null;

  const unreadCount = computed(() =>
    conversations.value.reduce(
      (total, conversation) => total + Number(conversation.unread_count || 0),
      0,
    ),
  );

  function endpoint(path = "") {
    return `${config.public.apiPath}/direct-messages${path}`;
  }

  async function apiFetch(
    path = "",
    options: DirectMessageFetchOptions = {},
  ): Promise<DirectMessageApiResponse> {
    const userId = useAuthStore().getUserData()?.id;
    if (!userId) throw new Error("Not authenticated");
    const response = await fetch(endpoint(path), {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...deviceHeaders(),
        ...options.headers,
      },
      ...options,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        apiErrorMessage(text, response.status, "Direct message request failed"),
      );
    }
    return (await response.json()) as DirectMessageApiResponse;
  }

  function currentUser(): DirectMessageSender {
    const user = useAuthStore().getUserData();
    return {
      id: String(user?.id || ""),
      name: String(user?.display_name || user?.name || user?.username || "You"),
      display_name: String(user?.display_name || ""),
      handle: String(user?.username || ""),
      avatar: String(user?.avatar || ""),
    };
  }

  function reconcileMessage(serverMessage: DirectMessage) {
    const pendingIndex = messages.value.findIndex(
      (message) =>
        message.id === `pending_${serverMessage.client_id}` ||
        (message.status === "pending" &&
          message.client_id === serverMessage.client_id),
    );
    if (pendingIndex >= 0) {
      const pending = messages.value[pendingIndex];
      if (!pending) return serverMessage;
      Object.assign(pending, serverMessage);
      delete pending.status;
      delete pending.error;
      for (let index = messages.value.length - 1; index >= 0; index -= 1) {
        const candidate = messages.value[index];
        if (index !== pendingIndex && candidate?.id === serverMessage.id)
          messages.value.splice(index, 1);
      }
      return pending;
    }
    const existing = messages.value.find(
      (message) => message.id === serverMessage.id,
    );
    if (existing) Object.assign(existing, serverMessage);
    else messages.value.push(serverMessage);
    return existing || serverMessage;
  }

  function updateConversationSummary(
    conversationId: string,
    message: DirectMessage,
    unread: number | null = null,
  ) {
    const index = conversations.value.findIndex(
      (conversation) => conversation.id === String(conversationId),
    );
    if (index < 0) return false;
    const conversation = conversations.value[index];
    if (!conversation) return false;
    conversation.last_message = message;
    conversation.updated_at = message.created;
    if (unread !== null) conversation.unread_count = unread;
    conversations.value.splice(index, 1);
    conversations.value.unshift(conversation);
    return true;
  }

  function applyReceipt(
    conversationId: string | undefined,
    messageIds: unknown,
    field: "delivered_at" | "read_at",
    value: string | null | undefined,
  ) {
    if (String(conversationId) !== currentConversationId.value) return;
    const ids = new Set(
      (Array.isArray(messageIds) ? messageIds : []).map(String),
    );
    for (const message of messages.value) {
      if (ids.has(String(message.id))) message[field] = value;
    }
  }

  async function fetchConversations() {
    loading.value = true;
    error.value = "";
    try {
      const result = await apiFetch();
      conversations.value = Array.isArray(result.items)
        ? (result.items as DirectConversation[])
        : [];
      return conversations.value;
    } catch (cause: unknown) {
      error.value = errorMessage(cause);
      throw cause;
    } finally {
      loading.value = false;
    }
  }

  async function connectRealtime(userId: string) {
    if (!import.meta.client || !userId || realtimeHandle) return;
    realtimeHandle = await openRealtimeChannel<DirectMessageRealtimePayload>(
      `notify:${userId}`,
      {
        onMessage: (message) => {
          if (message?.type === "direct_messages_delivered") {
            applyReceipt(
              message.data?.conversation_id,
              message.data?.message_ids,
              "delivered_at",
              message.data?.delivered_at,
            );
            return;
          }
          if (message?.type === "direct_messages_read") {
            applyReceipt(
              message.data?.conversation_id,
              message.data?.message_ids,
              "read_at",
              message.data?.read_at,
            );
            return;
          }
          if (message?.type !== "direct_message" || !message.data?.message)
            return;
          const conversationId = String(message.data.conversation_id || "");
          const directMessage = message.data.message;
          if (!directMessage) return;
          const ownMessage =
            String(directMessage.sender?.id) === String(userId);
          if (conversationId === currentConversationId.value) {
            reconcileMessage(directMessage);
            if (!ownMessage)
              apiFetch(`/${encodeURIComponent(conversationId)}`, {
                method: "PATCH",
                body: JSON.stringify({
                  action: "read",
                }),
              }).catch(() => {});
          } else if (!ownMessage)
            apiFetch(`/${encodeURIComponent(conversationId)}`, {
              method: "PATCH",
              body: JSON.stringify({
                action: "delivered",
                messageIds: [directMessage.id],
              }),
            }).catch(() => {});
          const conversation = conversations.value.find(
            (item) => item.id === conversationId,
          );
          const unreadCount =
            ownMessage || conversationId === currentConversationId.value
              ? null
              : Number(conversation?.unread_count || 0) + 1;
          if (
            !updateConversationSummary(
              conversationId,
              directMessage,
              unreadCount,
            )
          )
            fetchConversations().catch(() => {});
        },
        onError: () => {
          realtimeHandle = null;
        },
      },
    );
  }

  async function initialize() {
    if (!import.meta.client) return;
    watchForAuthenticatedUser();
    const userId = String(useAuthStore().getUserData()?.id || "");
    if (!userId) return;
    if (initializedUserId === userId && initialization) return initialization;
    if (realtimeHandle) {
      realtimeHandle.close();
      realtimeHandle = null;
    }
    initializedUserId = userId;
    initialization = Promise.all([
      fetchConversations(),
      connectRealtime(userId),
    ]).then(() => conversations.value);
    try {
      return await initialization;
    } catch (cause: unknown) {
      initialization = null;
      throw cause;
    }
  }

  function watchForAuthenticatedUser() {
    if (!import.meta.client || stopAuthWatcher) return;
    const authStore = useAuthStore();
    stopAuthWatcher = watch(
      () => authStore.getUserData()?.id,
      (userId) => {
        if (userId) void initialize();
        else clear();
      },
    );
  }

  async function openConversation(friendId: string) {
    const result = await apiFetch("", {
      method: "POST",
      body: JSON.stringify({ friendId }),
    });
    const conversation = result as DirectConversation;
    const existing = conversations.value.find(
      (item) => item.id === conversation.id,
    );
    if (existing) {
      existing.friend = conversation.friend;
      existing.unread_count = 0;
    } else {
      conversations.value.unshift(conversation);
    }
    currentConversationId.value = conversation.id;
    return conversation;
  }

  async function fetchMessages(conversationId: string) {
    if (!conversationId) return [];
    currentConversationId.value = String(conversationId);
    messagesLoading.value = true;
    error.value = "";
    try {
      const result = await apiFetch(`/${encodeURIComponent(conversationId)}`);
      messages.value = Array.isArray(result.items)
        ? (result.items as DirectMessage[])
        : [];
      const conversation = conversations.value.find(
        (item) => item.id === String(conversationId),
      );
      if (conversation) conversation.unread_count = 0;
      return messages.value;
    } catch (cause: unknown) {
      error.value = errorMessage(cause);
      throw cause;
    } finally {
      messagesLoading.value = false;
    }
  }

  async function sendMessage(content: string) {
    const normalizedContent = String(content || "").trim();
    if (!currentConversationId.value || !normalizedContent) return null;
    const clientMessageId =
      typeof crypto?.randomUUID === "function"
        ? crypto.randomUUID()
        : `dm_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const pending: DirectMessage = {
      id: `pending_${clientMessageId}`,
      conversation_id: currentConversationId.value,
      content: normalizedContent,
      sender: currentUser(),
      created: new Date().toISOString(),
      client_id: clientMessageId,
      read_at: null,
      delivered_at: null,
      status: "pending",
    };
    messages.value.push(pending);
    sending.value = true;
    try {
      const result = await apiFetch(
        `/${encodeURIComponent(currentConversationId.value)}`,
        {
          method: "POST",
          body: JSON.stringify({
            content: normalizedContent,
            clientMessageId,
          }),
        },
      );
      const message = result as DirectMessage;
      reconcileMessage(message);
      updateConversationSummary(currentConversationId.value, message, null);
      return result;
    } catch (cause: unknown) {
      pending.status = "failed";
      pending.error = errorMessage(cause);
      throw cause;
    } finally {
      sending.value = false;
    }
  }

  async function markRead(conversationId: string) {
    if (!conversationId) return;
    await apiFetch(`/${encodeURIComponent(conversationId)}`, {
      method: "PATCH",
      body: JSON.stringify({}),
    });
    const conversation = conversations.value.find(
      (item) => item.id === String(conversationId),
    );
    if (conversation) conversation.unread_count = 0;
  }

  function clear() {
    realtimeHandle?.close();
    realtimeHandle = null;
    initializedUserId = "";
    initialization = null;
    conversations.value = [];
    messages.value = [];
    currentConversationId.value = "";
    error.value = "";
  }

  onScopeDispose(() => {
    stopAuthWatcher?.();
    stopAuthWatcher = null;
  });

  return {
    conversations,
    messages,
    currentConversationId,
    loading,
    messagesLoading,
    sending,
    error,
    unreadCount,
    initialize,
    fetchConversations,
    openConversation,
    fetchMessages,
    sendMessage,
    markRead,
    clear,
  };
});
