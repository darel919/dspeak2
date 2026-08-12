import type { Ref } from "vue";
import type { RealtimeChannelLike } from "../realtime-channel.ts";
import type { ChatMessageInput } from "./composables.ts";

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
  read_by?: string[];
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
  cacheChannelMessages: (...args: unknown[]) => Promise<unknown>;
  dequeueMessage: (...args: unknown[]) => Promise<unknown>;
  enqueueMessage: (...args: unknown[]) => Promise<unknown>;
  getCachedChannelMessages: (
    ...args: unknown[]
  ) => Promise<{ messages?: ChatMessage[] } | null>;
  getPendingReadIds: (...args: unknown[]) => Promise<string[]>;
  IdbOperationError: new (...args: never[]) => Error;
  savePendingReadIds: (...args: unknown[]) => Promise<unknown>;
  addReader: (...args: unknown[]) => string[];
  hasReader: (...args: unknown[]) => boolean;
  mergeReaders: (...args: unknown[]) => string[];
  chatApiErrorMessage: (...args: unknown[]) => string;
  mergeServerMessagesWithPending: (
    serverMessages: ChatMessage[],
    pendingMessages: ChatMessage[],
  ) => ChatMessage[];
  pendingMessageClientId: (message: ChatMessage) => string | null;
  removeMessageAliases: (
    messages: ChatMessage[],
    message: ChatMessage | string,
    clientMessageId?: string,
  ) => ChatMessage[];
  reconcileIncomingMessage: (
    messages: ChatMessage[],
    message: ChatMessage,
  ) => { inserted: boolean; message?: ChatMessage };
  reconcileSentMessage: (
    messages: ChatMessage[],
    pendingId: string,
    message: ChatMessage,
  ) => unknown;
  isSlowModeCooldownActive: (...args: unknown[]) => boolean;
  slowModeRemainingMs: (...args: unknown[]) => number;
  debugLog: (...args: unknown[]) => void;
  hasTauriRuntimeMarker: () => boolean;
  getSupabaseClient: typeof import("../../utils/supabase-client.ts").getSupabaseClient;
}

export interface ChatStoreContext {
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
  ) => Promise<unknown>;
  legacyReadStorageKey: (userId: string) => string;
  chatResponseError: (response: Response) => Promise<ChatDeliveryError>;
  closeActiveTransport: () => void;
  connectToChannel: (
    channelId: string,
    channelName?: string | null,
    roomId?: string | null,
    isReconnect?: boolean,
  ) => Promise<unknown>;
  disconnectFromChannel: (...args: unknown[]) => unknown;
  fetchMessages: (channelId: string, generation?: number) => Promise<unknown>;
  sendMessage: (
    channelId: string,
    content: string,
    options?: ChatSendOptions,
  ) => Promise<unknown>;
  editMessage: (...args: unknown[]) => Promise<unknown>;
  deleteMessage: (...args: unknown[]) => Promise<unknown>;
  fetchMessageHistory: (...args: unknown[]) => Promise<unknown>;
  markMessageAsRead: (...args: unknown[]) => Promise<unknown>;
  sendTypingIndicator: (...args: unknown[]) => Promise<unknown>;
  fetchBookmarks: (...args: unknown[]) => Promise<unknown>;
  fetchPinned: (...args: unknown[]) => Promise<unknown>;
  searchMessages: (...args: unknown[]) => Promise<unknown>;
  undoMessage: (...args: unknown[]) => Promise<unknown>;
  clearChat: (...args: unknown[]) => unknown;
  handleBackgroundSyncSuccess: (...args: unknown[]) => unknown;
  handleBackgroundSyncFailure: (...args: unknown[]) => unknown;
  handleBrowserOffline: () => void;
  handleBrowserOnline: () => void;
  handleWebSocketMessage: (event: { data: unknown }) => Promise<void>;
  handleServiceWorkerMessage: (event: {
    data: { type?: string; pendingId?: string; status?: number };
  }) => void;
  handleServiceWorkerControllerChange: () => void;
  handleParticipantChange: () => Promise<void>;
  handleNewMessageNotification: (message: ChatMessage) => void;
  updateMessage: (message: ChatMessage) => void;
  removeMessage: (messageId: string, clientMessageId?: string) => void;
  updateTypingStatus: (userId: string, isTyping: boolean) => void;
  hydratePendingReadIds: (userId: string) => Promise<void>;
  persistPendingReadIds: (userId: string) => Promise<void>;
  flushPendingReads: () => Promise<unknown>;
  scheduleReadFlush: () => void;
  requestBackgroundSync: () => Promise<void>;
  triggerManualSync: () => void;
  joinChannelMembership: (channelId: string) => void;
  leaveChannelMembership: (channelId: string | null) => void;
  registerPageHideLeave: () => void;
  scheduleReconnect: () => void;
}
