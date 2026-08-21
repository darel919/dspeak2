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
import { isExternalString } from "../shared/types/boundary.ts";
import type { ExternalField } from "~~/shared/types/external.ts";
import {
  parseExternalNumber,
  parseExternalRecord,
  parseExternalValue,
} from "../utils/external-values.ts";

function errorMessage(error: ExternalField) {
  return error instanceof Error ? error.message : String(error);
}

type ParsedDirectItem = DirectMessage | DirectConversation;
type ParsedDirectApiResponse = Omit<
  DirectMessageApiResponse,
  "items" | "nextBefore"
> & {
  items?: ParsedDirectItem[];
  nextBefore?: { created: string; id: string } | null;
};
type ParsedUnreadCount = number;

function requiredId(value: ExternalField): string | null {
  return isExternalString(value) && value.trim() ? value : null;
}

function parseDirectSender(value: ExternalField): DirectMessageSender | null {
  const record = parseExternalRecord(value);
  const id = requiredId(record?.id);
  if (!record || !id) return null;
  const sender: DirectMessageSender = { id };
  if (isExternalString(record.name)) sender.name = record.name;
  if (isExternalString(record.display_name))
    sender.display_name = record.display_name;
  if (isExternalString(record.username)) sender.username = record.username;
  if (isExternalString(record.avatar)) sender.avatar = record.avatar;
  return sender;
}

function parseDirectMessage(value: ExternalField): DirectMessage | null {
  const record = parseExternalRecord(value);
  if (!record) return null;
  const id = requiredId(record.id);
  const conversationId = requiredId(record.conversation_id);
  const content = isExternalString(record.content) ? record.content : null;
  const sender = parseDirectSender(record.sender);
  const created = requiredId(record.created);
  if (!id || !conversationId || content === null || !sender || !created)
    return null;
  const message: DirectMessage = {
    id,
    conversation_id: conversationId,
    content,
    sender,
    created,
  };
  if (isExternalString(record.client_id)) message.client_id = record.client_id;
  if (record.read_at === null || isExternalString(record.read_at))
    message.read_at = record.read_at;
  if (record.delivered_at === null || isExternalString(record.delivered_at))
    message.delivered_at = record.delivered_at;
  if (record.status === "pending" || record.status === "failed")
    message.status = record.status;
  if (isExternalString(record.error)) message.error = record.error;
  return message;
}

function parseDirectMessageRealtime(
  value: ExternalField,
): DirectMessageRealtimePayload | null {
  const record = parseExternalRecord(value);
  if (!record) return null;
  const dataRecord = parseExternalRecord(record.data);
  if (!dataRecord) {
    return {
      type: isExternalString(record.type) ? record.type : undefined,
    };
  }
  const data: NonNullable<DirectMessageRealtimePayload["data"]> = {};
  const conversationId = requiredId(dataRecord.conversation_id);
  if (conversationId) data.conversation_id = conversationId;
  if (Array.isArray(dataRecord.message_ids))
    data.message_ids = dataRecord.message_ids;
  if (
    isExternalString(dataRecord.delivered_at) ||
    dataRecord.delivered_at === null
  )
    data.delivered_at = dataRecord.delivered_at;
  if (isExternalString(dataRecord.read_at) || dataRecord.read_at === null)
    data.read_at = dataRecord.read_at;
  const message = parseDirectMessage(dataRecord.message);
  if (message) data.message = message;
  return {
    type: isExternalString(record.type) ? record.type : undefined,
    data,
  };
}

function parseUnreadCount(value: ExternalField): ParsedUnreadCount | null {
  const number = parseExternalNumber(parseExternalValue(value));
  if (number === null || !Number.isInteger(number) || number < 0) return null;
  return number;
}

function parseDirectConversation(
  value: ExternalField,
): DirectConversation | null {
  const record = parseExternalRecord(value);
  const id = requiredId(record?.id);
  const unreadCount = parseUnreadCount(record?.unread_count);
  if (!record || !id || unreadCount === null) return null;
  const conversation: DirectConversation = {
    id,
    unread_count: unreadCount,
  };
  const friend = parseExternalRecord(record.friend);
  if (friend) conversation.friend = friend;
  const lastMessage = parseDirectMessage(record.last_message);
  if (lastMessage) conversation.last_message = lastMessage;
  if (isExternalString(record.updated_at))
    conversation.updated_at = record.updated_at;
  return conversation;
}

function parseDirectApiResponse(value: ExternalField): ParsedDirectApiResponse {
  const record = parseExternalRecord(value);
  if (!record) return {};
  const result: ParsedDirectApiResponse = {};
  if (Array.isArray(record.items)) {
    result.items = record.items
      .map((item) => parseDirectMessage(item) || parseDirectConversation(item))
      .filter((item): item is ParsedDirectItem => item !== null);
  }
  if (isExternalString(record.id)) result.id = record.id;
  const friend = parseExternalRecord(record.friend);
  if (friend) result.friend = friend;
  if (record.hasMore === true || record.hasMore === false)
    result.hasMore = record.hasMore;
  const nextBefore = parseExternalRecord(record.nextBefore);
  const nextBeforeId = requiredId(nextBefore?.id);
  const nextBeforeCreated = requiredId(nextBefore?.created);
  if (nextBeforeId && nextBeforeCreated)
    result.nextBefore = { id: nextBeforeId, created: nextBeforeCreated };
  return result;
}

