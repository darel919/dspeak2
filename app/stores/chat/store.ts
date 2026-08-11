import { defineStore } from "pinia";
import { useRuntimeConfig } from "#app";
import { onScopeDispose, ref } from "vue";
import { useAuthStore } from "../auth";
import { useRoomsStore } from "../rooms";
import { useChannelsStore } from "../channels";
import { useNotificationsStore } from "../notifications";
import {
  cacheChannelMessages,
  dequeueMessage,
  enqueueMessage,
  getCachedChannelMessages,
  getPendingReadIds,
  IdbOperationError,
  savePendingReadIds,
} from "../../utils/idb";
import { addReader, hasReader, mergeReaders } from "../../shared/read-receipts";
import {
  chatApiErrorMessage,
  mergeServerMessagesWithPending,
  pendingMessageClientId,
  removeMessageAliases,
  reconcileIncomingMessage,
  reconcileSentMessage,
} from "../../shared/chat-messages";
import {
  isSlowModeCooldownActive,
  slowModeRemainingMs,
} from "~~/shared/channel-policy.ts";
import { debugLog } from "../../shared/debug";
import { hasTauriRuntimeMarker } from "../../shared/desktop-capture.ts";
import { getSupabaseClient } from "../../utils/supabase-client.ts";
import { createChatCacheActions } from "./cache.ts";
import { createChatExtraActions } from "./extras.ts";
import { createChatMessageActions } from "./messages.ts";
import { createChatReadActions } from "./reads.ts";
import { createChatTransportActions } from "./transport.ts";

export const useChatStore = defineStore("chat", () => {
  const messages = ref([]);
  const loading = ref(false);
  const error = ref(null);
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

  const runtime = {
    reconnectTimer: null,
    backoffAttempts: 0,
    connectionGeneration: 0,
    activeFetchController: null,
    readFlushTimer: null,
    readFlushPromise: null,
    pendingReadHydration: null,
    pendingReadPersistence: Promise.resolve(),
    localDataGeneration: 0,
    pageHideRemoveListener: null,
  };
  const pendingReadIds = new Set();
  const channelMessages = new Map();
  const pendingChannelPreparations = new Map();
  const channelPreparedAt = new Map();
  const dependencies = {
    useAuthStore,
    useRoomsStore,
    useChannelsStore,
    useNotificationsStore,
    cacheChannelMessages,
    dequeueMessage,
    enqueueMessage,
    getCachedChannelMessages,
    getPendingReadIds,
    IdbOperationError,
    savePendingReadIds,
    addReader,
    hasReader,
    mergeReaders,
    chatApiErrorMessage,
    mergeServerMessagesWithPending,
    pendingMessageClientId,
    removeMessageAliases,
    reconcileIncomingMessage,
    reconcileSentMessage,
    isSlowModeCooldownActive,
    slowModeRemainingMs,
    debugLog,
    hasTauriRuntimeMarker,
    getSupabaseClient,
  };
  const context: any = {
    messages,
    loading,
    error,
    realtimeChannel,
    connected,
    connecting,
    intentionalDisconnect,
    currentChannelId,
    currentChannelName,
    currentRoomId,
    onlineUsers,
    typingUsers,
    offline,
    reactionChanged,
    pinChanged,
    config,
    pendingReadIds,
    channelMessages,
    pendingChannelPreparations,
    channelPreparedAt,
    PREPARED_CHANNEL_MAX_AGE_MS: 15000,
    ACTIVE_CHANNEL_MESSAGE_LIMIT: 1000,
    INACTIVE_CHANNEL_MESSAGE_LIMIT: 300,
    CHANNEL_MEMORY_LIMIT: 8,
    runtime,
    dependencies,
  };

  Object.assign(
    context,
    createChatCacheActions(context),
    createChatTransportActions(context),
    createChatMessageActions(context),
    createChatReadActions(context),
    createChatExtraActions(context),
  );

  if (process.client) {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener(
        "message",
        context.handleServiceWorkerMessage,
      );
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        context.handleServiceWorkerControllerChange,
      );
    }
    window.addEventListener("online", context.handleBrowserOnline);
    window.addEventListener("offline", context.handleBrowserOffline);
  }

  onScopeDispose(() => {
    if (!process.client) return;
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.removeEventListener(
        "message",
        context.handleServiceWorkerMessage,
      );
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        context.handleServiceWorkerControllerChange,
      );
    }
    window.removeEventListener("online", context.handleBrowserOnline);
    window.removeEventListener("offline", context.handleBrowserOffline);
    context.disconnectFromChannel();
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
    prepareChannel: context.prepareChannel,
    prepareChannels: context.prepareChannels,
    connectToChannel: context.connectToChannel,
    disconnectFromChannel: context.disconnectFromChannel,
    fetchMessages: context.fetchMessages,
    sendMessage: context.sendMessage,
    editMessage: context.editMessage,
    deleteMessage: context.deleteMessage,
    fetchMessageHistory: context.fetchMessageHistory,
    markMessageAsRead: context.markMessageAsRead,
    sendTypingIndicator: context.sendTypingIndicator,
    fetchBookmarks: context.fetchBookmarks,
    fetchPinned: context.fetchPinned,
    searchMessages: context.searchMessages,
    undoMessage: context.undoMessage,
    clearChat: context.clearChat,
    handleBackgroundSyncSuccess: context.handleBackgroundSyncSuccess,
    triggerManualSync: context.triggerManualSync,
    reactionChanged,
    pinChanged,
  };
});
