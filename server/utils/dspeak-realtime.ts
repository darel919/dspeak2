import type {
  RealtimeChannelPublisher,
  RealtimePublisher,
} from "../types/realtime.ts";

let realtimePublisher: RealtimePublisher | null = null;
let publisherOverride: RealtimePublisher | null = null;
const cachedChannels = new Map<string, RealtimeChannelPublisher>();

async function loadPublisher(): Promise<RealtimePublisher | null> {
  if (publisherOverride) return publisherOverride;
  if (realtimePublisher) return realtimePublisher;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  const { supabaseAdmin } = await import("../auth/supabase.ts");
  if (!supabaseAdmin) return null;
  realtimePublisher = {
    channel(topic, options) {
      const channel = supabaseAdmin.channel(
        topic,
        options?.config
          ? { config: { private: options.config.private === true } }
          : undefined,
      );
      return {
        httpSend: (event, message) => channel.httpSend(event, message),
      };
    },
  };
  return realtimePublisher;
}

export function setRealtimePublisherForTests(
  publisher: RealtimePublisher | null,
): void {
  publisherOverride = publisher;
  cachedChannels.clear();
}

export async function publishToRealtime(
  topic: string,
  message: unknown,
): Promise<void> {
  const publisher = await loadPublisher();
  if (!publisher) return;
  let channel = cachedChannels.get(topic);
  if (!channel) {
    channel = publisher.channel(topic, { config: { private: true } });
    cachedChannels.set(topic, channel);
  }
  try {
    await channel.httpSend("message", message);
  } catch {
    cachedChannels.delete(topic);
  }
}

export function broadcastGlobally(message: unknown): Promise<void> {
  return publishToRealtime("global", message);
}

export function broadcastToUser(
  userId: string | number,
  message: unknown,
): Promise<void> {
  return publishToRealtime(`notify:${String(userId)}`, message);
}

export function broadcastToChannel(
  channelId: string | number,
  message: unknown,
): Promise<void> {
  return publishToRealtime(`chat:${String(channelId)}`, message);
}

export function broadcastToRoom(
  roomId: string | number,
  message: unknown,
): Promise<void> {
  return publishToRealtime(`room:${String(roomId)}`, message);
}