function isDirectMessage(item: ParsedDirectItem): item is DirectMessage {
  return "content" in item;
}

function isDirectConversation(
  item: ParsedDirectItem,
): item is DirectConversation {
  return "unread_count" in item && !isDirectMessage(item);
}

function parseReceiptIds(value: ExternalField): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const id = requiredId(entry);
    return id ? [id] : [];
  });
}

const MAX_LOADED_MESSAGES = 500;

export const useDirectMessagesStore = defineStore("directMessages", () => {
  const conversations = ref<DirectConversation[]>([]);
  const messages = ref<DirectMessage[]>([]);
  const currentConversationId = ref("");
  const loading = ref(false);
  const messagesLoading = ref(false);
  const loadingOlderMessages = ref(false);
  const hasMoreMessages = ref(false);
  const sending = ref(false);
  const error = ref("");
  const config = useRuntimeConfig();
  let initializedUserId = "";
  let realtimeHandle: Awaited<
    ReturnType<typeof openRealtimeChannel<DirectMessageRealtimePayload>>
  > = null;
  let initialization: Promise<DirectConversation[]> | null = null;
  let stopAuthWatcher: (() => void) | null = null;
  let messageHistoryCursor: { created: string; id: string } | null = null;

  const unreadCount = computed(() =>
    conversations.value.reduce(
      (total, conversation) => total + conversation.unread_count,
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
    return parseDirectApiResponse(await response.json());
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
      trimMessages();
      return pending;
    }
    const existing = messages.value.find(
      (message) => message.id === serverMessage.id,
    );
    if (existing) Object.assign(existing, serverMessage);
    else messages.value.push(serverMessage);
    trimMessages();
    return existing || serverMessage;
  }

  function trimMessages() {
    if (messages.value.length <= MAX_LOADED_MESSAGES) return;
    messages.value.splice(0, messages.value.length - MAX_LOADED_MESSAGES);
    const oldest = messages.value[0];
    if (oldest) {
      messageHistoryCursor = {
        created: oldest.created,
        id: String(oldest.id),
      };
      hasMoreMessages.value = true;
    }
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
    messageIds: ExternalField,
    field: "delivered_at" | "read_at",
    value: string | null | undefined,
  ) {
    if (String(conversationId) !== currentConversationId.value) return;
    const ids = new Set(parseReceiptIds(messageIds));
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
        ? result.items.filter(isDirectConversation)
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
        decodePayload: parseDirectMessageRealtime,
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
          const directMessage = parseDirectMessage(message.data.message);
          if (!directMessage) return;
          const conversationId =
            requiredId(message.data.conversation_id) ||
            directMessage.conversation_id;
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
              : (conversation?.unread_count ?? 0) + 1;
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
    const conversation = parseDirectConversation(result);
    if (!conversation) throw new Error("Invalid direct conversation response");
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
    messageHistoryCursor = null;
    hasMoreMessages.value = false;
    messagesLoading.value = true;
    error.value = "";
    try {
      const result = await apiFetch(`/${encodeURIComponent(conversationId)}`);
      messages.value = Array.isArray(result.items)
        ? result.items.filter(isDirectMessage)
        : [];
      hasMoreMessages.value = result.hasMore === true;
      messageHistoryCursor =
        result.nextBefore?.created && result.nextBefore.id
          ? {
              created: String(result.nextBefore.created),
              id: String(result.nextBefore.id),
            }
          : null;
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

  async function fetchOlderMessages() {
    const conversationId = currentConversationId.value;
    const cursor = messageHistoryCursor;
    if (
      !conversationId ||
      !cursor ||
      !hasMoreMessages.value ||
      loadingOlderMessages.value
    )
      return messages.value;
    loadingOlderMessages.value = true;
    error.value = "";
    try {
      const result = await apiFetch(
        `/${encodeURIComponent(conversationId)}?before=${encodeURIComponent(cursor.created)}&beforeId=${encodeURIComponent(cursor.id)}`,
      );
      const older = Array.isArray(result.items)
        ? result.items.filter(isDirectMessage)
        : [];
      const existingIds = new Set(messages.value.map((message) => message.id));
      messages.value = [
        ...older.filter((message) => !existingIds.has(message.id)),
        ...messages.value,
      ];
      hasMoreMessages.value = result.hasMore === true;
      messageHistoryCursor =
        result.nextBefore?.created && result.nextBefore.id
          ? {
              created: String(result.nextBefore.created),
              id: String(result.nextBefore.id),
            }
          : null;
      trimMessages();
      return messages.value;
    } catch (cause: unknown) {
      error.value = errorMessage(cause);
      throw cause;
    } finally {
      loadingOlderMessages.value = false;
    }
  }

  async function sendMessage(content: string) {
    const normalizedContent = String(content || "").trim();
    if (!currentConversationId.value || !normalizedContent) return null;
    const clientMessageId =
      crypto?.randomUUID instanceof Function
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
    trimMessages();
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
      const message = parseDirectMessage(result);
      if (!message) throw new Error("Invalid direct message response");
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
    loadingOlderMessages.value = false;
    hasMoreMessages.value = false;
    messageHistoryCursor = null;
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
    loadingOlderMessages,
    hasMoreMessages,
    sending,
    error,
    unreadCount,
    initialize,
    fetchConversations,
    openConversation,
    fetchMessages,
    fetchOlderMessages,
    sendMessage,
    markRead,
    clear,
  };
});
