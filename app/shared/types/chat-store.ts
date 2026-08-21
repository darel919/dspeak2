import type { ExternalValue } from "./boundary.ts";

import type { MediaCommandResult } from "./boundary.ts";

import type { Ref } from "vue";
import type { RealtimeChannelLike } from "../realtime-channel.ts";
import type { ChatMessageInput } from "./composables.ts";
import type { ReaderValue } from "./shared-utilities.ts";

export interface ChatSender {
  id: string;
  name?: string;
  email?: string;
}

export interface ChatMessage extends Omit<ChatMessageInput, "sender"> {
  id: string;
  content: string;
  room_channel?: string;
  channelId?: string;
  sender?: ChatSender | null;
  created?: string | number | Date;
  updated?: string | number | Date;
  read_by?: ReaderValue[];
  client_id?: string;
  attachments?: unknown[];
  reply_to?: unknown;
  status?: string;
  error?: string;
  pinned?: boolean;
  deleted?: boolean;
  [key: string]: unknown;
}

export interface ChatSendOptions {
  attachments?: unknown[];
  replyTo?: unknown;
}

export interface ChatEventData extends Partial<ChatMessage> {
  messageId?: string;
  channelId?: string;
  userId?: string;
  isTyping?: boolean;
}

export interface ChatEventEnvelope {
  type?: string;
  data?: ChatEventData;
  inRoom?: Array<string | { id: string; [key: string]: unknown }>;
}

export interface ChatDeliveryError extends Error {
  retryable?: boolean;
}

export interface ChatRuntime {
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  backoffAttempts: number;
  connectionGeneration: number;
  activeFetchController: AbortController | null;
  readFlushTimer: ReturnType<typeof setTimeout> | null;
  readFlushPromise: Promise<void> | null;
  pendingReadHydration: Promise<void> | null;
  pendingReadPersistence: Promise<void>;
  localDataGeneration: number;
  pageHideRemoveListener: (() => void) | null;
}

export interface ChatDependencies {
  useAuthStore: typeof import("../../stores/auth.ts").useAuthStore;
  useRoomsStore: typeof import("../../stores/rooms.ts").useRoomsStore;
  useChannelsStore: typeof import("../../stores/channels.ts").useChannelsStore;
  useNotificationsStore: typeof import("../../stores/notifications.ts").useNotificationsStore;
  cacheChannelMessages: typeof import("../../utils/idb.ts").cacheChannelMessages;
  dequeueMessage: typeof import("../../utils/idb.ts").dequeueMessage;
  enqueueMessage: typeof import("../../utils/idb.ts").enqueueMessage;
  getCachedChannelMessages: typeof import("../../utils/idb.ts").getCachedChannelMessages;
  getPendingReadIds: typeof import("../../utils/idb.ts").getPendingReadIds;
  IdbOperationError: typeof import("../../utils/idb.ts").IdbOperationError;
  savePendingReadIds: typeof import("../../utils/idb.ts").savePendingReadIds;
  addReader: typeof import("../../shared/read-receipts.ts").addReader;
  hasReader: typeof import("../../shared/read-receipts.ts").hasReader;
  mergeReaders: typeof import("../../shared/read-receipts.ts").mergeReaders;
  chatApiErrorMessage: typeof import("../../shared/chat-messages.ts").chatApiErrorMessage;
  mergeServerMessagesWithPending: typeof import("../../shared/chat-messages.ts").mergeServerMessagesWithPending;
  pendingMessageClientId: typeof import("../../shared/chat-messages.ts").pendingMessageClientId;
  removeMessageAliases: typeof import("../../shared/chat-messages.ts").removeMessageAliases;
  reconcileIncomingMessage: typeof import("../../shared/chat-messages.ts").reconcileIncomingMessage;
  reconcileSentMessage: typeof import("../../shared/chat-messages.ts").reconcileSentMessage;
  isSlowModeCooldownActive: typeof import("../../../shared/channel-policy.ts").isSlowModeCooldownActive;
  slowModeRemainingMs: typeof import("../../../shared/channel-policy.ts").slowModeRemainingMs;
  debugLog: typeof import("../../shared/debug.ts").debugLog;
  hasTauriRuntimeMarker: () => boolean;
  getSupabaseClient: typeof import("../../utils/supabase-client.ts").getSupabaseClient;
}

