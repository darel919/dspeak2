export interface RealtimeChannelPublisher {
  httpSend: (event: string, message: unknown) => Promise<unknown>;
}

import type { RealtimeChannel } from "@supabase/supabase-js";

export type RealtimePayload = Record<string, unknown>;
export type RealtimeStatus =
  "SUBSCRIBED" | "TIMED_OUT" | "CLOSED" | "CHANNEL_ERROR";
export type RealtimePresence = Record<string, RealtimePayload[]>;

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

export interface ChatSubscription {
  channel: RealtimeChannel;
  sendMessage: (message: RealtimePayload) => Promise<unknown>;
  sendTyping: (typing: RealtimePayload) => Promise<unknown>;
  sendReaction: (reaction: RealtimePayload) => Promise<unknown>;
  trackPresence: (presence: RealtimePayload) => Promise<unknown>;
  untrackPresence: () => Promise<unknown>;
  unsubscribe: () => void;
}

export interface NotificationCallbacks {
  onNotification?: (payload: RealtimePayload) => void;
  onSubscribed?: () => void;
  onError?: (status: RealtimeStatus) => void;
}

export interface NotificationSubscription {
  channel: RealtimeChannel;
  unsubscribe: () => void;
}

export interface RealtimePublisher {
  channel: (
    topic: string,
    options?: { config?: { private?: boolean } },
  ) => RealtimeChannelPublisher;
}
