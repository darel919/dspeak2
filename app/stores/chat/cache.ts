export function createChatCacheActions(context) {
  const { error } = context;
  function boundedMessages(items, limit) {
    if (!Array.isArray(items)) return [];
    return items.length > limit ? items.slice(-limit) : items;
  }

  function setChannelMessages(channelId, items, active = false) {
    const normalizedChannelId = String(channelId);
    context.channelMessages.delete(normalizedChannelId);
    context.channelMessages.set(
      normalizedChannelId,
      context.boundedMessages(
        items,
        active
          ? context.ACTIVE_CHANNEL_MESSAGE_LIMIT
          : context.INACTIVE_CHANNEL_MESSAGE_LIMIT,
      ),
    );
    while (context.channelMessages.size > context.CHANNEL_MEMORY_LIMIT) {
      const oldestChannelId = context.channelMessages.keys().next().value;
      if (oldestChannelId === String(context.currentChannelId.value)) {
        const activeMessages = context.channelMessages.get(oldestChannelId);
        context.channelMessages.delete(oldestChannelId);
        context.channelMessages.set(oldestChannelId, activeMessages);
        continue;
      }
      context.channelMessages.delete(oldestChannelId);
      context.channelPreparedAt.delete(oldestChannelId);
    }
    return context.channelMessages.get(normalizedChannelId);
  }

  function isChannelPrepared(channelId) {
    const preparedAt = context.channelPreparedAt.get(String(channelId || ""));
    return (
      Number.isFinite(preparedAt) &&
      Date.now() - preparedAt < context.PREPARED_CHANNEL_MAX_AGE_MS
    );
  }

  async function prepareChannel(channelId) {
    const preparationGeneration = context.runtime.localDataGeneration;
    const normalizedChannelId = String(channelId || "");
    if (!normalizedChannelId) return false;
    if (context.isChannelPrepared(normalizedChannelId)) return true;
    if (context.pendingChannelPreparations.has(normalizedChannelId)) {
      return context.pendingChannelPreparations.get(normalizedChannelId);
    }

    const preparation = (async () => {
      const authStore = context.dependencies.useAuthStore();
      const userData = authStore.getUserData();
      if (!userData?.id) return false;

      try {
        const cached = await context.dependencies.getCachedChannelMessages(
          userData.id,
          normalizedChannelId,
        );
        if (preparationGeneration !== context.runtime.localDataGeneration)
          return false;
        if (cached && Array.isArray(cached.messages)) {
          context.setChannelMessages(normalizedChannelId, cached.messages);
        }
      } catch (cacheError) {
        console.warn(
          "[ChatStore] Unable to prepare cached channel messages:",
          cacheError,
        );
      }

      if (!navigator.onLine) {
        if (!context.channelMessages.has(normalizedChannelId)) {
          context.setChannelMessages(normalizedChannelId, []);
        }
        context.channelPreparedAt.set(normalizedChannelId, Date.now());
        return true;
      }

      try {
        const apiPath = context.config.public.apiPath;
        const response = await fetch(
          `${apiPath}/chat/messages?channelId=${encodeURIComponent(normalizedChannelId)}`,
          {
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
        if (!response.ok) return false;

        const data = await response.json();
        if (preparationGeneration !== context.runtime.localDataGeneration)
          return false;
        const serverMessages = Array.isArray(data.messages)
          ? data.messages
          : Array.isArray(data)
            ? data
            : [];
        const preparedMessages =
          context.dependencies.mergeServerMessagesWithPending(
            serverMessages,
            context.channelMessages.get(normalizedChannelId) || [],
          );
        context.setChannelMessages(normalizedChannelId, preparedMessages);
        context.channelPreparedAt.set(normalizedChannelId, Date.now());
        context.dependencies
          .cacheChannelMessages(
            userData.id,
            normalizedChannelId,
            preparedMessages,
          )
          .catch((cacheError) => {
            console.warn(
              "[ChatStore] Unable to persist prepared channel messages:",
              cacheError,
            );
          });
        return true;
      } catch (preparationError) {
        if (!context.channelMessages.has(normalizedChannelId)) return false;
        context.dependencies.debugLog(
          "[ChatStore] Using cached messages after preparation failed:",
          preparationError,
        );
        return true;
      }
    })();

    context.pendingChannelPreparations.set(normalizedChannelId, preparation);
    try {
      return await preparation;
    } finally {
      if (
        context.pendingChannelPreparations.get(normalizedChannelId) ===
        preparation
      ) {
        context.pendingChannelPreparations.delete(normalizedChannelId);
      }
    }
  }

  async function prepareChannels(channelIds, concurrency = 2) {
    const pendingIds = [...new Set(channelIds.map(String))].filter(
      (channelId) => channelId && !context.isChannelPrepared(channelId),
    );
    let nextIndex = 0;
    const workerCount = Math.min(Math.max(1, concurrency), pendingIds.length);

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (nextIndex < pendingIds.length) {
          const channelId = pendingIds[nextIndex];
          nextIndex += 1;
          await context.prepareChannel(channelId);
        }
      }),
    );
  }

  async function fetchMessages(
    channelId,
    generation = context.runtime.connectionGeneration,
  ) {
    const hasVisibleMessages =
      context.currentChannelId.value === channelId &&
      context.messages.value.length > 0;
    context.loading.value = !hasVisibleMessages;
    error.value = null;
    if (context.runtime.activeFetchController)
      context.runtime.activeFetchController.abort();
    const controller = new AbortController();
    context.runtime.activeFetchController = controller;

    try {
      const authStore = context.dependencies.useAuthStore();
      const userData = authStore.getUserData();

      if (!userData || !userData.id) {
        throw new Error("User not authenticated");
      }

      const apiPath = context.config.public.apiPath;
      const response = await fetch(
        `${apiPath}/chat/messages?channelId=${channelId}`,
        {
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch messages: ${response.status}`);
      }

      const data = await response.json();
      if (
        generation !== context.runtime.connectionGeneration ||
        context.currentChannelId.value !== channelId
      ) {
        return;
      }
      let nextMessages;
      if (Array.isArray(data.messages)) {
        nextMessages = data.messages;
      } else if (Array.isArray(data)) {
        nextMessages = data;
      } else {
        nextMessages = [] as any;
      }
      nextMessages = context.dependencies.mergeServerMessagesWithPending(
        nextMessages,
        context.channelMessages.get(channelId) ||
          (context.currentChannelId.value === channelId
            ? context.messages.value
            : []),
      );
      nextMessages = context.setChannelMessages(channelId, nextMessages, true);
      context.channelPreparedAt.set(String(channelId), Date.now());
      context.messages.value = nextMessages;
      context.dependencies
        .cacheChannelMessages(userData.id, channelId, nextMessages)
        .catch((cacheError) => {
          console.warn(
            "[ChatStore] Unable to persist message cache:",
            cacheError,
          );
        });

      try {
        await context.hydratePendingReadIds(userData.id);
        const alreadyReadIds = context.messages.value
          .filter(
            (msg) =>
              Array.isArray(msg.read_by) && msg.read_by.includes(userData.id),
          )
          .map((msg) => msg.id);
        const originalSize = context.pendingReadIds.size;
        for (const messageId of alreadyReadIds) {
          context.pendingReadIds.delete(messageId);
        }
        if (context.pendingReadIds.size !== originalSize) {
          await context.persistPendingReadIds(userData.id);
        }
      } catch (e) {
        console.warn("[ChatStore] Failed to reconcile local unread IDs:", e);
      }
    } catch (err) {
      if (!navigator.onLine) {
        context.handleBrowserOffline();
      } else if (
        err.name !== "AbortError" &&
        generation === context.runtime.connectionGeneration
      ) {
        error.value = err.message;
        console.error("[ChatStore] Error fetching messages:", err);
      }
    } finally {
      if (context.runtime.activeFetchController === controller) {
        context.runtime.activeFetchController = null;
      }
      if (
        generation === context.runtime.connectionGeneration &&
        context.currentChannelId.value === channelId
      ) {
        context.loading.value = false;
      }
    }
  }

  function handleBackgroundSyncSuccess(pendingId) {
    const authStore = context.dependencies.useAuthStore();
    const userId = authStore.getUserData()?.id;
    for (const [channelId, cachedMessages] of [...context.channelMessages]) {
      const nextMessages = cachedMessages.filter(
        (message) => message.id !== pendingId,
      );
      if (nextMessages.length === cachedMessages.length) continue;
      context.setChannelMessages(
        channelId,
        nextMessages,
        String(context.currentChannelId.value) === String(channelId),
      );
      if (context.currentChannelId.value === channelId) {
        context.messages.value = nextMessages;
      }
      if (userId) {
        context.dependencies
          .cacheChannelMessages(userId, channelId, nextMessages)
          .catch((cacheError) => {
            console.warn(
              "[ChatStore] Unable to reconcile synced message cache:",
              cacheError,
            );
          });
      }
    }
  }

  function handleBackgroundSyncFailure(pendingId, status) {
    for (const cachedMessages of context.channelMessages.values()) {
      const pending = cachedMessages.find(
        (message) => message.id === pendingId,
      );
      if (!pending) continue;
      pending.status = "failed";
      pending.error =
        status === 403
          ? "You no longer have access to this channel."
          : "This queued message could not be sent.";
    }
  }

  return {
    boundedMessages,
    setChannelMessages,
    isChannelPrepared,
    prepareChannel,
    prepareChannels,
    fetchMessages,
    handleBackgroundSyncSuccess,
    handleBackgroundSyncFailure,
  };
}
