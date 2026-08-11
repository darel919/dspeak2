export function createChatExtraActions(context) {
  const { error } = context;
  function clearChat() {
    context.runtime.localDataGeneration += 1;
    const pendingStorageCleanup = (async () => {
      await context.runtime.pendingReadHydration;
      await context.runtime.pendingReadPersistence;
    })();
    context.disconnectFromChannel(true);
    if (context.runtime.readFlushTimer) {
      clearTimeout(context.runtime.readFlushTimer);
      context.runtime.readFlushTimer = null;
    }
    context.pendingReadIds.clear();
    context.runtime.pendingReadHydration = null;
    context.channelMessages.clear();
    context.pendingChannelPreparations.clear();
    context.channelPreparedAt.clear();
    context.messages.value = [];
    error.value = null;
    context.onlineUsers.value = [];
    context.typingUsers.value = [];
    return pendingStorageCleanup;
  }

  async function handleNewMessageNotification(message) {
    try {
      const authStore = context.dependencies.useAuthStore();
      const userData = authStore.getUserData();

      const senderId = message?.sender?.id || message?.sender;
      if (
        userData?.id &&
        senderId &&
        String(senderId) === String(userData.id)
      ) {
        context.dependencies.debugLog(
          "[ChatStore] Skipping notification for own message",
        );
        return;
      }

      context.dependencies.debugLog(
        "[ChatStore] Checking notification conditions...",
      );
      context.dependencies.debugLog(
        "[ChatStore] Page visibility - hidden:",
        document.hidden,
        "focused:",
        document.hasFocus(),
      );

      const notificationManager = (
        await import("../../utils/notificationManager")
      ).default;

      context.dependencies.debugLog("[ChatStore] Notification settings:");
      context.dependencies.debugLog(
        "  - Supported:",
        notificationManager.isSupported,
      );
      context.dependencies.debugLog(
        "  - Enabled:",
        notificationManager.isEnabled,
      );
      context.dependencies.debugLog(
        "  - Permission:",
        notificationManager.permission,
      );
      context.dependencies.debugLog(
        "  - Should show:",
        notificationManager.shouldShowNotification(),
      );

      if (notificationManager.isSupported && notificationManager.isEnabled) {
        context.dependencies.debugLog(
          "[ChatStore] Attempting to show notification for message:",
          message,
        );

        const notification = notificationManager.showMessageNotification(
          message,
          context.currentChannelName.value,
          userData?.id,
        );

        if (notification) {
          context.dependencies.debugLog(
            "[ChatStore] Notification created successfully",
          );
          notification.onclick = () => {
            context.dependencies.debugLog(
              "[ChatStore] Notification clicked - focusing window",
            );
            window.focus();
            notification.close();
          };
        } else {
          context.dependencies.debugLog(
            "[ChatStore] Notification creation returned null",
          );
        }
      } else {
        context.dependencies.debugLog(
          "[ChatStore] Notification conditions not met - supported:",
          notificationManager.isSupported,
          "enabled:",
          notificationManager.isEnabled,
        );
      }
    } catch (error) {
      console.error("[ChatStore] Error showing notification:", error);
    }
  }

  async function fetchBookmarks() {
    try {
      const apiPath = context.config.public.apiPath;
      const response = await fetch(`${apiPath}/chat/bookmarks`, {
        credentials: "include",
      });
      if (!response.ok) return { bookmarks: [] };
      return await response.json();
    } catch (err) {
      console.error("[ChatStore] Failed to fetch bookmarks:", err);
      return { bookmarks: [] };
    }
  }

  async function fetchPinned(channelId) {
    try {
      const apiPath = context.config.public.apiPath;
      const response = await fetch(
        `${apiPath}/chat/pinned?channelId=${encodeURIComponent(channelId)}`,
        { credentials: "include" },
      );
      if (!response.ok) return { pinned: [] };
      return await response.json();
    } catch (err) {
      console.error("[ChatStore] Failed to fetch pinned messages:", err);
      return { pinned: [] };
    }
  }

  async function searchMessages(channelId, query, filters) {
    try {
      const apiPath = context.config.public.apiPath;
      const params = new URLSearchParams({ channelId, q: query });
      if (filters?.author) params.set("author", filters.author);
      if (filters?.has) params.set("has", filters.has);
      if (filters?.before) params.set("before", filters.before);
      if (filters?.after) params.set("after", filters.after);
      const response = await fetch(`${apiPath}/chat/search?${params}`, {
        credentials: "include",
      });
      if (!response.ok) throw await context.chatResponseError(response);
      return await response.json();
    } catch (err) {
      console.error("[ChatStore] Failed to search messages:", err);
      throw err;
    }
  }

  async function undoMessage(messageId) {
    try {
      const apiPath = context.config.public.apiPath;
      const response = await fetch(`${apiPath}/chat/message/undo`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      if (!response.ok) throw await context.chatResponseError(response);
      context.removeMessage(messageId);
      return await response.json();
    } catch (err) {
      console.error("[ChatStore] Failed to undo message:", err);
      throw err;
    }
  }

  return {
    clearChat,
    handleNewMessageNotification,
    fetchBookmarks,
    fetchPinned,
    searchMessages,
    undoMessage,
  };
}
