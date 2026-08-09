import { getSupabaseClient } from "../utils/supabase-client.js";

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

export async function openRealtimeChannel(topic, handlers = {}) {
  const supabaseClient = getRealtimeClient();
  if (!supabaseClient) return null;
  const accessToken = await resolveAccessToken();
  if (!accessToken) return null;
  const { onMessage, onSubscribe, onError } = handlers;
  const channel = supabaseClient.channel(topic, {
    config: { private: true },
  });
  if (typeof onMessage === "function") {
    channel.on("broadcast", { event: "message" }, (payload) => {
      onMessage(payload?.payload);
    });
  }
  channel.subscribe((status, err) => {
    if (status === "SUBSCRIBED" || status === "SYNCED") {
      onSubscribe?.(status);
    }
    if (
      status === "CHANNEL_ERROR" ||
      status === "CLOSED" ||
      status === "TIMED_OUT"
    ) {
      onError?.(err, status);
    }
  });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    channel.unsubscribe().then(() => {});
  };
  return { channel, close };
}
