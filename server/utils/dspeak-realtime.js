let realtimePublisher = null;
let publisherOverride = null;
const cachedChannels = new Map();

async function loadPublisher() {
  if (publisherOverride) return publisherOverride;
  if (realtimePublisher) return realtimePublisher;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  const { supabaseAdmin } = await import("../auth/supabase.js");
  if (!supabaseAdmin) return null;
  realtimePublisher = supabaseAdmin;
  return realtimePublisher;
}

export function setRealtimePublisherForTests(publisher) {
  publisherOverride = publisher;
  cachedChannels.clear();
}

export async function publishToRealtime(topic, message) {
  const publisher = await loadPublisher();
  if (!publisher) return;
  let channel = cachedChannels.get(topic);
  if (!channel) {
    channel = publisher.channel(topic);
    cachedChannels.set(topic, channel);
  }
  try {
    await channel.httpSend("message", message);
  } catch {
    cachedChannels.delete(topic);
  }
}

export function broadcastGlobally(message) {
  publishToRealtime("global", message);
}

export function broadcastToUser(userId, message) {
  publishToRealtime(`notify:${String(userId)}`, message);
}

export function broadcastToChannel(channelId, message) {
  publishToRealtime(`chat:${String(channelId)}`, message);
}

export function broadcastToRoom(roomId, message) {
  publishToRealtime(`room:${String(roomId)}`, message);
}
