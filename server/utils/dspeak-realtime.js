const stateKey = Symbol.for("dspeak.realtime");

let realtimePublisher = null;

async function publishToRealtime(topic, message) {
  if (!realtimePublisher) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return;
    }
    try {
      const { supabaseAdmin } = await import("../auth/supabase.js");
      if (!supabaseAdmin) return;
      realtimePublisher = supabaseAdmin;
    } catch {
      return;
    }
  }
  try {
    const channel = realtimePublisher.channel(topic);
    channel
      .httpSend("message", message)
      .catch(() => {})
      .finally(() => {
        realtimePublisher.removeChannel(channel).catch(() => {});
      });
  } catch {}
}

function getState() {
  if (!globalThis[stateKey])
    globalThis[stateKey] = {
      channels: new Map(),
      users: new Map(),
      global: new Set(),
      deviceChannels: new Map(),
    };
  return globalThis[stateKey];
}

function deviceChannelKey(userId, deviceId) {
  return `${String(userId)}:${String(deviceId)}`;
}

export function setDeviceViewingChannel(
  userId,
  deviceId,
  channelId,
  active = true,
) {
  if (!userId || !deviceId || !channelId) return;
  const state = getState();
  const key = deviceChannelKey(userId, deviceId);
  const channels = state.deviceChannels.get(key) || new Map();
  const normalizedChannelId = String(channelId);
  const count = channels.get(normalizedChannelId) || 0;
  if (active) channels.set(normalizedChannelId, count + 1);
  else if (count > 1) channels.set(normalizedChannelId, count - 1);
  else channels.delete(normalizedChannelId);
  if (channels.size) state.deviceChannels.set(key, channels);
  else state.deviceChannels.delete(key);
}

export function isDeviceViewingChannel(userId, deviceId, channelId) {
  if (!userId || !deviceId || !channelId) return false;
  return (
    getState()
      .deviceChannels.get(deviceChannelKey(userId, deviceId))
      ?.has(String(channelId)) === true
  );
}

export function isUserViewingChannel(userId, channelId) {
  const prefix = `${String(userId)}:`;
  for (const [key, channels] of getState().deviceChannels) {
    if (key.startsWith(prefix) && channels.has(String(channelId))) return true;
  }
  return false;
}

export function addGlobalSubscriber(peer) {
  getState().global.add(peer);
}

export function removeGlobalSubscriber(peer) {
  getState().global.delete(peer);
}

export function broadcastGlobally(message) {
  publishToRealtime("global", message);
  const payload = JSON.stringify(message);
  for (const peer of getState().global) {
    try {
      peer.send(payload);
    } catch {
      removeGlobalSubscriber(peer);
    }
  }
}

export function addUserSubscriber(userId, peer) {
  const state = getState();
  if (!state.users.has(userId)) state.users.set(userId, new Set());
  state.users.get(userId).add(peer);
}

export function removeUserSubscriber(userId, peer) {
  const subscribers = getState().users.get(userId);
  if (!subscribers) return;
  subscribers.delete(peer);
  if (!subscribers.size) getState().users.delete(userId);
}

export function broadcastToUser(userId, message) {
  publishToRealtime(`notify:${String(userId)}`, message);
  const payload = JSON.stringify(message);
  for (const peer of getState().users.get(String(userId)) || []) {
    try {
      peer.send(payload);
    } catch {
      removeUserSubscriber(String(userId), peer);
    }
  }
}

export function addChannelSubscriber(channelId, peer) {
  const state = getState();
  if (!state.channels.has(channelId)) state.channels.set(channelId, new Set());
  state.channels.get(channelId).add(peer);
}

export function removeChannelSubscriber(channelId, peer) {
  const subscribers = getState().channels.get(channelId);
  if (!subscribers) return;
  subscribers.delete(peer);
  if (subscribers.size === 0) getState().channels.delete(channelId);
}

export function getChannelSubscribers(channelId) {
  return getState().channels.get(channelId) || new Set();
}

export function broadcastToChannel(channelId, message, excludedPeer = null) {
  publishToRealtime(`chat:${String(channelId)}`, message);
  const payload = JSON.stringify(message);
  for (const peer of getChannelSubscribers(channelId)) {
    if (peer === excludedPeer) continue;
    try {
      peer.send(payload);
    } catch {
      removeChannelSubscriber(channelId, peer);
    }
  }
}
