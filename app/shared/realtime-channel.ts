import { getSupabaseClient } from "../utils/supabase-client.ts";

const topicEntries = new Map();

async function resolveAccessToken() {
  if (!import.meta.client) return null;
  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) return null;
  const sessionResult = await supabaseClient.auth.getSession();
  const accessToken = sessionResult?.data?.session?.access_token;
  if (!accessToken) return null;
  supabaseClient.realtime.setAuth(accessToken);
  return accessToken;
}

export function getRealtimeClient() {
  if (!import.meta.client) return null;
  return getSupabaseClient();
}

export async function openRealtimeChannel(topic, handlers = {} as any) {
  const supabaseClient = getRealtimeClient();
  if (!supabaseClient) return null;
  let entry = topicEntries.get(topic);
  if (!entry) {
    entry = {
      topic,
      handlers: new Set(),
      channel: null,
      closeChannel: null,
      status: null,
      closed: false,
      ready: null,
    };
    topicEntries.set(topic, entry);
    entry.ready = (async () => {
      const accessToken = await resolveAccessToken();
      if (!accessToken || entry.closed) return null;
      const channel = supabaseClient.channel(topic, {
        config: { private: true },
      });
      entry.channel = channel;
      entry.closeChannel = () => {
        if (!entry.channel) return;
        const currentChannel = entry.channel;
        entry.channel = null;
        void Promise.resolve(currentChannel.unsubscribe()).catch(() => {});
      };
      channel.on("broadcast", { event: "message" }, (payload) => {
        for (const subscriber of [...entry.handlers])
          subscriber.onMessage?.(payload?.payload);
      });
      channel.subscribe((status, err) => {
        if (entry.closed) return;
        if (status === "SUBSCRIBED" || status === "SYNCED") {
          entry.status = status;
          for (const subscriber of [...entry.handlers])
            subscriber.onSubscribe?.(status);
        }
        if (
          status === "CHANNEL_ERROR" ||
          status === "CLOSED" ||
          status === "TIMED_OUT"
        ) {
          if (topicEntries.get(topic) === entry) topicEntries.delete(topic);
          entry.closed = true;
          const subscribers = [...entry.handlers];
          entry.handlers.clear();
          entry.closeChannel?.();
          for (const subscriber of subscribers)
            subscriber.onError?.(err, status);
        }
      });
      return channel;
    })().catch(() => null);
  }

  const subscriber = {
    onMessage: handlers.onMessage,
    onSubscribe: handlers.onSubscribe,
    onError: handlers.onError,
  };
  entry.handlers.add(subscriber);
  const channel = await entry.ready;
  if (!channel || entry.closed || !entry.handlers.has(subscriber)) {
    entry.handlers.delete(subscriber);
    if (!entry.handlers.size && topicEntries.get(topic) === entry) {
      topicEntries.delete(topic);
      entry.closed = true;
      entry.closeChannel?.();
    }
    return null;
  }
  if (entry.status === "SUBSCRIBED" || entry.status === "SYNCED")
    Promise.resolve().then(() => subscriber.onSubscribe?.(entry.status));

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    entry.handlers.delete(subscriber);
    if (entry.handlers.size || topicEntries.get(topic) !== entry) return;
    topicEntries.delete(topic);
    entry.closed = true;
    entry.closeChannel?.();
  };
  return { channel, close };
}
