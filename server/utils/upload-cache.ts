const stateKey = Symbol.for("dspeak.upload-cache");
const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 2000;

console.log("[UploadCache] module loaded, stateKey:", String(stateKey));

function getState() {
  if (!globalThis[stateKey]) {
    console.log("[UploadCache] creating new Map in globalThis");
    globalThis[stateKey] = new Map();
  }
  return globalThis[stateKey];
}

function prune(state) {
  const cutoff = Date.now() - TTL_MS;
  for (const [key, entry] of state) {
    if (entry.expiresAt <= cutoff) state.delete(key);
  }
  if (state.size <= MAX_ENTRIES) return;
  const overflow = state.size - MAX_ENTRIES;
  const keys = [...state.keys()];
  for (let i = 0; i < overflow; i++) state.delete(keys[i]);
}

export function cacheUploadedFile(uploaderId, record) {
  const state = getState();
  prune(state);
  state.set(record.id, {
    id: record.id,
    uploader: uploaderId,
    room_channel: record.room_channel,
    name: record.name,
    size: record.size,
    mime_type: record.mime_type,
    width: record.width || 0,
    height: record.height || 0,
    url: record.url || `/api/assets/chat-file?id=${record.id}`,
    expiresAt: Date.now() + TTL_MS,
  });
  return state.get(record.id);
}

export function getCachedFile(fileId) {
  const state = getState();
  prune(state);
  const entry = state.get(fileId);
  if (entry && entry.expiresAt > Date.now()) return entry;
  if (entry) state.delete(fileId);
  return null;
}
