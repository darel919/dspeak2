import type {
  ChatDeliveryError,
  ChatEventEnvelope,
  ChatMessage,
  ChatSendOptions,
  ChatStoreContext,
} from "../../shared/types/chat-store.ts";

export function createChatMessageActions(context: ChatStoreContext) {
  const { error } = context;
  async function handleWebSocketMessage(event: {
    data: unknown;
  }): Promise<void> {
    try {
      const data = JSON.parse(String(event.data)) as ChatEventEnvelope;
      switch (data.type) {
        case "connected":
          break;
        case "new_message":
          if (
            context.dependencies.reconcileIncomingMessage(
              context.messages.value,
              data.data as ChatMessage,
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
            context.handleNewMessageNotification(data.data as ChatMessage);
          }
          break;
        case "message_updated":
          context.dependencies.debugLog(
            "[ChatStore] Message updated:",
            data.data,
          );
          context.updateMessage(data.data as ChatMessage);
          break;
        case "message_deleted":
          context.dependencies.debugLog(
            "[ChatStore] Message deleted:",
            data.data,
          );
          context.removeMessage(String(data.data?.id || ""));
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
          context.updateTypingStatus(
            String(data.data?.userId || ""),
            Boolean(data.data?.isTyping),
          );
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
              .map((u) =>
                typeof u === "string"
                  ? { id: u }
                  : u && typeof u.id === "string"
                    ? u
                    : null,
              )
              .filter(
                (u): u is { id: string; [key: string]: unknown } => u !== null,
              );
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
          context.reactionChanged.value = {
            messageId: data.data?.messageId,
            type: data.type,
            ts: Date.now(),
          };
          break;
        case "message_pinned":
        case "message_unpinned":
          context.updateMessage({
            id: String(data.data?.messageId || ""),
            content: "",
            pinned: data.type === "message_pinned",
          });
          context.pinChanged.value = {
            messageId: data.data?.messageId,
            channelId: data.data?.channelId,
            pinned: data.type === "message_pinned",
            ts: Date.now(),
          };
          break;
        case "channel_policy_updated":
          context.dependencies
            .useChannelsStore()
            .applyRealtimePolicy(
              String(data.data?.channelId || ""),
              data.data || {},
            );
          break;
        case "notification_created":
        case "notifications_read":
          context.dependencies.useNotificationsStore().receiveRealtime({
            type: data.type,
            data: data.data,
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
  ): Promise<unknown> {
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
          name: typeof userData.name === "string" ? userData.name : "You",
          email:
            typeof userData.email === "string" ? userData.email : undefined,
        },
        created,
        updated: created,
        read_by: [String(userData.id)],
        client_id: clientMessageId,
        attachments,
        reply_to: replyTo,
        status: "pending",
      };

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
          pendingId: pendingMessage!.id,
          attachments,
          replyTo,
        };
        await context.dependencies.enqueueMessage(queuedMessage);
        context.requestBackgroundSync();
        return { status: "queued-offline", id: queuedMessage.id };
      }

      try {
        const apiPath = context.config.public.apiPath;
        const response = await fetch(`${apiPath}/chat/message`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            channelId,
            content,
            clientMessageId,
            ownerId: userData.id,
            ...(attachments.length > 0 && { attachments }),
            ...(replyTo != null ? { replyTo } : {}),
          }),
        });

        if (!response.ok) {
          const deliveryError = await context.chatResponseError(response);
          deliveryError.retryable =
            response.status === 408 || response.status >= 500;
          throw deliveryError;
        }

        const message = (await response.json()) as ChatMessage;

        context.dependencies.reconcileSentMessage(
          context.messages.value,
          pendingMessage!.id,
          message,
        );

        return message;
      } catch (fetchError: unknown) {
        const deliveryError: ChatDeliveryError =
          fetchError instanceof Error
            ? (fetchError as ChatDeliveryError)
            : Object.assign(new Error(String(fetchError)), {
                retryable: undefined,
              });
        if (deliveryError.retryable === false) {
          context.removeMessage(pendingMessage!.id, clientMessageId);
          throw fetchError;
        }
        const queuedMessage = {
          id: clientMessageId,
          channelId,
          content,
          ownerId: userData.id,
          pendingId: pendingMessage!.id,
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
    const result = (await response.json()) as ChatMessage;
    context.updateMessage(result);
    return result;
  }

  async function deleteMessage(messageId: string): Promise<void> {
    const targetMessage = context.messages.value.find(
      (message) => message.id === messageId,
    );
    const clientId = targetMessage?.client_id || "";
    const isPending = targetMessage?.status === "pending";
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
      if (response.status === 404 && isPending) {
        const pendingClientId = context.dependencies.pendingMessageClientId(
          targetMessage!,
        );
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

  async function fetchMessageHistory(messageId: string): Promise<unknown> {
    const response = await fetch(
      `${context.config.public.apiPath}/chat/message/history?messageId=${encodeURIComponent(messageId)}`,
      { credentials: "include" },
    );
    if (!response.ok) throw await context.chatResponseError(response);
    return response.json();
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
