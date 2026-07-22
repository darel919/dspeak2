const stateKey = Symbol.for("dspeak.voice.presence");

function getState() {
  if (!globalThis[stateKey]) {
    globalThis[stateKey] = {
      rooms: new Map(),
      snapshots: new Map(),
    };
  }
  return globalThis[stateKey];
}

function send(peer, payload) {
  try {
    peer.send(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function subscribeToVoicePresence(roomId, peer) {
  const state = getState();
  const key = String(roomId);
  if (!state.rooms.has(key)) state.rooms.set(key, new Set());
  state.rooms.get(key).add(peer);
}

export function unsubscribeFromVoicePresence(roomId, peer) {
  const state = getState();
  const key = String(roomId);
  const subscribers = state.rooms.get(key);
  if (!subscribers) return;
  subscribers.delete(peer);
  if (!subscribers.size) state.rooms.delete(key);
}

export function publishVoicePresence(roomId, channelSnapshot) {
  const state = getState();
  const roomKey = String(roomId);
  const channelId = String(channelSnapshot.channelId);
  const roomSnapshots = state.snapshots.get(roomKey) || new Map();
  roomSnapshots.set(channelId, { ...channelSnapshot, channelId });
  state.snapshots.set(roomKey, roomSnapshots);
  const payload = {
    type: "voice-presence",
    data: roomSnapshots.get(channelId),
  };
  for (const peer of state.rooms.get(roomKey) || []) {
    if (!send(peer, payload)) unsubscribeFromVoicePresence(roomKey, peer);
  }
}

export function getVoicePresenceSnapshots(roomId) {
  return [...(getState().snapshots.get(String(roomId))?.values() || [])];
}
