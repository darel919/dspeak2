const DEVICE_ID_KEY = "dspeak:media:deviceId";

let memoryMediaDeviceId: string | null = null;

const make = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export function getOrCreateDeviceId(explicitStorage?: Storage | null) {
  if (memoryMediaDeviceId) {
    return memoryMediaDeviceId;
  }

  let storage = explicitStorage;

  if (storage === undefined) {
    try {
      storage = globalThis.localStorage;
    } catch {
      storage = null;
    }
  }

  try {
    const existing = storage?.getItem(DEVICE_ID_KEY);

    if (existing) {
      memoryMediaDeviceId = existing;
      return existing;
    }

    const created = make();
    storage?.setItem(DEVICE_ID_KEY, created);
    memoryMediaDeviceId = created;
    return created;
  } catch {
    memoryMediaDeviceId = make();
    return memoryMediaDeviceId;
  }
}

export function __resetDeviceIdCacheForTesting() {
  memoryMediaDeviceId = null;
}

export async function getMediaControlBootstrap({
  accessToken,
  baseApiPath = "/api",
  channelId,
  connectionMode,
  deviceId,
  roomId,
}: {
  accessToken?: string | null;
  baseApiPath?: string;
  channelId: string;
  connectionMode: string;
  deviceId: string;
  roomId: string;
}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await fetch(`${baseApiPath}/media/bootstrap`, {
    method: "POST",
    headers,
    body: JSON.stringify({ channelId, roomId, connectionMode, deviceId }),
  });
  if (!response.ok) {
    throw new Error(`Media bootstrap failed: ${response.status}`);
  }
  return response.json();
}

export function buildMediaControlSocketUrl({
  mediaControlUrl,
  channelId,
  ticket,
}: {
  mediaControlUrl: string;
  channelId: string;
  ticket?: string;
}) {
  const endpoint = new URL(mediaControlUrl);
  if (endpoint.protocol === "http:") endpoint.protocol = "ws:";
  if (endpoint.protocol === "https:") endpoint.protocol = "wss:";
  endpoint.searchParams.set("channelId", channelId);
  return endpoint.toString();
}
