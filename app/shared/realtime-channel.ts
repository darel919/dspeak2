import { getSupabaseClient } from "../utils/supabase-client.ts";
import type { RealtimeChannelHandlers } from "./types/shared-utilities.ts";

export interface RealtimeChannelLike {
  on: (
    type: string,
    filter: Record<string, unknown>,
    callback: (payload: Record<string, unknown>) => void,
  ) => RealtimeChannelLike;
  subscribe: (callback: (status: string, error?: unknown) => void) => unknown;
  unsubscribe: () => Promise<unknown> | unknown;
  send: (payload: Record<string, unknown>) => Promise<unknown>;
}

interface RealtimeTopicEntry {
  topic: string;
  handlers: Set<RealtimeChannelHandlers<unknown>>;
  channel: RealtimeChannelLike | null;
  closeChannel: (() => void) | null;
  status: string | null;
  closed: boolean;
  ready: Promise<RealtimeChannelLike | null> | null;
}

const topicEntries = new Map<string, RealtimeTopicEntry>();

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

export async function openRealtimeChannel<TPayload = unknown>(
  topic: string,
  handlers: RealtimeChannelHandlers<TPayload> = {},
) {
  const supabaseClient = getRealtimeClient();
  if (!supabaseClient) return null;
  let entry = topicEntries.get(topic);
  if (!entry) {
    const createdEntry: RealtimeTopicEntry = {
      topic,
      handlers: new Set(),
      channel: null,
      closeChannel: null,
      status: null,
      closed: false,
      ready: null,
    };
    topicEntries.set(topic, createdEntry);
    entry = createdEntry;
    const topicEntry = createdEntry;
    topicEntry.ready = (async (): Promise<RealtimeChannelLike | null> => {
      const accessToken = await resolveAccessToken();
      if (!accessToken || topicEntry.closed) return null;
      const channel = supabaseClient.channel(topic, {
        config: { private: true },
      });
      topicEntry.channel = channel as unknown as RealtimeChannelLike;
      topicEntry.closeChannel = () => {
        if (!topicEntry.channel) return;
        const currentChannel = topicEntry.channel;
        topicEntry.channel = null;
        void Promise.resolve(currentChannel.unsubscribe()).catch(() => {});
      };
      channel.on(
        "broadcast",
        { event: "message" },
        (payload: Record<string, unknown>) => {
          for (const subscriber of [...topicEntry.handlers])
            subscriber.onMessage?.(payload?.payload);
        },
      );
      channel.subscribe((status: string, err?: unknown) => {
        if (topicEntry.closed) return;
        if (status === "SUBSCRIBED" || status === "SYNCED") {
          topicEntry.status = status;
          for (const subscriber of [...topicEntry.handlers])
            subscriber.onSubscribe?.(status);
        }
        if (
          status === "CHANNEL_ERROR" ||
          status === "CLOSED" ||
          status === "TIMED_OUT"
        ) {
          if (topicEntries.get(topic) === topicEntry)
            topicEntries.delete(topic);
          topicEntry.closed = true;
          const subscribers = [...topicEntry.handlers];
          topicEntry.handlers.clear();
          topicEntry.closeChannel?.();
          for (const subscriber of subscribers)
            subscriber.onError?.(err, status);
        }
      });
      return channel as unknown as RealtimeChannelLike;
    })().catch(() => null);
  }

  if (!entry) return null;

  const subscriber: RealtimeChannelHandlers<unknown> = {
    onMessage: handlers.onMessage
      ? (payload) => handlers.onMessage?.(payload as TPayload)
      : undefined,
    onSubscribe: handlers.onSubscribe,
    onError: handlers.onError,
  };
  entry.handlers.add(subscriber);
  const channel = entry.ready ? await entry.ready : null;
  if (!channel || entry.closed || !entry.handlers.has(subscriber)) {
    entry.handlers.delete(subscriber);
    if (!entry.handlers.size && topicEntries.get(topic) === entry) {
      topicEntries.delete(topic);
      entry.closed = true;
      entry.closeChannel?.();
    }
    return null;
  }
  const currentStatus = entry.status;
  if (currentStatus === "SUBSCRIBED" || currentStatus === "SYNCED")
    Promise.resolve().then(() => subscriber.onSubscribe?.(currentStatus));

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
