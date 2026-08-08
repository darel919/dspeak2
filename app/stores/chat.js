import { defineStore } from "pinia";
import { useRuntimeConfig } from "#app";
import { useAuthStore } from "./auth";
import { useRoomsStore } from "./rooms";
import { useChannelsStore } from "./channels";
import { useNotificationsStore } from "./notifications";
import {
  cacheChannelMessages,
  dequeueMessage,
  enqueueMessage,
  getCachedChannelMessages,
  getPendingReadIds,
  IdbOperationError,
  savePendingReadIds,
} from "../utils/idb";
import { addReader, hasReader, mergeReaders } from "../shared/read-receipts";
import {
  chatApiErrorMessage,
  mergeServerMessagesWithPending,
  pendingMessageClientId,
  removeMessageAliases,
  reconcileIncomingMessage,
  reconcileSentMessage,
} from "../shared/chat-messages";
import {
  canSendInChannel,
  isSlowModeCooldownActive,
  slowModeRemainingMs,
} from "~~/shared/channel-policy.js";
import { debugLog } from "../shared/debug";
import { hasTauriRuntimeMarker } from "../shared/desktop-capture.js";
import { closeSocketOnPageHide } from "../shared/socket-lifecycle";
import { getSupabaseClient } from "../utils/supabase-client.js";

