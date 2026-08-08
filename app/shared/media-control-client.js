const DEVICE_ID_KEY = "dspeak:media:deviceId";

export function getOrCreateDeviceId(storage = globalThis.localStorage) {
  const make = () =>
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  try {
    const existing = storage?.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const next = make();
    storage?.setItem(DEVICE_ID_KEY, next);
    return next;
  } catch {
    return make();
  }
}

export async function getMediaControlBootstrap({
  accessToken,
  baseApiPath = "/api",
  channelId,
  connectionMode,
  deviceId,
  roomId,
}) {
  const headers = { "Content-Type": "application/json" };
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
}) {
  const endpoint = new URL(mediaControlUrl);
  if (endpoint.protocol === "http:") endpoint.protocol = "ws:";
  if (endpoint.protocol === "https:") endpoint.protocol = "wss:";
  endpoint.searchParams.set("channelId", channelId);
  return endpoint.toString();
}
