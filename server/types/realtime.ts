import type {
  RealtimeChannel,
  RealtimePresenceState,
} from "@supabase/supabase-js";

export type RealtimePayload = Record<string, unknown>;
export type RealtimePresence = RealtimePresenceState<RealtimePayload>;
export type RealtimeStatus = "SUBSCRIBED" | "CLOSED" | "CHANNEL_ERROR";

export interface RealtimeChannelOptions {
  userId?: string;
}

export interface ChatCallbacks {
  onMessage?: (payload: RealtimePayload) => void;
  onTyping?: (payload: RealtimePayload) => void;
  onReaction?: (payload: RealtimePayload) => void;
  onPresence?: (state: RealtimePresence) => void;
  onPresenceJoin?: (key: string, presences: RealtimePayload[]) => void;
  onPresenceLeave?: (key: string, presences: RealtimePayload[]) => void;
  onSubscribed?: () => void;
  onError?: (status: RealtimeStatus) => void;
}

export interface NotificationCallbacks {
  onNotification?: (payload: RealtimePayload) => void;
  onSubscribed?: () => void;
  onError?: (status: RealtimeStatus) => void;
}

export interface ChatSubscription {
  channel: RealtimeChannel;
  sendMessage: (message: RealtimePayload) => Promise<unknown>;
  sendTyping: (typing: RealtimePayload) => Promise<unknown>;
  sendReaction: (reaction: RealtimePayload) => Promise<unknown>;
  trackPresence: (presence: RealtimePayload) => Promise<unknown>;
  untrackPresence: () => Promise<unknown>;
  unsubscribe: () => void;
}

export interface NotificationSubscription {
  channel: RealtimeChannel;
  unsubscribe: () => void;
}
