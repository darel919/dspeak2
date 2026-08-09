const DEVICE_STORAGE_KEY = "dspeak:device-id";
let memoryDeviceId = null;

export function getDeviceId() {
  if (!import.meta.client) return "";
  if (memoryDeviceId) return memoryDeviceId;
  try {
    const existing = localStorage.getItem(DEVICE_STORAGE_KEY);
    if (existing) {
      memoryDeviceId = existing;
      return existing;
    }
    const created = crypto.randomUUID();
    localStorage.setItem(DEVICE_STORAGE_KEY, created);
    memoryDeviceId = created;
    return created;
  } catch {
    memoryDeviceId ||= crypto.randomUUID();
    return memoryDeviceId;
  }
}

export function deviceHeaders(headers = {}) {
  return {
    ...headers,
    "X-Device-Id": getDeviceId(),
  };
}
