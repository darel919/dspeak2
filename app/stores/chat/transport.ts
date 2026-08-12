import type { ChatStoreContext } from "../../shared/types/chat-store.ts";
import type { RealtimeChannelLike } from "../../shared/realtime-channel.ts";

export function createChatTransportActions(context: ChatStoreContext) {
  const { error } = context;
  function handleServiceWorkerMessage(event: {
    data: { type?: string; pendingId?: string; status?: number };
  }): void {
    if (event.data.type === "BACKGROUND_SYNC_SUCCESS") {
      context.handleBackgroundSyncSuccess(event.data.pendingId);
    }
    if (event.data.type === "BACKGROUND_SYNC_FAILURE") {
      context.handleBackgroundSyncFailure(
        event.data.pendingId,
        event.data.status,
      );
    }
  }

  function handleServiceWorkerControllerChange() {
    navigator.serviceWorker.controller?.postMessage({
      type: "FLUSH_CHAT_QUEUE",
    });
  }

  function closeActiveTransport() {
    const channel = context.realtimeChannel.value;
    context.realtimeChannel.value = null;
    if (!channel) return;
    try {
      Promise.resolve(channel.unsubscribe()).then(() => {});
    } catch (socketError) {
      console.warn(
        "[ChatStore] Unable to unsubscribe realtime channel:",
        socketError,
      );
    }
  }

  function joinChannelMembership(channelId: string): void {
    if (!import.meta.client || !channelId) return;
    context.dependencies
      .useChannelsStore()
      .joinChannel(channelId)
      .catch((joinError: unknown) => {
        context.dependencies.debugLog(
          "[ChatStore] Failed to join channel membership:",
          joinError,
        );
      });
    context.registerPageHideLeave();
  }

  function registerPageHideLeave() {
    if (!import.meta.client || context.runtime.pageHideRemoveListener) return;
    const handlePageHide = () => {
      context.leaveChannelMembership(context.currentChannelId.value);
    };
    window.addEventListener("pagehide", handlePageHide);
    context.runtime.pageHideRemoveListener = () =>
      window.removeEventListener("pagehide", handlePageHide);
  }

  function leaveChannelMembership(channelId: string | null): void {
    if (!import.meta.client || !channelId) return;
    context.dependencies
      .useChannelsStore()
      .leaveChannel(channelId)
      .catch((leaveError: unknown) => {
        context.dependencies.debugLog(
          "[ChatStore] Failed to leave channel membership:",
          leaveError,
        );
      });
  }

  function handleBrowserOffline() {
    context.offline.value = true;
    error.value = null;
    context.connected.value = false;
    context.connecting.value = false;
    context.onlineUsers.value = [];
    context.typingUsers.value = [];
    if (context.runtime.activeFetchController) {
      context.runtime.activeFetchController.abort();
      context.runtime.activeFetchController = null;
    }
    if (context.runtime.reconnectTimer) {
      clearTimeout(context.runtime.reconnectTimer);
      context.runtime.reconnectTimer = null;
    }
    context.closeActiveTransport();
  }

  function handleBrowserOnline() {
    context.offline.value = false;
    error.value = null;
    context.flushPendingReads();
    if (context.currentChannelId.value) {
      context.connectToChannel(
        context.currentChannelId.value,
        context.currentChannelName.value,
        context.currentRoomId.value,
        true,
      );
    }
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      setTimeout(() => {
        context.requestBackgroundSync();
        navigator.serviceWorker.controller?.postMessage({
          type: "FLUSH_CHAT_QUEUE",
        });
      }, 500);
    }
  }

  async function requestBackgroundSync() {
    if (
      context.dependencies.hasTauriRuntimeMarker() ||
      !("serviceWorker" in navigator) ||
      !("SyncManager" in window)
    )
      return;
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.sync?.register("chat-sync-v2");
    } catch (syncError) {
      context.dependencies.debugLog(
        "[ChatStore] Background Sync unavailable:",
        syncError,
      );
    }
  }

  function triggerManualSync() {
    if (
      !context.dependencies.hasTauriRuntimeMarker() &&
      "serviceWorker" in navigator &&
      navigator.serviceWorker.controller
    ) {
      navigator.serviceWorker.controller.postMessage({
        type: "FLUSH_CHAT_QUEUE",
      });
    }
  }

  function scheduleReconnect() {
    if (
      !context.intentionalDisconnect.value &&
      !context.runtime.reconnectTimer &&
      context.currentChannelId.value
    ) {
      context.runtime.backoffAttempts = Math.min(
        context.runtime.backoffAttempts + 1,
        10,
      );

      const baseDelay = Math.min(
        30000,
        1000 * Math.pow(2, Math.max(0, context.runtime.backoffAttempts - 1)),
      );

      const jitter = 0.8 + Math.random() * 0.4;
      const delay = Math.round(baseDelay * jitter);
      context.dependencies.debugLog(
        `[ChatStore] Scheduling reconnect in ${delay}ms (attempt ${context.runtime.backoffAttempts})`,
      );
      context.runtime.reconnectTimer = setTimeout(() => {
        context.runtime.reconnectTimer = null;
        if (!context.connected.value && context.currentChannelId.value) {
          context.dependencies.debugLog(
            "[ChatStore] Attempting to reconnect...",
          );
          context.connectToChannel(
            context.currentChannelId.value,
            context.currentChannelName.value,
            context.currentRoomId.value,
            true,
          );
        }
      }, delay);
    }
  }

  async function connectToChannel(
    channelId: string,
    channelName: string | null = null,
    roomId: string | null = null,
    isReconnect = false,
  ) {
    if (
      context.currentChannelId.value &&
      context.currentChannelId.value === channelId &&
      context.connected.value
    ) {
      context.dependencies.debugLog(
        "[ChatStore] Already connected to channel, skipping reconnect:",
        channelId,
      );
      return;
    }

    if (
      context.connecting.value &&
      context.currentChannelId.value === channelId
    ) {
      context.dependencies.debugLog(
        "[ChatStore] Connect already in progress for channel, skipping:",
        channelId,
      );
      return;
    }

    const generation = isReconnect
      ? context.runtime.connectionGeneration
      : context.runtime.connectionGeneration + 1;
    if (!isReconnect) {
      context.runtime.connectionGeneration = generation;
      context.disconnectFromChannel(true, true, false);
    }

    context.connecting.value = true;
    try {
      const authStore = context.dependencies.useAuthStore();
      const userData = authStore.getUserData();
      if (!userData || !userData.id) {
        throw new Error("User not authenticated");
      }

      context.currentChannelId.value = channelId;
      context.currentChannelName.value = channelName;
      context.currentRoomId.value = roomId;
      error.value = null;
      context.onlineUsers.value = [];
      context.typingUsers.value = [];

      if (context.pendingChannelPreparations.has(String(channelId))) {
        await context.pendingChannelPreparations.get(String(channelId));
        if (
          generation !== context.runtime.connectionGeneration ||
          context.currentChannelId.value !== channelId
        ) {
          return;
        }
      }

      const memoryMessages = context.channelMessages.get(channelId);
      if (memoryMessages) {
        context.messages.value = memoryMessages;
        context.loading.value = false;
      } else {
        context.messages.value = [];
        context.loading.value = true;
        try {
          const cached = await context.dependencies.getCachedChannelMessages(
            userData.id,
            channelId,
          );
          if (
            generation !== context.runtime.connectionGeneration ||
            context.currentChannelId.value !== channelId
          ) {
            return;
          }
          if (cached && Array.isArray(cached.messages)) {
            context.messages.value = context.setChannelMessages(
              channelId,
              cached.messages,
              true,
            );
            context.loading.value = false;
          }
        } catch (cacheError) {
          console.warn(
            "[ChatStore] Unable to hydrate message cache:",
            cacheError,
          );
        }
      }

      if (!navigator.onLine) {
        context.offline.value = true;
        context.setChannelMessages(channelId, context.messages.value, true);
        context.loading.value = false;
        context.connecting.value = false;
        return;
      }

      context.offline.value = false;
      if (!context.isChannelPrepared(channelId)) {
        await context.fetchMessages(channelId, generation);
      }
      if (
        generation !== context.runtime.connectionGeneration ||
        context.currentChannelId.value !== channelId
      ) {
        return;
      }

      const supabaseClient = context.dependencies.getSupabaseClient();
      if (!supabaseClient) {
        throw new Error("Supabase Realtime is not configured");
      }
      if (context.realtimeChannel.value) {
        context.closeActiveTransport();
      }
      const sessionResult = await supabaseClient.auth.getSession();
      const accessToken = sessionResult.data.session?.access_token;
      if (!accessToken) throw new Error("Supabase session is unavailable");
      supabaseClient.realtime.setAuth(accessToken);
      const supabaseChannel = supabaseClient.channel(`chat:${channelId}`, {
        config: { private: true },
      });
      const channel = supabaseChannel as unknown as RealtimeChannelLike;
      context.realtimeChannel.value = channel;

      supabaseChannel
        .on(
          "broadcast",
          { event: "message" },
          (payload: { payload?: unknown }) => {
            if (
              context.realtimeChannel.value === channel &&
              generation === context.runtime.connectionGeneration &&
              context.currentChannelId.value === channelId
            ) {
              void context.handleWebSocketMessage({
                data: JSON.stringify(payload?.payload),
              });
            }
          },
        )
        .subscribe((status: string) => {
          if (context.realtimeChannel.value !== channel) {
            return;
          }
          if (status === "SUBSCRIBED" || status === "SYNCED") {
            if (
              generation !== context.runtime.connectionGeneration ||
              context.currentChannelId.value !== channelId
            ) {
              return;
            }
            context.connecting.value = false;
            context.connected.value = true;
            context.intentionalDisconnect.value = false;
            context.dependencies.debugLog(
              `[ChatStore] Connected to channel ${channelId}`,
            );
            if (context.runtime.reconnectTimer) {
              clearTimeout(context.runtime.reconnectTimer);
              context.runtime.reconnectTimer = null;
            }
            context.runtime.backoffAttempts = 0;
            context.joinChannelMembership(channelId);
            return;
          }
          if (status === "CHANNEL_ERROR" || status === "CLOSED") {
            context.connecting.value = false;
            context.connected.value = false;
            if (!navigator.onLine) {
              context.handleBrowserOffline();
              return;
            }
            error.value = "Unable to connect to real-time chat";
            context.scheduleReconnect();
          }
        });

      if (typeof window !== "undefined") {
        try {
          const { usePushSubscription } =
            await import("../../composables/usePushSubscription");
          const { updateSubscription, isSupported, isSubscribed } =
            usePushSubscription();
          if (isSupported.value && !isSubscribed.value) {
            await updateSubscription();
            context.dependencies.debugLog(
              "[ChatStore] Push subscription updated (global)",
            );
          }
        } catch (err) {
          console.warn("[ChatStore] Failed to update push subscription:", err);
        }
      }
    } catch (err: unknown) {
      context.connecting.value = false;
      if (!navigator.onLine) {
        context.handleBrowserOffline();
      } else {
        error.value = err instanceof Error ? err.message : String(err);
        console.error("[ChatStore] Error connecting to channel:", err);
      }
    }
  }

  function disconnectFromChannel(
    intentional = false,
    preserveMessages = false,
    invalidateGeneration = true,
    expectedChannelId = null,
  ) {
    if (
      expectedChannelId &&
      context.currentChannelId.value &&
      context.currentChannelId.value !== expectedChannelId
    ) {
      return false;
    }

    if (invalidateGeneration) context.runtime.connectionGeneration += 1;
    context.intentionalDisconnect.value = !!intentional;

    const leavingChannelId = context.currentChannelId.value;
    if (context.realtimeChannel.value) {
      try {
        context.closeActiveTransport();
      } catch (e) {
        console.warn("[ChatStore] Error closing chat transport cleanly:", e);
      }
    }
    if (context.runtime.reconnectTimer) {
      clearTimeout(context.runtime.reconnectTimer);
      context.runtime.reconnectTimer = null;
    }
    if (context.runtime.activeFetchController) {
      context.runtime.activeFetchController.abort();
      context.runtime.activeFetchController = null;
    }
    if (leavingChannelId) {
      context.leaveChannelMembership(leavingChannelId);
    }
    if (context.runtime.pageHideRemoveListener) {
      context.runtime.pageHideRemoveListener();
      context.runtime.pageHideRemoveListener = null;
    }

    context.connecting.value = false;
    context.connected.value = false;
    context.currentChannelId.value = null;
    context.currentChannelName.value = null;
    context.currentRoomId.value = null;
    if (!preserveMessages) context.messages.value = [];
    context.onlineUsers.value = [];
    context.typingUsers.value = [];
    return true;
  }

  return {
    handleServiceWorkerMessage,
    handleServiceWorkerControllerChange,
    closeActiveTransport,
    joinChannelMembership,
    registerPageHideLeave,
    leaveChannelMembership,
    handleBrowserOffline,
    handleBrowserOnline,
    requestBackgroundSync,
    triggerManualSync,
    scheduleReconnect,
    connectToChannel,
    disconnectFromChannel,
  };
}