export const useChatStore = defineStore("chat", () => {
  const messages = ref([]);
  const loading = ref(false);
  const error = ref(null);
  const ws = ref(null);
  const realtimeChannel = ref(null);
  const connected = ref(false);
  const connecting = ref(false);
  const intentionalDisconnect = ref(false);
  const currentChannelId = ref(null);
  const currentChannelName = ref(null);
  const currentRoomId = ref(null);
  const onlineUsers = ref([]);
  const typingUsers = ref([]);
  const offline = ref(import.meta.client ? !navigator.onLine : false);
  const reactionChanged = ref(null);
  const pinChanged = ref(null);
  const config = useRuntimeConfig();
  let reconnectTimer = null;
  let backoffAttempts = 0;
  let pingInterval = null;
  let connectionGeneration = 0;
  let activeFetchController = null;
  let readFlushTimer = null;
  let readFlushPromise = null;
  let pendingReadHydration = null;
  let pendingReadPersistence = Promise.resolve();
  let localDataGeneration = 0;
  const pendingReadIds = new Set();
  const channelMessages = new Map();
  const pendingChannelPreparations = new Map();
  const channelPreparedAt = new Map();
  const PREPARED_CHANNEL_MAX_AGE_MS = 15000;
  const ACTIVE_CHANNEL_MESSAGE_LIMIT = 1000;
  const INACTIVE_CHANNEL_MESSAGE_LIMIT = 300;
  const CHANNEL_MEMORY_LIMIT = 8;

  function boundedMessages(items, limit) {
    if (!Array.isArray(items)) return [];
    return items.length > limit ? items.slice(-limit) : items;
  }

  function setChannelMessages(channelId, items, active = false) {
    const normalizedChannelId = String(channelId);
    channelMessages.delete(normalizedChannelId);
    channelMessages.set(
      normalizedChannelId,
      boundedMessages(
        items,
        active ? ACTIVE_CHANNEL_MESSAGE_LIMIT : INACTIVE_CHANNEL_MESSAGE_LIMIT,
      ),
    );
    while (channelMessages.size > CHANNEL_MEMORY_LIMIT) {
      const oldestChannelId = channelMessages.keys().next().value;
      if (oldestChannelId === String(currentChannelId.value)) {
        const activeMessages = channelMessages.get(oldestChannelId);
        channelMessages.delete(oldestChannelId);
        channelMessages.set(oldestChannelId, activeMessages);
        continue;
      }
      channelMessages.delete(oldestChannelId);
      channelPreparedAt.delete(oldestChannelId);
    }
    return channelMessages.get(normalizedChannelId);
  }

  function isChannelPrepared(channelId) {
    const preparedAt = channelPreparedAt.get(String(channelId || ""));
    return (
      Number.isFinite(preparedAt) &&
      Date.now() - preparedAt < PREPARED_CHANNEL_MAX_AGE_MS
    );
  }

  async function prepareChannel(channelId) {
    const preparationGeneration = localDataGeneration;
    const normalizedChannelId = String(channelId || "");
    if (!normalizedChannelId) return false;
    if (isChannelPrepared(normalizedChannelId)) return true;
    if (pendingChannelPreparations.has(normalizedChannelId)) {
      return pendingChannelPreparations.get(normalizedChannelId);
    }

    const preparation = (async () => {
      const authStore = useAuthStore();
      const userData = authStore.getUserData();
      if (!userData?.id) return false;

      try {
        const cached = await getCachedChannelMessages(
          userData.id,
          normalizedChannelId,
        );
        if (preparationGeneration !== localDataGeneration) return false;
        if (cached && Array.isArray(cached.messages)) {
          channelMessages.set(normalizedChannelId, cached.messages);
        }
      } catch (cacheError) {
        console.warn(
          "[ChatStore] Unable to prepare cached channel messages:",
          cacheError,
        );
      }

      if (!navigator.onLine) {
        if (!channelMessages.has(normalizedChannelId)) {
          channelMessages.set(normalizedChannelId, []);
        }
        channelPreparedAt.set(normalizedChannelId, Date.now());
        return true;
      }

      try {
        const apiPath = config.public.apiPath;
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
        if (preparationGeneration !== localDataGeneration) return false;
        const serverMessages = Array.isArray(data.messages)
          ? data.messages
          : Array.isArray(data)
            ? data
            : [];
        const preparedMessages = mergeServerMessagesWithPending(
          serverMessages,
          channelMessages.get(normalizedChannelId) || [],
        );
        channelMessages.set(normalizedChannelId, preparedMessages);
        channelPreparedAt.set(normalizedChannelId, Date.now());
        cacheChannelMessages(
          userData.id,
          normalizedChannelId,
          preparedMessages,
        ).catch((cacheError) => {
          console.warn(
            "[ChatStore] Unable to persist prepared channel messages:",
            cacheError,
          );
        });
        return true;
      } catch (preparationError) {
        if (!channelMessages.has(normalizedChannelId)) return false;
        debugLog(
          "[ChatStore] Using cached messages after preparation failed:",
          preparationError,
        );
        return true;
      }
    })();

    pendingChannelPreparations.set(normalizedChannelId, preparation);
    try {
      return await preparation;
    } finally {
      if (pendingChannelPreparations.get(normalizedChannelId) === preparation) {
        pendingChannelPreparations.delete(normalizedChannelId);
      }
    }
  }

  async function prepareChannels(channelIds, concurrency = 2) {
    const pendingIds = [...new Set(channelIds.map(String))].filter(
      (channelId) => channelId && !isChannelPrepared(channelId),
    );
    let nextIndex = 0;
    const workerCount = Math.min(Math.max(1, concurrency), pendingIds.length);

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (nextIndex < pendingIds.length) {
          const channelId = pendingIds[nextIndex];
          nextIndex += 1;
          await prepareChannel(channelId);
        }
      }),
    );
  }

  function handleServiceWorkerMessage(event) {
    if (event.data.type === "BACKGROUND_SYNC_SUCCESS") {
      handleBackgroundSyncSuccess(event.data.pendingId);
    }
    if (event.data.type === "BACKGROUND_SYNC_FAILURE") {
      handleBackgroundSyncFailure(event.data.pendingId, event.data.status);
    }
  }

  function handleServiceWorkerControllerChange() {
    navigator.serviceWorker.controller?.postMessage({ type: "FORCE_SYNC" });
  }

  if (process.client) {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener(
        "message",
        handleServiceWorkerMessage,
      );
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        handleServiceWorkerControllerChange,
      );
    }
    window.addEventListener("online", handleBrowserOnline);
    window.addEventListener("offline", handleBrowserOffline);
  }

  function closeActiveTransport() {
    const channel = realtimeChannel.value;
    realtimeChannel.value = null;
    if (ws.value) {
      const socket = ws.value;
      ws.value = null;
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close();
      } catch (socketError) {
        console.warn("[ChatStore] Unable to close chat socket:", socketError);
      }
      return;
    }
    if (!channel) return;
    try {
      channel.unsubscribe().then(() => {});
    } catch (socketError) {
      console.warn(
        "[ChatStore] Unable to unsubscribe realtime channel:",
        socketError,
      );
    }
  }

  function handleBrowserOffline() {
    offline.value = true;
    error.value = null;
    connected.value = false;
    connecting.value = false;
    onlineUsers.value = [];
    typingUsers.value = [];
    if (activeFetchController) {
      activeFetchController.abort();
      activeFetchController = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    closeActiveTransport();
  }

  function handleBrowserOnline() {
    offline.value = false;
    error.value = null;
    flushPendingReads();
    if (currentChannelId.value) {
      connectToChannel(
        currentChannelId.value,
        currentChannelName.value,
        currentRoomId.value,
        true,
      );
    }
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      setTimeout(() => {
        requestBackgroundSync();
        navigator.serviceWorker.controller?.postMessage({
          type: "FORCE_SYNC",
        });
      }, 500);
    }
  }

  async function requestBackgroundSync() {
    if (
      hasTauriRuntimeMarker() ||
      !("serviceWorker" in navigator) ||
      !("SyncManager" in window)
    )
      return;
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.sync.register("chat-sync");
    } catch (syncError) {
      debugLog("[ChatStore] Background Sync unavailable:", syncError);
    }
  }

  function triggerManualSync() {
    if (
      !hasTauriRuntimeMarker() &&
      "serviceWorker" in navigator &&
      navigator.serviceWorker.controller
    ) {
      navigator.serviceWorker.controller.postMessage({ type: "FORCE_SYNC" });
    }
  }

  function scheduleReconnect() {
    if (
      !intentionalDisconnect.value &&
      !reconnectTimer &&
      currentChannelId.value
    ) {
      backoffAttempts = Math.min(backoffAttempts + 1, 10);

      const baseDelay = Math.min(
        30000,
        1000 * Math.pow(2, Math.max(0, backoffAttempts - 1)),
      );

      const jitter = 0.8 + Math.random() * 0.4;
      const delay = Math.round(baseDelay * jitter);
      debugLog(
        `[ChatStore] Scheduling reconnect in ${delay}ms (attempt ${backoffAttempts})`,
      );
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (!connected.value && currentChannelId.value) {
          debugLog("[ChatStore] Attempting to reconnect...");
          connectToChannel(
            currentChannelId.value,
            currentChannelName.value,
            currentRoomId.value,
            true,
          );
        }
      }, delay);
    }
  }

  async function connectToChannel(
    channelId,
    channelName = null,
    roomId = null,
    isReconnect = false,
  ) {
    if (
      currentChannelId.value &&
      currentChannelId.value === channelId &&
      connected.value
    ) {
      debugLog(
        "[ChatStore] Already connected to channel, skipping reconnect:",
        channelId,
      );
      return;
    }

    if (connecting.value && currentChannelId.value === channelId) {
      debugLog(
        "[ChatStore] Connect already in progress for channel, skipping:",
        channelId,
      );
      return;
    }

    const generation = isReconnect
      ? connectionGeneration
      : connectionGeneration + 1;
    if (!isReconnect) {
      connectionGeneration = generation;
      disconnectFromChannel(true, true, false);
    }

    connecting.value = true;
    try {
      const authStore = useAuthStore();
      const userData = authStore.getUserData();
      if (!userData || !userData.id) {
        throw new Error("User not authenticated");
      }

      currentChannelId.value = channelId;
      currentChannelName.value = channelName;
      currentRoomId.value = roomId;
      error.value = null;
      onlineUsers.value = [];
      typingUsers.value = [];

      if (pendingChannelPreparations.has(String(channelId))) {
        await pendingChannelPreparations.get(String(channelId));
        if (
          generation !== connectionGeneration ||
          currentChannelId.value !== channelId
        ) {
          return;
        }
      }

      const memoryMessages = channelMessages.get(channelId);
      if (memoryMessages) {
        messages.value = memoryMessages;
        loading.value = false;
      } else {
        messages.value = [];
        loading.value = true;
        try {
          const cached = await getCachedChannelMessages(userData.id, channelId);
          if (
            generation !== connectionGeneration ||
            currentChannelId.value !== channelId
          ) {
            return;
          }
          if (cached && Array.isArray(cached.messages)) {
            channelMessages.set(channelId, cached.messages);
            messages.value = cached.messages;
            loading.value = false;
          }
        } catch (cacheError) {
          console.warn(
            "[ChatStore] Unable to hydrate message cache:",
            cacheError,
          );
        }
      }

      if (!navigator.onLine) {
        offline.value = true;
        channelMessages.set(channelId, messages.value);
        loading.value = false;
        connecting.value = false;
        return;
      }

      offline.value = false;
      if (!isChannelPrepared(channelId)) {
        await fetchMessages(channelId, generation);
      }
      if (
        generation !== connectionGeneration ||
        currentChannelId.value !== channelId
      ) {
        return;
      }

      if (hasTauriRuntimeMarker()) {
        const origin = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
        const websocketPath = config.public.websocketPath || `${origin}/api`;
        const wsUrl = `${websocketPath}/chat/socket?channelId=${encodeURIComponent(channelId)}`;
        const socket = new WebSocket(wsUrl);
        ws.value = socket;
        closeSocketOnPageHide(socket);

        socket.onopen = () => {
          if (
            socket !== ws.value ||
            generation !== connectionGeneration ||
            currentChannelId.value !== channelId
          ) {
            socket.close();
            return;
          }
          connecting.value = false;
          connected.value = true;
          intentionalDisconnect.value = false;
          debugLog(`[ChatStore] Connected to channel ${channelId}`);

          if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
          }
          backoffAttempts = 0;

          if (pingInterval) clearInterval(pingInterval);
          pingInterval = setInterval(() => {
            sendPing();
          }, 30000);
        };

        socket.onmessage = (event) => {
          if (
            socket === ws.value &&
            generation === connectionGeneration &&
            currentChannelId.value === channelId
          ) {
            handleWebSocketMessage(event);
          }
        };

        socket.onclose = (event) => {
          if (
            socket !== ws.value ||
            generation !== connectionGeneration ||
            currentChannelId.value !== channelId
          ) {
            return;
          }
          connecting.value = false;
          connected.value = false;
          if (!navigator.onLine) {
            handleBrowserOffline();
            return;
          }
          try {
            debugLog("[ChatStore] WebSocket connection closed", {
              code: event?.code,
              reason: event?.reason,
            });
          } catch (e) {
            debugLog("[ChatStore] WebSocket connection closed");
          }

          if (pingInterval) {
            clearInterval(pingInterval);
            pingInterval = null;
          }

          scheduleReconnect();
        };

        socket.onerror = (socketError) => {
          if (socket !== ws.value || generation !== connectionGeneration)
            return;
          connecting.value = false;
          if (!navigator.onLine) {
            handleBrowserOffline();
            return;
          }
          console.error("[ChatStore] WebSocket error:", socketError);
          error.value = "Unable to connect to real-time chat";
        };
      } else {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) {
          throw new Error("Supabase Realtime is not configured");
        }
        if (realtimeChannel.value) {
          closeActiveTransport();
        }
        const sessionResult = await supabaseClient.auth.getSession();
        const accessToken = sessionResult.data.session?.access_token;
        if (!accessToken) throw new Error("Supabase session is unavailable");
        supabaseClient.realtime.setAuth(accessToken);
        const supabaseChannel = supabaseClient.channel(`chat:${channelId}`, {
          config: { private: true },
        });
        realtimeChannel.value = supabaseChannel;

        supabaseChannel
          .on("broadcast", { event: "message" }, (payload) => {
            if (
              realtimeChannel.value === supabaseChannel &&
              generation === connectionGeneration &&
              currentChannelId.value === channelId
            ) {
              handleWebSocketMessage({ data: JSON.stringify(payload) });
            }
          })
          .subscribe((status, err) => {
            if (realtimeChannel.value !== supabaseChannel) {
              return;
            }
            if (status === "SUBSCRIBED" || status === "SYNCED") {
              if (
                generation !== connectionGeneration ||
                currentChannelId.value !== channelId
              ) {
                return;
              }
              connecting.value = false;
              connected.value = true;
              intentionalDisconnect.value = false;
              debugLog(`[ChatStore] Connected to channel ${channelId}`);
              if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
              }
              backoffAttempts = 0;
              return;
            }
            if (status === "CHANNEL_ERROR" || status === "CLOSED") {
              connecting.value = false;
              connected.value = false;
              if (!navigator.onLine) {
                handleBrowserOffline();
                return;
              }
              error.value = "Unable to connect to real-time chat";
              scheduleReconnect();
            }
          });
      }

      if (typeof window !== "undefined") {
        try {
          const { usePushSubscription } =
            await import("../composables/usePushSubscription");
          const { updateSubscription, isSupported, isSubscribed } =
            usePushSubscription();
          if (isSupported.value && !isSubscribed.value) {
            await updateSubscription();
            debugLog("[ChatStore] Push subscription updated (global)");
          }
        } catch (err) {
          console.warn("[ChatStore] Failed to update push subscription:", err);
        }
      }
    } catch (err) {
      connecting.value = false;
      if (!navigator.onLine) {
        handleBrowserOffline();
      } else {
        error.value = err.message;
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
      currentChannelId.value &&
      currentChannelId.value !== expectedChannelId
    ) {
      return false;
    }

    if (invalidateGeneration) connectionGeneration += 1;
    intentionalDisconnect.value = !!intentional;

    if (ws.value || realtimeChannel.value) {
      try {
        closeActiveTransport();
      } catch (e) {
        console.warn("[ChatStore] Error closing chat transport cleanly:", e);
      }
    }
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (activeFetchController) {
      activeFetchController.abort();
      activeFetchController = null;
    }

    connecting.value = false;
    connected.value = false;
    currentChannelId.value = null;
    currentChannelName.value = null;
    currentRoomId.value = null;
    if (!preserveMessages) messages.value = [];
    onlineUsers.value = [];
    typingUsers.value = [];
    return true;
  }

  async function handleWebSocketMessage(event) {
    try {
      const data = JSON.parse(event.data);
      switch (data.type) {
        case "connected":
          break;
        case "new_message":
          if (reconcileIncomingMessage(messages.value, data.data).inserted) {
            messages.value = boundedMessages(
              messages.value,
              ACTIVE_CHANNEL_MESSAGE_LIMIT,
            );
            setChannelMessages(currentChannelId.value, messages.value, true);
            handleNewMessageNotification(data.data);
          }
          break;
        case "message_updated":
          debugLog("[ChatStore] Message updated:", data.data);
          updateMessage(data.data);
          break;
        case "message_deleted":
          debugLog("[ChatStore] Message deleted:", data.data);
          removeMessage(data.data.id);
          break;
        case "channel_updated":
          debugLog("[ChatStore] Channel updated:", data.data);
          break;
        case "channel_deleted":
          debugLog("[ChatStore] Channel deleted:", data.data);
          disconnectFromChannel(true);
          break;
        case "user_typing":
          debugLog("[ChatStore] User typing status:", data.data);
          updateTypingStatus(data.data.userId, data.data.isTyping);
          break;
        case "pong":
          break;
        case "currentlyInChannel":
        case "currentlyInRoom":
          debugLog("[ChatStore] Received online users update:", data.inRoom);
          if (Array.isArray(data.inRoom)) {
            onlineUsers.value = data.inRoom.map((u) =>
              typeof u === "string" ? { id: u } : u,
            );
            debugLog("[ChatStore] Updated onlineUsers:", onlineUsers.value);
          }
          break;
        case "user_joined":
        case "user_left":
          debugLog("[ChatStore] User presence change:", data.type, data);
          break;
        case "participant_change":
          debugLog("[ChatStore] Participant change detected:", data);
          await handleParticipantChange();
          break;
        case "message_reaction_added":
        case "message_reaction_removed":
          debugLog("[ChatStore] Reaction event:", data.type, data.data);
          reactionChanged.value = {
            messageId: data.data?.messageId,
            type: data.type,
            ts: Date.now(),
          };
          break;
        case "message_pinned":
        case "message_unpinned":
          updateMessage({
            id: data.data.messageId,
            pinned: data.type === "message_pinned",
          });
          pinChanged.value = {
            messageId: data.data.messageId,
            channelId: data.data.channelId,
            pinned: data.type === "message_pinned",
            ts: Date.now(),
          };
          break;
        case "channel_policy_updated":
          useChannelsStore().applyRealtimePolicy(
            data.data.channelId,
            data.data,
          );
          break;
        case "notification_created":
        case "notifications_read":
          useNotificationsStore().receiveRealtime(data);
          break;
        default:
          debugLog("[ChatStore] Unknown message type:", data.type);
      }
    } catch (err) {
      console.error(
        "[ChatStore] Error parsing WebSocket message:",
        err,
        event.data,
      );
    }
  }

  async function handleParticipantChange() {
    try {
      debugLog(
        "[ChatStore] Handling participant change - refreshing room data",
      );

      if (currentRoomId.value) {
        const roomsStore = useRoomsStore();

        await roomsStore.fetchRooms();
        debugLog("[ChatStore] Room data refreshed after participant change");
      } else {
        debugLog("[ChatStore] No current room ID, skipping room refresh");
      }
    } catch (error) {
      console.error("[ChatStore] Error handling participant change:", error);
    }
  }

  async function fetchMessages(channelId, generation = connectionGeneration) {
    const hasVisibleMessages =
      currentChannelId.value === channelId && messages.value.length > 0;
    loading.value = !hasVisibleMessages;
    error.value = null;
    if (activeFetchController) activeFetchController.abort();
    const controller = new AbortController();
    activeFetchController = controller;

    try {
      const authStore = useAuthStore();
      const userData = authStore.getUserData();

      if (!userData || !userData.id) {
        throw new Error("User not authenticated");
      }

      const apiPath = config.public.apiPath;
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
        generation !== connectionGeneration ||
        currentChannelId.value !== channelId
      ) {
        return;
      }
      let nextMessages;
      if (Array.isArray(data.messages)) {
        nextMessages = data.messages;
      } else if (Array.isArray(data)) {
        nextMessages = data;
      } else {
        nextMessages = [];
      }
      nextMessages = mergeServerMessagesWithPending(
        nextMessages,
        channelMessages.get(channelId) ||
          (currentChannelId.value === channelId ? messages.value : []),
      );
      nextMessages = setChannelMessages(channelId, nextMessages, true);
      channelPreparedAt.set(String(channelId), Date.now());
      messages.value = nextMessages;
      cacheChannelMessages(userData.id, channelId, nextMessages).catch(
        (cacheError) => {
          console.warn(
            "[ChatStore] Unable to persist message cache:",
            cacheError,
          );
        },
      );

      try {
        await hydratePendingReadIds(userData.id);
        const alreadyReadIds = messages.value
          .filter(
            (msg) =>
              Array.isArray(msg.read_by) && msg.read_by.includes(userData.id),
          )
          .map((msg) => msg.id);
        const originalSize = pendingReadIds.size;
        for (const messageId of alreadyReadIds) {
          pendingReadIds.delete(messageId);
        }
        if (pendingReadIds.size !== originalSize) {
          await persistPendingReadIds(userData.id);
        }
      } catch (e) {
        console.warn("[ChatStore] Failed to reconcile local unread IDs:", e);
      }
    } catch (err) {
      if (!navigator.onLine) {
        handleBrowserOffline();
      } else if (
        err.name !== "AbortError" &&
        generation === connectionGeneration
      ) {
        error.value = err.message;
        console.error("[ChatStore] Error fetching messages:", err);
      }
    } finally {
      if (activeFetchController === controller) {
        activeFetchController = null;
      }
      if (
        generation === connectionGeneration &&
        currentChannelId.value === channelId
      ) {
        loading.value = false;
      }
    }
  }

  async function sendMessage(channelId, content, options = {}) {
    const { attachments = [], replyTo = null } = options;
    const channelsStore = useChannelsStore();
    const { canSend, slowModeSeconds } =
      channelsStore.getChannelSendPermission(channelId);

    if (!canSend) {
      throw new Error(
        "You do not have permission to send messages in this channel",
      );
    }

    if (slowModeSeconds > 0 && connected.value) {
      const lastMessageFromUser = messages.value
        .filter((m) => {
          const senderId = m.sender?.id || m.sender;
          const auth = useAuthStore();
          return String(senderId) === String(auth.getUserData()?.id);
        })
        .pop();
      const lastMsgAt = lastMessageFromUser?.created
        ? new Date(lastMessageFromUser.created).getTime()
        : 0;
      if (isSlowModeCooldownActive(lastMsgAt, slowModeSeconds)) {
        const remaining = Math.ceil(
          slowModeRemainingMs(lastMsgAt, slowModeSeconds) / 1000,
        );
        throw new Error(
          `Slow mode enabled. Please wait ${remaining} seconds before sending another message.`,
        );
      }
    }

    let pendingMessage = null;
    try {
      const authStore = useAuthStore();
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
          id: userData.id,
          name: userData.name || "You",
          email: userData.email,
        },
        created,
        updated: created,
        read_by: [userData.id],
        client_id: clientMessageId,
        attachments,
        reply_to: replyTo,
        status: "pending",
      };

      messages.value.push(pendingMessage);
      messages.value = boundedMessages(
        messages.value,
        ACTIVE_CHANNEL_MESSAGE_LIMIT,
      );
      setChannelMessages(channelId, messages.value, true);
      cacheChannelMessages(userData.id, channelId, messages.value).catch(
        (cacheError) => {
          console.warn(
            "[ChatStore] Unable to persist pending message:",
            cacheError,
          );
        },
      );

      if (!navigator.onLine) {
        const queuedMessage = {
          id: clientMessageId,
          channelId,
          content,
          ownerId: userData.id,
          pendingId: pendingMessage.id,
          attachments,
          replyTo,
        };
        await enqueueMessage(queuedMessage);
        requestBackgroundSync();
        return { status: "queued-offline", id: queuedMessage.id };
      }

      try {
        const apiPath = config.public.apiPath;
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
            ...(replyTo && { replyTo }),
          }),
        });

        if (!response.ok) {
          const deliveryError = await chatResponseError(response);
          deliveryError.retryable =
            response.status === 408 || response.status >= 500;
          throw deliveryError;
        }

        const message = await response.json();

        reconcileSentMessage(messages.value, pendingMessage.id, message);

        return message;
      } catch (fetchError) {
        if (fetchError.retryable === false) {
          removeMessage(pendingMessage.id, clientMessageId);
          throw fetchError;
        }
        const queuedMessage = {
          id: clientMessageId,
          channelId,
          content,
          ownerId: userData.id,
          pendingId: pendingMessage.id,
          attachments,
          replyTo,
        };
        await enqueueMessage(queuedMessage);
        requestBackgroundSync();
        return { status: "queued-error", error: fetchError.message };
      }
    } catch (err) {
      if (pendingMessage && err instanceof IdbOperationError) {
        pendingMessage.status = "failed";
        pendingMessage.error = err.message;
      } else {
        error.value = err.message;
      }
      console.error("[ChatStore] Error sending message:", err);
      throw err;
    }
  }

  function markMessageAsRead(messageId) {
    const userData = useAuthStore().getUserData();
    if (!userData?.id) return;
    const message = messages.value.find((item) => item.id === messageId);
    if (!message || message.sender?.id === userData.id) return;
    if (hasReader(message.read_by, userData.id)) return;

    message.read_by = addReader(message.read_by, userData);
    pendingReadIds.add(messageId);
    void persistPendingReadIds(userData.id);
    scheduleReadFlush();
  }

  function legacyReadStorageKey(userId) {
    return `dspeak2_unread_message_ids_${userId}`;
  }

  async function hydratePendingReadIds(userId) {
    if (pendingReadHydration) return pendingReadHydration;
    pendingReadHydration = (async () => {
      const stored = await getPendingReadIds(userId);
      let legacy = [];
      try {
        legacy = JSON.parse(
          localStorage.getItem(legacyReadStorageKey(userId)) || "[]",
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
        pendingReadIds.add(String(messageId));
      }
      if (Array.isArray(legacy) && legacy.length > 0) {
        await persistPendingReadIds(userId);
      }
      try {
        localStorage.removeItem(legacyReadStorageKey(userId));
      } catch (storageError) {
        console.warn(
          "[ChatStore] Unable to remove legacy pending read state:",
          storageError,
        );
      }
    })().catch((storageError) => {
      pendingReadHydration = null;
      console.warn(
        "[ChatStore] Unable to restore pending read state:",
        storageError,
      );
    });
    return pendingReadHydration;
  }

  function persistPendingReadIds(userId) {
    const snapshot = [...pendingReadIds];
    pendingReadPersistence = pendingReadPersistence
      .catch(() => {})
      .then(() => savePendingReadIds(userId, snapshot))
      .catch((storageError) => {
        console.warn(
          "[ChatStore] Unable to persist pending read state:",
          storageError,
        );
      });
    return pendingReadPersistence;
  }

  function scheduleReadFlush() {
    if (readFlushTimer || readFlushPromise || !navigator.onLine) return;
    readFlushTimer = setTimeout(() => {
      readFlushTimer = null;
      flushPendingReads();
    }, 400);
  }

  async function flushPendingReads() {
    if (readFlushPromise) return readFlushPromise;
    const userData = useAuthStore().getUserData();
    if (!userData?.id || !navigator.onLine) return;
    await hydratePendingReadIds(userData.id);
    const messageIds = [...pendingReadIds].slice(0, 200);
    if (messageIds.length === 0) return;
    const flushGeneration = localDataGeneration;

    readFlushPromise = (async () => {
      const response = await fetch(`${config.public.apiPath}/chat/read`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messageIds }),
      });
      if (!response.ok) {
        throw new Error(`Failed to update read state: ${response.status}`);
      }
      const payload = await response.json();
      if (flushGeneration !== localDataGeneration) return;
      for (const result of payload.results || []) {
        if (
          result.status === "marked_as_read" ||
          result.status === "already_read"
        ) {
          pendingReadIds.delete(result.messageId);
        }
      }
      await persistPendingReadIds(userData.id);
      useChannelsStore().fetchUnreadCounts();
    })()
      .catch((readError) => {
        console.error("[ChatStore] Unable to update read state:", readError);
      })
      .finally(() => {
        readFlushPromise = null;
        if (
          [...pendingReadIds].some(
            (messageId) => !messageIds.includes(messageId),
          )
        ) {
          scheduleReadFlush();
        }
      });
    return readFlushPromise;
  }

  function sendTypingIndicator(isTyping) {
    debugLog("[ChatStore] Sending typing indicator:", {
      isTyping,
      connected: connected.value,
    });
    if (ws.value && connected.value) {
      const message = {
        type: "typing",
        isTyping,
      };
      ws.value.send(JSON.stringify(message));
    } else {
      debugLog("[ChatStore] Cannot send typing indicator - not connected");
    }
  }

  function sendPing() {
    if (ws.value && connected.value) {
      ws.value.send(
        JSON.stringify({
          type: "ping",
        }),
      );
    }
  }

  function updateMessageReadBy(messageId, readBy) {
    const messageIndex = messages.value.findIndex(
      (msg) => msg.id === messageId,
    );
    if (messageIndex !== -1) {
      messages.value[messageIndex].read_by = mergeReaders(
        messages.value[messageIndex].read_by,
        readBy,
      );
    }
  }

  function updateMessage(update) {
    const message = messages.value.find((item) => item.id === update.id);
    if (!message) return;
    const readBy = update.read_by;
    Object.assign(message, update);
    if (readBy) message.read_by = mergeReaders(message.read_by, readBy);
  }

  async function chatResponseError(response) {
    return new Error(
      chatApiErrorMessage(await response.text(), response.status),
    );
  }

  async function editMessage(messageId, content) {
    const response = await fetch(`${config.public.apiPath}/chat/message/edit`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId, content }),
    });
    if (!response.ok) throw await chatResponseError(response);
    const result = await response.json();
    updateMessage(result);
    return result;
  }

  async function deleteMessage(messageId) {
    const targetMessage = messages.value.find(
      (message) => message.id === messageId,
    );
    const clientId = targetMessage?.client_id || "";
    const isPending = targetMessage?.status === "pending";
    const response = await fetch(
      `${config.public.apiPath}/chat/message/delete`,
      {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      },
    );
    if (!response.ok) {
      if (response.status === 404 && isPending) {
        const pendingClientId = pendingMessageClientId(targetMessage);
        if (pendingClientId) {
          try {
            await dequeueMessage(pendingClientId);
          } catch (queueError) {
            console.warn(
              "[ChatStore] Unable to remove stale message from delivery queue:",
              queueError,
            );
          }
        }
        removeMessage(messageId, pendingClientId);
        return;
      }
      throw await chatResponseError(response);
    }
    removeMessage(messageId, clientId);
  }

  async function fetchMessageHistory(messageId) {
    const response = await fetch(
      `${config.public.apiPath}/chat/message/history?messageId=${encodeURIComponent(messageId)}`,
      { credentials: "include" },
    );
    if (!response.ok) throw await chatResponseError(response);
    return response.json();
  }

  function removeMessage(messageId, clientId = "") {
    removeMessageAliases(messages.value, messageId, clientId);
    const userId = useAuthStore().getUserData()?.id;
    const channelId = currentChannelId.value;
    if (!userId || !channelId) return;
    setChannelMessages(channelId, messages.value, true);
    cacheChannelMessages(userId, channelId, messages.value).catch(
      (cacheError) => {
        console.warn(
          "[ChatStore] Unable to persist deleted message cache:",
          cacheError,
        );
      },
    );
  }

  function updateTypingStatus(userId, isTyping) {
    const authStore = useAuthStore();
    const userData = authStore.getUserData();

    debugLog("[ChatStore] Typing status update:", {
      userId,
      isTyping,
      currentUser: userData?.id,
    });

    if (userData && userId === userData.id) {
      debugLog("[ChatStore] Ignoring typing status for current user");
      return;
    }

    if (isTyping) {
      if (!typingUsers.value.includes(userId)) {
        debugLog("[ChatStore] Adding user to typing list:", userId);
        typingUsers.value.push(userId);
      }
    } else {
      const index = typingUsers.value.indexOf(userId);
      if (index !== -1) {
        debugLog("[ChatStore] Removing user from typing list:", userId);
        typingUsers.value.splice(index, 1);
      }
    }

    debugLog("[ChatStore] Current typing users:", typingUsers.value);
  }

  function clearChat() {
    localDataGeneration += 1;
    const pendingStorageCleanup = (async () => {
      await pendingReadHydration;
      await pendingReadPersistence;
    })();
    disconnectFromChannel(true);
    if (readFlushTimer) {
      clearTimeout(readFlushTimer);
      readFlushTimer = null;
    }
    pendingReadIds.clear();
    pendingReadHydration = null;
    channelMessages.clear();
    pendingChannelPreparations.clear();
    channelPreparedAt.clear();
    messages.value = [];
    error.value = null;
    onlineUsers.value = [];
    typingUsers.value = [];
    return pendingStorageCleanup;
  }

  async function handleNewMessageNotification(message) {
    try {
      const authStore = useAuthStore();
      const userData = authStore.getUserData();

      if (userData && message.sender.id === userData.id) {
        debugLog("[ChatStore] Skipping notification for own message");
        return;
      }

      debugLog("[ChatStore] Checking notification conditions...");
      debugLog(
        "[ChatStore] Page visibility - hidden:",
        document.hidden,
        "focused:",
        document.hasFocus(),
      );

      const notificationManager = (await import("../utils/notificationManager"))
        .default;

      debugLog("[ChatStore] Notification settings:");
      debugLog("  - Supported:", notificationManager.isSupported);
      debugLog("  - Enabled:", notificationManager.isEnabled);
      debugLog("  - Permission:", notificationManager.permission);
      debugLog(
        "  - Should show:",
        notificationManager.shouldShowNotification(),
      );

      if (notificationManager.isSupported && notificationManager.isEnabled) {
        debugLog(
          "[ChatStore] Attempting to show notification for message:",
          message,
        );

        const notification = notificationManager.showMessageNotification(
          message,
          currentChannelName.value,
        );

        if (notification) {
          debugLog("[ChatStore] Notification created successfully");
          notification.onclick = () => {
            debugLog("[ChatStore] Notification clicked - focusing window");
            window.focus();
            notification.close();
          };
        } else {
          debugLog("[ChatStore] Notification creation returned null");
        }
      } else {
        debugLog(
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

  function handleBackgroundSyncSuccess(pendingId) {
    const authStore = useAuthStore();
    const userId = authStore.getUserData()?.id;
    for (const [channelId, cachedMessages] of channelMessages) {
      const nextMessages = cachedMessages.filter(
        (message) => message.id !== pendingId,
      );
      if (nextMessages.length === cachedMessages.length) continue;
      channelMessages.set(channelId, nextMessages);
      if (currentChannelId.value === channelId) {
        messages.value = nextMessages;
      }
      if (userId) {
        cacheChannelMessages(userId, channelId, nextMessages).catch(
          (cacheError) => {
            console.warn(
              "[ChatStore] Unable to reconcile synced message cache:",
              cacheError,
            );
          },
        );
      }
    }
  }

  function handleBackgroundSyncFailure(pendingId, status) {
    for (const cachedMessages of channelMessages.values()) {
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

  async function fetchBookmarks() {
    try {
      const apiPath = config.public.apiPath;
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
      const apiPath = config.public.apiPath;
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
      const apiPath = config.public.apiPath;
      const params = new URLSearchParams({ channelId, q: query });
      if (filters?.author) params.set("author", filters.author);
      if (filters?.has) params.set("has", filters.has);
      if (filters?.before) params.set("before", filters.before);
      if (filters?.after) params.set("after", filters.after);
      const response = await fetch(`${apiPath}/chat/search?${params}`, {
        credentials: "include",
      });
      if (!response.ok) throw await chatResponseError(response);
      return await response.json();
    } catch (err) {
      console.error("[ChatStore] Failed to search messages:", err);
      throw err;
    }
  }

  async function undoMessage(messageId) {
    try {
      const apiPath = config.public.apiPath;
      const response = await fetch(`${apiPath}/chat/message/undo`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      if (!response.ok) throw await chatResponseError(response);
      removeMessage(messageId);
      return await response.json();
    } catch (err) {
      console.error("[ChatStore] Failed to undo message:", err);
      throw err;
    }
  }

  onScopeDispose(() => {
    if (!process.client) return;
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.removeEventListener(
        "message",
        handleServiceWorkerMessage,
      );
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        handleServiceWorkerControllerChange,
      );
    }
    window.removeEventListener("online", handleBrowserOnline);
    window.removeEventListener("offline", handleBrowserOffline);
    disconnectFromChannel();
  });

  return {
    messages,
    loading,
    error,
    connected,
    offline,
    currentChannelId,
    currentChannelName,
    currentRoomId,
    onlineUsers,
    typingUsers,
    prepareChannel,
    prepareChannels,
    connectToChannel,
    disconnectFromChannel,
    fetchMessages,
    sendMessage,
    editMessage,
    deleteMessage,
    fetchMessageHistory,
    markMessageAsRead,
    sendTypingIndicator,
    sendPing,
    fetchBookmarks,
    fetchPinned,
    searchMessages,
    undoMessage,
    clearChat,
    handleBackgroundSyncSuccess,
    triggerManualSync,
    reactionChanged,
    pinChanged,
  };
});
