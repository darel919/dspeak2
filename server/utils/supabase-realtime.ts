import { supabase, supabaseAdmin } from "../auth/supabase.ts";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type {
  ChatCallbacks,
  ChatSubscription,
  NotificationCallbacks,
  NotificationSubscription,
  RealtimeChannelOptions,
  RealtimePayload,
  RealtimePresence,
  RealtimeStatus,
} from "../types/realtime.ts";

const realtimeClient = supabaseAdmin || supabase;

const channels = new Map<string, RealtimeChannel>();

export function getRealtimeChannel(
  channelName: string,
  options: RealtimeChannelOptions = {},
): RealtimeChannel {
  const key = `${channelName}:${JSON.stringify(options)}`;
  if (channels.has(key)) {
    const existing = channels.get(key);
    if (existing) return existing;
  }

  const channel = realtimeClient.channel(channelName, {
    config: {
      private: true,
      broadcast: { self: false },
      presence: { key: options.userId },
    },
  });

  if (!channel) throw new Error(`Unable to create realtime channel ${key}`);
  channels.set(key, channel);
  return channel;
}

export function subscribeToChat(
  channelId: string,
  userId: string,
  callbacks: ChatCallbacks,
): ChatSubscription {
  const channel = getRealtimeChannel(`chat:${channelId}`, { userId });

  if (callbacks.onMessage) {
    channel.on("broadcast", { event: "message" }, (payload) =>
      callbacks.onMessage?.(payload),
    );
  }

  if (callbacks.onTyping) {
    channel.on("broadcast", { event: "typing" }, (payload) =>
      callbacks.onTyping?.(payload),
    );
  }

  if (callbacks.onReaction) {
    channel.on("broadcast", { event: "reaction" }, (payload) =>
      callbacks.onReaction?.(payload),
    );
  }

  if (callbacks.onPresence) {
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      callbacks.onPresence?.(state as RealtimePresence);
    });

    channel.on("presence", { event: "join" }, ({ key, newPresences }) => {
      callbacks.onPresenceJoin?.(key, newPresences as RealtimePayload[]);
    });

    channel.on("presence", { event: "leave" }, ({ key, leftPresences }) => {
      callbacks.onPresenceLeave?.(key, leftPresences as RealtimePayload[]);
    });
  }

  channel.subscribe((status) => {
    const realtimeStatus = status as RealtimeStatus;
    if (status === "SUBSCRIBED") {
      callbacks.onSubscribed?.();
    } else if (status === "CLOSED" || status === "CHANNEL_ERROR") {
      callbacks.onError?.(realtimeStatus);
    }
  });

  return {
    channel,
    sendMessage: (message: RealtimePayload) =>
      channel.send({ type: "broadcast", event: "message", payload: message }),
    sendTyping: (typing: RealtimePayload) =>
      channel.send({ type: "broadcast", event: "typing", payload: typing }),
    sendReaction: (reaction: RealtimePayload) =>
      channel.send({ type: "broadcast", event: "reaction", payload: reaction }),
    trackPresence: (presence: RealtimePayload) => channel.track(presence),
    untrackPresence: () => channel.untrack(),
    unsubscribe: () => {
      channel.unsubscribe();
      channels.delete(`chat:${channelId}:${JSON.stringify({ userId })}`);
    },
  };
}

export function subscribeToNotifications(
  userId: string,
  callbacks: NotificationCallbacks,
): NotificationSubscription {
  const normalizedUserId = String(userId);
  const topic = `notify:${normalizedUserId}`;
  const options = { userId: normalizedUserId };
  const channel = getRealtimeChannel(topic, options);

  if (callbacks.onNotification) {
    channel.on("broadcast", { event: "notification" }, (payload) =>
      callbacks.onNotification?.(payload),
    );
  }

  channel.subscribe((status) => {
    const realtimeStatus = status as RealtimeStatus;
    if (status === "SUBSCRIBED" && callbacks.onSubscribed)
      callbacks.onSubscribed();
    if (
      (status === "CLOSED" || status === "CHANNEL_ERROR") &&
      callbacks.onError
    )
      callbacks.onError(realtimeStatus);
  });

  return {
    channel,
    unsubscribe: () => {
      channel.unsubscribe();
      channels.delete(`${topic}:${JSON.stringify(options)}`);
    },
  };
}

export async function broadcastChatMessage(
  channelId: string,
  message: RealtimePayload,
) {
  const channel = realtimeClient.channel(`chat:${channelId}`);
  return channel.send({
    type: "broadcast",
    event: "message",
    payload: message,
  });
}

export async function broadcastTyping(
  channelId: string,
  {
    userId,
    username,
    isTyping,
  }: {
    userId: string;
    username: string;
    isTyping: boolean;
  },
) {
  const channel = realtimeClient.channel(`chat:${channelId}`);
  return channel.send({
    type: "broadcast",
    event: "typing",
    payload: { userId, username, isTyping },
  });
}

export async function broadcastReaction(
  channelId: string,
  reaction: RealtimePayload,
) {
  const channel = realtimeClient.channel(`chat:${channelId}`);
  return channel.send({
    type: "broadcast",
    event: "reaction",
    payload: reaction,
  });
}

export async function broadcastNotification(
  userId: string,
  notification: RealtimePayload,
) {
  const channel = realtimeClient.channel(`notify:${String(userId)}`);
  return channel.send({
    type: "broadcast",
    event: "notification",
    payload: notification,
  });
}
