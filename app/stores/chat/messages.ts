import type {
  ChatDeliveryError,
  ChatMessage,
  ChatSendOptions,
  ChatStoreContext,
} from "../../shared/types/chat-store.ts";
import { isExternalString } from "../../shared/types/boundary.ts";
import type { ExternalValue } from "../../shared/types/boundary.ts";
import type { ExternalField } from "~~/shared/types/external.ts";
import {
  parseExternalNumber,
  parseExternalRecord,
  parseExternalValue,
} from "../../utils/external-values.ts";
import type { ReaderValue } from "../../shared/types/shared-utilities.ts";

type OnlineUser = { id: string; [key: string]: unknown };

type ChatSender = NonNullable<ChatMessage["sender"]>;
type ChatTimestamp = NonNullable<ChatMessage["created"]>;
type ChatSendResult =
  | ChatMessage
  | { status: "queued-offline"; id: string }
  | { status: "queued-error"; error: string };

function parseChatSender(value: ExternalField): ChatSender | undefined {
  const record = parseExternalRecord(value);
  if (!record || !isExternalString(record.id) || !record.id.trim())
    return undefined;
  const sender: ChatSender = { id: record.id };
  if (isExternalString(record.name)) sender.name = record.name;
  if (isExternalString(record.email)) sender.email = record.email;
  return sender;
}

function parseChatTimestamp(value: ExternalField): ChatTimestamp | undefined {
  if (isExternalString(value)) return value;
  const number = parseExternalNumber(parseExternalValue(value));
  if (number !== null) return number;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  return undefined;
}

function parseChatReader(value: ExternalField): ReaderValue | undefined {
  if (value === null) return null;
  if (isExternalString(value)) return value;
  const record = parseExternalRecord(value);
  if (!record) return undefined;
  if (!Object.prototype.hasOwnProperty.call(record, "id")) return {};
  const id = record.id;
  if (id === null) return { id: null };
  if (isExternalString(id)) return { id };
  const number = parseExternalNumber(parseExternalValue(id));
  return number === null ? undefined : { id: number };
}

function parseChatReplyTarget(
  value: ExternalField,
): string | { id: string | number } | null | undefined {
  if (value === null) return null;
  if (isExternalString(value)) return value.trim() ? value : undefined;
  const record = parseExternalRecord(value);
  if (!record) return undefined;
  if (isExternalString(record.id) && record.id.trim()) return { id: record.id };
  const id = parseExternalNumber(parseExternalValue(record.id));
  return id === null ? undefined : { id };
}

function parseChatMessage(value: ExternalField): ChatMessage | null {
  const record = parseExternalRecord(value);
  if (!record || !isExternalString(record.id) || !record.id.trim()) return null;
  if (!isExternalString(record.content)) return null;
  const message: ChatMessage = {
    id: record.id,
    content: record.content,
  };
  const sender = parseChatSender(record.sender);
  if (sender) message.sender = sender;
  const roomChannel = record.room_channel;
  if (isExternalString(roomChannel)) message.room_channel = roomChannel;
  if (isExternalString(record.channelId)) message.channelId = record.channelId;
  const created = parseChatTimestamp(record.created);
  if (created !== undefined) message.created = created;
  const updated = parseChatTimestamp(record.updated);
  if (updated !== undefined) message.updated = updated;
  if (isExternalString(record.client_id)) message.client_id = record.client_id;
  if (isExternalString(record.status)) message.status = record.status;
  if (isExternalString(record.error)) message.error = record.error;
  if (record.pinned === true || record.pinned === false)
    message.pinned = record.pinned;
  if (record.deleted === true || record.deleted === false)
    message.deleted = record.deleted;
  if (Array.isArray(record.attachments))
    message.attachments = record.attachments.map((entry) =>
      parseExternalValue(entry),
    );
  const replyTo = parseChatReplyTarget(record.reply_to);
  if (replyTo !== undefined) message.reply_to = replyTo;
  if (Array.isArray(record.read_by)) {
    message.read_by = record.read_by
      .map(parseChatReader)
      .filter((reader): reader is ReaderValue => reader !== undefined);
  }
  return message;
}

