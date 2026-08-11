const stateKey = Symbol.for("dspeak.upload-cache");
const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 2000;

interface CachedFile {
  id: string;
  uploader: string;
  room_channel?: string | null;
  name?: string | null;
  size?: number | null;
  mime_type?: string | null;
  width: number;
  height: number;
  url: string;
  expiresAt: number;
}

type UploadCache = Map<string, CachedFile>;
const globalState = globalThis as typeof globalThis & {
  [stateKey]?: UploadCache;
};

console.log("[UploadCache] module loaded, stateKey:", String(stateKey));

function getState() {
  if (!globalState[stateKey]) {
    console.log("[UploadCache] creating new Map in globalThis");
    globalState[stateKey] = new Map<string, CachedFile>();
  }
  return globalState[stateKey] as UploadCache;
}

function prune(state: UploadCache) {
  const cutoff = Date.now() - TTL_MS;
  for (const [key, entry] of state) {
    if (entry.expiresAt <= cutoff) state.delete(key);
  }
  if (state.size <= MAX_ENTRIES) return;
  const overflow = state.size - MAX_ENTRIES;
  const keys = [...state.keys()];
  for (let i = 0; i < overflow; i++) state.delete(keys[i]);
}

export function cacheUploadedFile(
  uploaderId: string,
  record: Omit<CachedFile, "uploader" | "expiresAt" | "url"> & {
    url?: string | null;
  },
) {
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

export function getCachedFile(fileId: string) {
  const state = getState();
  prune(state);
  const entry = state.get(fileId);
  if (entry && entry.expiresAt > Date.now()) return entry;
  if (entry) state.delete(fileId);
  return null;
}
