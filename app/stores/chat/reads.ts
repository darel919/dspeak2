export function createChatReadActions(context) {
  function markMessageAsRead(messageId) {
    const userData = context.dependencies.useAuthStore().getUserData();
    if (!userData?.id) return;
    const message = context.messages.value.find(
      (item) => item.id === messageId,
    );
    if (!message || message.sender?.id === userData.id) return;
    if (context.dependencies.hasReader(message.read_by, userData.id)) return;

    message.read_by = context.dependencies.addReader(message.read_by, userData);
    context.pendingReadIds.add(messageId);
    void context.persistPendingReadIds(userData.id);
    context.scheduleReadFlush();
  }

  function legacyReadStorageKey(userId) {
    return `dspeak2_unread_message_ids_${userId}`;
  }

  async function hydratePendingReadIds(userId) {
    if (context.runtime.pendingReadHydration)
      return context.runtime.pendingReadHydration;
    context.runtime.pendingReadHydration = (async () => {
      const stored = await context.dependencies.getPendingReadIds(userId);
      let legacy = [] as any;
      try {
        legacy = JSON.parse(
          localStorage.getItem(context.legacyReadStorageKey(userId)) || "[]",
        );
      } catch (storageError) {
        console.warn(
          "[ChatStore] Unable to import legacy pending read state:",
          storageError,
        );
      }
      for (const messageId of [
        ...stored,
        ...(Array.isArray(legacy) ? legacy : []),
      ]) {
        context.pendingReadIds.add(String(messageId));
      }
      if (Array.isArray(legacy) && legacy.length > 0) {
        await context.persistPendingReadIds(userId);
      }
      try {
        localStorage.removeItem(context.legacyReadStorageKey(userId));
      } catch (storageError) {
        console.warn(
          "[ChatStore] Unable to remove legacy pending read state:",
          storageError,
        );
      }
    })().catch((storageError) => {
      context.runtime.pendingReadHydration = null;
      console.warn(
        "[ChatStore] Unable to restore pending read state:",
        storageError,
      );
    });
    return context.runtime.pendingReadHydration;
  }

  function persistPendingReadIds(userId) {
    const snapshot = [...context.pendingReadIds];
    context.runtime.pendingReadPersistence =
      context.runtime.pendingReadPersistence
        .catch(() => {})
        .then(() => context.dependencies.savePendingReadIds(userId, snapshot))
        .catch((storageError) => {
          console.warn(
            "[ChatStore] Unable to persist pending read state:",
            storageError,
          );
        });
    return context.runtime.pendingReadPersistence;
  }

  function scheduleReadFlush() {
    if (
      context.runtime.readFlushTimer ||
      context.runtime.readFlushPromise ||
      !navigator.onLine
    )
      return;
    context.runtime.readFlushTimer = setTimeout(() => {
      context.runtime.readFlushTimer = null;
      context.flushPendingReads();
    }, 400);
  }

  async function flushPendingReads() {
    if (context.runtime.readFlushPromise)
      return context.runtime.readFlushPromise;
    const userData = context.dependencies.useAuthStore().getUserData();
    if (!userData?.id || !navigator.onLine) return;
    await context.hydratePendingReadIds(userData.id);
    const pendingReadIds = context.pendingReadIds;
    const messageIds = [...pendingReadIds].slice(0, 200);
    if (messageIds.length === 0) return;
    const flushGeneration = context.runtime.localDataGeneration;

    context.runtime.readFlushPromise = (async () => {
      const response = await fetch(
        `${context.config.public.apiPath}/chat/read`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ messageIds }),
        },
      );
      if (!response.ok) {
        throw new Error(`Failed to update read state: ${response.status}`);
      }
      const payload = await response.json();
      if (flushGeneration !== context.runtime.localDataGeneration) return;
      for (const result of payload.results || []) {
        if (
          result.status === "marked_as_read" ||
          result.status === "already_read"
        ) {
          context.pendingReadIds.delete(result.messageId);
        }
      }
      await context.persistPendingReadIds(userData.id);
      await context.dependencies.useChannelsStore().getUnreadCounts();
    })()
      .catch((readError) => {
        console.error("[ChatStore] Unable to update read state:", readError);
      })
      .finally(() => {
        context.runtime.readFlushPromise = null;
        if (
          [...context.pendingReadIds].some(
            (messageId) => !messageIds.includes(messageId),
          )
        ) {
          context.scheduleReadFlush();
        }
      });
    return context.runtime.readFlushPromise;
  }

  function sendTypingIndicator(isTyping) {
    context.dependencies.debugLog("[ChatStore] Sending typing indicator:", {
      isTyping,
      connected: context.connected.value,
    });
    if (context.realtimeChannel.value && context.connected.value) {
      const authStore = context.dependencies.useAuthStore();
      const userData = authStore.getUserData();
      context.realtimeChannel.value
        .send({
          type: "broadcast",
          event: "message",
          payload: {
            type: "user_typing",
            data: {
              userId: userData?.id,
              channelId: context.currentChannelId.value,
              isTyping,
            },
          },
        })
        .catch((typingError) => {
          context.dependencies.debugLog(
            "[ChatStore] Typing broadcast failed:",
            typingError,
          );
        });
    } else {
      context.dependencies.debugLog(
        "[ChatStore] Cannot send typing indicator - not connected",
      );
    }
  }

  return {
    markMessageAsRead,
    legacyReadStorageKey,
    hydratePendingReadIds,
    persistPendingReadIds,
    scheduleReadFlush,
    flushPendingReads,
    sendTypingIndicator,
  };
}