function parseOnlineUser(value: ExternalValue): OnlineUser | null {
  if (isExternalString(value) && value.trim()) return { id: value };
  const record = parseExternalRecord(value);
  if (!record || !isExternalString(record.id)) return null;
  if (!record.id.trim()) return null;
  return { ...record, id: record.id };
}

export function createChatMessageActions(context: ChatStoreContext) {
  const { error } = context;
  async function handleWebSocketMessage(event: {
    data: unknown;
  }): Promise<void> {
    try {
      const parsed = JSON.parse(String(event.data));
      const data = parseExternalRecord(parsed);
      if (!data) return;
      switch (data.type) {
        case "connected":
          break;
        case "new_message": {
          const message = parseChatMessage(data.data);
          if (
            message &&
            context.dependencies.reconcileIncomingMessage(
              context.messages.value,
              message,
            ).inserted
          ) {
            context.messages.value = context.boundedMessages(
              context.messages.value,
              context.ACTIVE_CHANNEL_MESSAGE_LIMIT,
            );
            context.setChannelMessages(
              context.currentChannelId.value,
              context.messages.value,
              true,
            );
            context.handleNewMessageNotification(message);
          }
          break;
        }
        case "message_updated":
          context.dependencies.debugLog(
            "[ChatStore] Message updated:",
            data.data,
          );
          {
            const message = parseChatMessage(data.data);
            if (message) context.updateMessage(message);
          }
          break;
        case "message_deleted":
          context.dependencies.debugLog(
            "[ChatStore] Message deleted:",
            data.data,
          );
          {
            const eventData = parseExternalRecord(data.data);
            if (isExternalString(eventData?.id))
              context.removeMessage(eventData.id);
          }
          break;
        case "channel_updated":
          context.dependencies.debugLog(
            "[ChatStore] Channel updated:",
            data.data,
          );
          break;
        case "channel_deleted":
          context.dependencies.debugLog(
            "[ChatStore] Channel deleted:",
            data.data,
          );
          context.disconnectFromChannel(true);
          break;
        case "user_typing":
          context.dependencies.debugLog(
            "[ChatStore] User typing status:",
            data.data,
          );
          {
            const eventData = parseExternalRecord(data.data);
            const userId = isExternalString(eventData?.userId)
              ? eventData.userId
              : undefined;
            if (userId)
              context.updateTypingStatus(userId, eventData?.isTyping === true);
          }
          break;
        case "pong":
          break;
        case "currentlyInChannel":
        case "currentlyInRoom":
          context.dependencies.debugLog(
            "[ChatStore] Received online users update:",
            data.inRoom,
          );
          if (Array.isArray(data.inRoom)) {
            context.onlineUsers.value = data.inRoom
              .map(parseExternalValue)
              .map(parseOnlineUser)
              .filter((user): user is OnlineUser => user !== null);
            context.dependencies.debugLog(
              "[ChatStore] Updated onlineUsers:",
              context.onlineUsers.value,
            );
          }
          break;
        case "user_joined":
        case "user_left":
          context.dependencies.debugLog(
            "[ChatStore] User presence change:",
            data.type,
            data,
          );
          break;
        case "participant_change":
          context.dependencies.debugLog(
            "[ChatStore] Participant change detected:",
            data,
          );
          await context.handleParticipantChange();
          break;
        case "message_reaction_added":
        case "message_reaction_removed":
          context.dependencies.debugLog(
            "[ChatStore] Reaction event:",
            data.type,
            data.data,
          );
          const eventData = parseExternalRecord(data.data);
          const messageId = isExternalString(eventData?.messageId)
            ? eventData.messageId
            : undefined;
          context.reactionChanged.value = {
            messageId,
            type: data.type,
            ts: Date.now(),
          };
          break;
        case "message_pinned":
        case "message_unpinned":
          {
            const eventData = parseExternalRecord(data.data);
            const messageId = isExternalString(eventData?.messageId)
              ? eventData.messageId
              : undefined;
            if (!messageId) break;
            context.updateMessage({
              id: messageId,
              content: "",
              pinned: data.type === "message_pinned",
            });
            context.pinChanged.value = {
              messageId,
              channelId: isExternalString(eventData?.channelId)
                ? eventData.channelId
                : undefined,
              pinned: data.type === "message_pinned",
              ts: Date.now(),
            };
          }
          break;
        case "channel_policy_updated":
          {
            const eventData = parseExternalRecord(data.data);
            const policyChannelId = isExternalString(eventData?.channelId)
              ? eventData.channelId
              : undefined;
            if (policyChannelId) {
              context.dependencies
                .useChannelsStore()
                .applyRealtimePolicy(policyChannelId, eventData ?? {});
            }
          }
          break;
        case "notification_created":
        case "notifications_read":
          context.dependencies.useNotificationsStore().receiveRealtime({
            type: data.type,
            data: parseExternalRecord(data.data) ?? undefined,
          });
          break;
        default:
          context.dependencies.debugLog(
            "[ChatStore] Unknown message type:",
            data.type,
          );
      }
    } catch (err: unknown) {
      console.error(
        "[ChatStore] Error parsing WebSocket message:",
        err,
        event.data,
      );
    }
  }

  async function handleParticipantChange() {
    try {
      context.dependencies.debugLog(
        "[ChatStore] Handling participant change - refreshing room data",
      );

      if (context.currentRoomId.value) {
        const roomsStore = context.dependencies.useRoomsStore();

        await roomsStore.fetchRooms();
        context.dependencies.debugLog(
          "[ChatStore] Room data refreshed after participant change",
        );
      } else {
        context.dependencies.debugLog(
          "[ChatStore] No current room ID, skipping room refresh",
        );
      }
    } catch (error) {
      console.error("[ChatStore] Error handling participant change:", error);
    }
  }

  async function sendMessage(
    channelId: string,
    content: string,
    options: ChatSendOptions = {},
  ): Promise<ChatSendResult> {
    const { attachments = [], replyTo = null } = options;
    const channelsStore = context.dependencies.useChannelsStore();
    const { canSend, slowModeSeconds } =
      channelsStore.getChannelSendPermission(channelId);

    if (!canSend) {
      throw new Error(
        "You do not have permission to send messages in this channel",
      );
    }

    if (Number(slowModeSeconds) > 0 && context.connected.value) {
      const lastMessageFromUser = context.messages.value
        .filter((m) => {
          const senderId = m.sender?.id;
          const auth = context.dependencies.useAuthStore();
          return String(senderId) === String(auth.getUserData()?.id);
        })
        .pop();
      const lastMsgAt = lastMessageFromUser?.created
        ? new Date(lastMessageFromUser.created).getTime()
        : 0;
      if (
        context.dependencies.isSlowModeCooldownActive(
          lastMsgAt,
          slowModeSeconds,
        )
      ) {
        const remaining = Math.ceil(
          context.dependencies.slowModeRemainingMs(lastMsgAt, slowModeSeconds) /
            1000,
        );
        throw new Error(
          `Slow mode enabled. Please wait ${remaining} seconds before sending another message.`,
        );
      }
    }

    let pendingMessage: ChatMessage | null = null;
    try {
      const authStore = context.dependencies.useAuthStore();
      const userData = authStore.getUserData();
      if (!userData || !userData.id) {
        throw new Error("User not authenticated");
      }

      const clientMessageId = crypto.randomUUID();
      const pendingId = `pending_${clientMessageId}`;
      const created = new Date().toISOString();
      pendingMessage = {
        id: pendingId,
        content,
        room_channel: channelId,
        sender: {
          id: String(userData.id),
          name: isExternalString(userData.name) ? userData.name : "You",
          email: isExternalString(userData.email) ? userData.email : undefined,
        },
        created,
        updated: created,
        read_by: [String(userData.id)],
        client_id: clientMessageId,
        attachments,
        reply_to: replyTo,
        status: "pending",
      };
      const pendingMessageId = pendingMessage.id;

      context.messages.value.push(pendingMessage);
      context.messages.value = context.boundedMessages(
        context.messages.value,
        context.ACTIVE_CHANNEL_MESSAGE_LIMIT,
      );
      context.setChannelMessages(channelId, context.messages.value, true);
      context.dependencies
        .cacheChannelMessages(userData.id, channelId, context.messages.value)
        .catch((cacheError) => {
          console.warn(
            "[ChatStore] Unable to persist pending message:",
            cacheError,
          );
        });

      if (!navigator.onLine) {
        const queuedMessage = {
          id: clientMessageId,
          channelId,
          content,
          ownerId: userData.id,
          pendingId: pendingMessageId,
          attachments,
          replyTo,
        };
        await context.dependencies.enqueueMessage(queuedMessage);
        context.requestBackgroundSync();
        return { status: "queued-offline", id: queuedMessage.id };
      }

      try {
        const apiPath = context.config.public.apiPath;
        const messageBody =
          replyTo != null
            ? {
                channelId,
                content,
                clientMessageId,
                ownerId: userData.id,
                ...(attachments.length > 0 && { attachments }),
                replyTo,
              }
            : {
                channelId,
                content,
                clientMessageId,
                ownerId: userData.id,
                ...(attachments.length > 0 && { attachments }),
              };
        const response = await fetch(`${apiPath}/chat/message`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(messageBody),
        });

        if (!response.ok) {
          const deliveryError = await context.chatResponseError(response);
          deliveryError.retryable =
            response.status === 408 || response.status >= 500;
          throw deliveryError;
        }

        const message = parseChatMessage(await response.json());
        if (!message) throw new Error("Invalid chat message response");

        context.dependencies.reconcileSentMessage(
          context.messages.value,
          pendingMessageId,
          message,
        );

        return message;
      } catch (fetchError: unknown) {
        const retryableValue =
          fetchError instanceof Error
            ? Object.entries(fetchError).find(
                ([key]) => key === "retryable",
              )?.[1]
            : undefined;
        const deliveryError: ChatDeliveryError = Object.assign(
          fetchError instanceof Error
            ? fetchError
            : new Error(String(fetchError)),
          {
            retryable:
              retryableValue === true
                ? true
                : retryableValue === false
                  ? false
                  : undefined,
          },
        );
        if (deliveryError.retryable === false) {
          context.removeMessage(pendingMessageId, clientMessageId);
          throw fetchError;
        }
        const queuedMessage = {
          id: clientMessageId,
          channelId,
          content,
          ownerId: userData.id,
          pendingId: pendingMessageId,
          attachments,
          replyTo,
        };
        await context.dependencies.enqueueMessage(queuedMessage);
        context.requestBackgroundSync();
        return { status: "queued-error", error: deliveryError.message };
      }
    } catch (err: unknown) {
      if (
        pendingMessage &&
        err instanceof context.dependencies.IdbOperationError
      ) {
        pendingMessage.status = "failed";
        pendingMessage.error = err.message;
      } else {
        error.value = err instanceof Error ? err.message : String(err);
      }
      console.error("[ChatStore] Error sending message:", err);
      throw err;
    }
  }

  function updateMessageReadBy(
    messageId: string,
    readBy: string[] | undefined,
  ): void {
    const messageIndex = context.messages.value.findIndex(
      (msg) => msg.id === messageId,
    );
    if (messageIndex !== -1) {
      const message = context.messages.value[messageIndex];
      if (!message) return;
      message.read_by = context.dependencies.mergeReaders(
        message.read_by,
        readBy,
      );
    }
  }

  function updateMessage(update: ChatMessage): void {
    const message = context.messages.value.find(
      (item) => item.id === update.id,
    );
    if (!message) return;
    const readBy = update.read_by;
    Object.assign(message, update);
    if (readBy)
      message.read_by = context.dependencies.mergeReaders(
        message.read_by,
        readBy,
      );
  }

  async function chatResponseError(
    response: Response,
  ): Promise<ChatDeliveryError> {
    return new Error(
      context.dependencies.chatApiErrorMessage(
        await response.text(),
        response.status,
      ),
    );
  }

  async function editMessage(
    messageId: string,
    content: string,
  ): Promise<ChatMessage> {
    const response = await fetch(
      `${context.config.public.apiPath}/chat/message/edit`,
      {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, content }),
      },
    );
    if (!response.ok) throw await context.chatResponseError(response);
    const result = parseChatMessage(await response.json());
    if (!result) throw new Error("Invalid edited chat message response");
    context.updateMessage(result);
    return result;
  }

  async function deleteMessage(messageId: string): Promise<void> {
    const targetMessage = context.messages.value.find(
      (message) => message.id === messageId,
    );
    const clientId = targetMessage?.client_id || "";
    const response = await fetch(
      `${context.config.public.apiPath}/chat/message/delete`,
      {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      },
    );
    if (!response.ok) {
      if (response.status === 404 && targetMessage?.status === "pending") {
        const pendingClientId =
          context.dependencies.pendingMessageClientId(targetMessage);
        if (pendingClientId) {
          try {
            await context.dependencies.dequeueMessage(pendingClientId);
          } catch (queueError: unknown) {
            console.warn(
              "[ChatStore] Unable to remove stale message from delivery queue:",
              queueError,
            );
          }
        }
        context.removeMessage(messageId, pendingClientId || undefined);
        return;
      }
      throw await context.chatResponseError(response);
    }
    context.removeMessage(messageId, clientId);
  }

  async function fetchMessageHistory(
    messageId: string,
  ): Promise<ExternalValue> {
    const response = await fetch(
      `${context.config.public.apiPath}/chat/message/history?messageId=${encodeURIComponent(messageId)}`,
      { credentials: "include" },
    );
    if (!response.ok) throw await context.chatResponseError(response);
    return parseExternalValue(await response.json());
  }

  function removeMessage(messageId: string, clientId = ""): void {
    context.dependencies.removeMessageAliases(
      context.messages.value,
      messageId,
      clientId,
    );
    const userId = context.dependencies.useAuthStore().getUserData()?.id;
    const channelId = context.currentChannelId.value;
    if (!userId || !channelId) return;
    context.setChannelMessages(channelId, context.messages.value, true);
    context.dependencies
      .cacheChannelMessages(String(userId), channelId, context.messages.value)
      .catch((cacheError) => {
        console.warn(
          "[ChatStore] Unable to persist deleted message cache:",
          cacheError,
        );
      });
  }

  function updateTypingStatus(userId: string, isTyping: boolean): void {
    const authStore = context.dependencies.useAuthStore();
    const userData = authStore.getUserData();

    context.dependencies.debugLog("[ChatStore] Typing status update:", {
      userId,
      isTyping,
      currentUser: userData?.id,
    });

    if (userData && userId === String(userData.id)) {
      context.dependencies.debugLog(
        "[ChatStore] Ignoring typing status for current user",
      );
      return;
    }

    if (isTyping) {
      if (!context.typingUsers.value.includes(userId)) {
        context.dependencies.debugLog(
          "[ChatStore] Adding user to typing list:",
          userId,
        );
        context.typingUsers.value.push(userId);
      }
    } else {
      const index = context.typingUsers.value.indexOf(userId);
      if (index !== -1) {
        context.dependencies.debugLog(
          "[ChatStore] Removing user from typing list:",
          userId,
        );
        context.typingUsers.value.splice(index, 1);
      }
    }

    context.dependencies.debugLog(
      "[ChatStore] Current typing users:",
      context.typingUsers.value,
    );
  }

  return {
    handleWebSocketMessage,
    handleParticipantChange,
    sendMessage,
    updateMessageReadBy,
    updateMessage,
    chatResponseError,
    editMessage,
    deleteMessage,
    fetchMessageHistory,
    removeMessage,
    updateTypingStatus,
  };
}
