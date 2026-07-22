const stateKey = Symbol.for("dspeak.realtime");

function getState() {
  if (!globalThis[stateKey])
    globalThis[stateKey] = {
      channels: new Map(),
      users: new Map(),
      global: new Set(),
    };
  return globalThis[stateKey];
}

export function addGlobalSubscriber(peer) {
  getState().global.add(peer);
}

export function removeGlobalSubscriber(peer) {
  getState().global.delete(peer);
}

export function broadcastGlobally(message) {
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
