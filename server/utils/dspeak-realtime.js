const stateKey = Symbol.for("dspeak.realtime");

function getState() {
  if (!globalThis[stateKey]) globalThis[stateKey] = { channels: new Map() };
  return globalThis[stateKey];
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