export interface ChatActionSet {
  boundedMessages: (items: ChatMessage[], limit: number) => ChatMessage[];
  setChannelMessages: (
    channelId: string | null,
    items: ChatMessage[],
    active?: boolean,
  ) => ChatMessage[];
  isChannelPrepared: (channelId: string) => boolean;
  prepareChannel: (channelId: string) => Promise<boolean>;
  prepareChannels: (
    channelIds: string[],
    concurrency?: number,
  ) => Promise<void>;
  fetchMessages: (channelId: string, generation?: number) => Promise<void>;
  handleBackgroundSyncSuccess: (pendingId: string) => void;
  handleBackgroundSyncFailure: (pendingId: string, status: number) => void;
  handleServiceWorkerMessage: (event: {
    data: { type?: string; pendingId?: string; status?: number };
  }) => void;
  handleServiceWorkerControllerChange: () => void;
  closeActiveTransport: () => void;
  joinChannelMembership: (channelId: string) => void;
  registerPageHideLeave: () => void;
  leaveChannelMembership: (channelId: string | null) => void;
  handleBrowserOffline: () => void;
  handleBrowserOnline: () => void;
  requestBackgroundSync: () => Promise<void>;
  triggerManualSync: () => void;
  scheduleReconnect: () => void;
  connectToChannel: (
    channelId: string,
    channelName?: string | null,
    roomId?: string | null,
    isReconnect?: boolean,
  ) => Promise<void>;
  disconnectFromChannel: (
    intentional?: boolean,
    preserveMessages?: boolean,
    invalidateGeneration?: boolean,
    expectedChannelId?: string | null,
  ) => boolean | undefined;
  handleWebSocketMessage: (event: { data: ExternalValue }) => Promise<void>;
  handleParticipantChange: () => Promise<void>;
  sendMessage: (
    channelId: string,
    content: string,
    options?: ChatSendOptions,
  ) => Promise<MediaCommandResult>;
  updateMessageReadBy: (
    messageId: string,
    readBy: string[] | undefined,
  ) => void;
  updateMessage: (message: ChatMessage) => void;
  chatResponseError: (response: Response) => Promise<ChatDeliveryError>;
  editMessage: (messageId: string, content: string) => Promise<ChatMessage>;
  deleteMessage: (messageId: string) => Promise<void>;
  fetchMessageHistory: (messageId: string) => Promise<MediaCommandResult>;
  removeMessage: (messageId: string, clientId?: string) => void;
  updateTypingStatus: (userId: string, isTyping: boolean) => void;
  markMessageAsRead: (messageId: string) => void;
  hydratePendingReadIds: (userId: string) => Promise<void>;
  persistPendingReadIds: (userId: string) => Promise<void>;
  scheduleReadFlush: () => void;
  flushPendingReads: () => Promise<void>;
  sendTypingIndicator: (isTyping: boolean) => void;
  clearChat: () => Promise<void>;
  handleNewMessageNotification: (message: ChatMessage) => Promise<void>;
  fetchBookmarks: () => Promise<MediaCommandResult>;
  fetchPinned: (channelId: string) => Promise<MediaCommandResult>;
  searchMessages: (
    channelId: string,
    query: string,
    filters?: {
      author?: string;
      has?: string;
      before?: string;
      after?: string;
    },
  ) => Promise<MediaCommandResult>;
  undoMessage: (messageId: string) => Promise<MediaCommandResult>;
  legacyReadStorageKey: (userId: string) => string;
}

export interface ChatStoreContext extends ChatActionSet {
  messages: Ref<ChatMessage[]>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  realtimeChannel: Ref<RealtimeChannelLike | null>;
  connected: Ref<boolean>;
  connecting: Ref<boolean>;
  intentionalDisconnect: Ref<boolean>;
  currentChannelId: Ref<string | null>;
  currentChannelName: Ref<string | null>;
  currentRoomId: Ref<string | null>;
  onlineUsers: Ref<Array<{ id: string; [key: string]: unknown }>>;
  typingUsers: Ref<string[]>;
  offline: Ref<boolean>;
  reactionChanged: Ref<Record<string, unknown> | null>;
  pinChanged: Ref<Record<string, unknown> | null>;
  config: { public: { apiPath: string } };
  pendingReadIds: Set<string>;
  channelMessages: Map<string, ChatMessage[]>;
  pendingChannelPreparations: Map<string, Promise<boolean>>;
  channelPreparedAt: Map<string, number>;
  PREPARED_CHANNEL_MAX_AGE_MS: number;
  ACTIVE_CHANNEL_MESSAGE_LIMIT: number;
  INACTIVE_CHANNEL_MESSAGE_LIMIT: number;
  CHANNEL_MEMORY_LIMIT: number;
  runtime: ChatRuntime;
  dependencies: ChatDependencies;
}
