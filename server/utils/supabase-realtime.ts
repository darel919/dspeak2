import { supabase, supabaseAdmin } from "../auth/supabase.ts";

const realtimeClient = supabaseAdmin || supabase;

let channels = new Map();

export function getRealtimeChannel(channelName, options = {} as any) {
  const key = `${channelName}:${JSON.stringify(options)}`;
  if (channels.has(key)) {
    return channels.get(key);
  }

  const channel = realtimeClient.channel(channelName, {
    config: {
      private: true,
      broadcast: { self: false },
      presence: { key: options.userId },
    },
  });

  channels.set(key, channel);
  return channel;
}

export function subscribeToChat(channelId, userId, callbacks) {
  const channel = getRealtimeChannel(`chat:${channelId}`, { userId });

  if (callbacks.onMessage) {
    channel.on("broadcast", { event: "message" }, (payload) =>
      callbacks.onMessage(payload),
    );
  }

  if (callbacks.onTyping) {
    channel.on("broadcast", { event: "typing" }, (payload) =>
      callbacks.onTyping(payload),
    );
  }

  if (callbacks.onReaction) {
    channel.on("broadcast", { event: "reaction" }, (payload) =>
      callbacks.onReaction(payload),
    );
  }

  if (callbacks.onPresence) {
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      callbacks.onPresence(state);
    });

    channel.on("presence", { event: "join" }, ({ key, newPresences }) => {
      callbacks.onPresenceJoin?.(key, newPresences);
    });

    channel.on("presence", { event: "leave" }, ({ key, leftPresences }) => {
      callbacks.onPresenceLeave?.(key, leftPresences);
    });
  }

  channel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      if (callbacks.onSubscribed) callbacks.onSubscribed();
    } else if (status === "CLOSED" || status === "CHANNEL_ERROR") {
      if (callbacks.onError) callbacks.onError(status);
    }
  });

  return {
    channel,
    sendMessage: (message) =>
      channel.send({ type: "broadcast", event: "message", payload: message }),
    sendTyping: (typing) =>
      channel.send({ type: "broadcast", event: "typing", payload: typing }),
    sendReaction: (reaction) =>
      channel.send({ type: "broadcast", event: "reaction", payload: reaction }),
    trackPresence: (presence) => channel.track(presence),
    untrackPresence: () => channel.untrack(),
    unsubscribe: () => {
      channel.unsubscribe();
      channels.delete(`chat:${channelId}:${JSON.stringify({ userId })}`);
    },
  };
}

export function subscribeToNotifications(userId, callbacks) {
  const normalizedUserId = String(userId);
  const topic = `notify:${normalizedUserId}`;
  const options = { userId: normalizedUserId };
  const channel = getRealtimeChannel(topic, options);

  if (callbacks.onNotification) {
    channel.on("broadcast", { event: "notification" }, (payload) =>
      callbacks.onNotification(payload),
    );
  }

  channel.subscribe(async (status) => {
    if (status === "SUBSCRIBED" && callbacks.onSubscribed)
      callbacks.onSubscribed();
    if (
      (status === "CLOSED" || status === "CHANNEL_ERROR") &&
      callbacks.onError
    )
      callbacks.onError(status);
  });

  return {
    channel,
    unsubscribe: () => {
      channel.unsubscribe();
      channels.delete(`${topic}:${JSON.stringify(options)}`);
    },
  };
}

export async function broadcastChatMessage(channelId, message) {
  const channel = realtimeClient.channel(`chat:${channelId}`);
  return channel.send({
    type: "broadcast",
    event: "message",
    payload: message,
  });
}

export async function broadcastTyping(
  channelId,
  { userId, username, isTyping },
) {
  const channel = realtimeClient.channel(`chat:${channelId}`);
  return channel.send({
    type: "broadcast",
    event: "typing",
    payload: { userId, username, isTyping },
  });
}

export async function broadcastReaction(channelId, reaction) {
  const channel = realtimeClient.channel(`chat:${channelId}`);
  return channel.send({
    type: "broadcast",
    event: "reaction",
    payload: reaction,
  });
}

export async function broadcastNotification(userId, notification) {
  const channel = realtimeClient.channel(`notify:${String(userId)}`);
  return channel.send({
    type: "broadcast",
    event: "notification",
    payload: notification,
  });
}
