import type { ExternalField } from "../../shared/types/external.ts";

export interface RealtimeChannelPublisher {
  httpSend: (event: string, message: ExternalField) => Promise<ExternalField>;
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
  sendMessage: (message: RealtimePayload) => Promise<ExternalField>;
  sendTyping: (typing: RealtimePayload) => Promise<ExternalField>;
  sendReaction: (reaction: RealtimePayload) => Promise<ExternalField>;
  trackPresence: (presence: RealtimePayload) => Promise<ExternalField>;
  untrackPresence: () => Promise<ExternalField>;
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
