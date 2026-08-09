const MEDIA_DEBUG_STORAGE_KEY = "dspeak.media.debug";
const REDACTED = "[redacted]";
const BLOCKED_KEY =
  /token|ticket|secret|authorization|password|private|sdp|candidate/i;

function mediaDebugEnabled() {
  if (globalThis.__DSPEAK_MEDIA_DEBUG__ === true) return true;
  if (import.meta.dev) return true;
  try {
    return globalThis.localStorage?.getItem(MEDIA_DEBUG_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function sanitize(value, depth = 0) {
  if (value == null || typeof value === "boolean" || typeof value === "number")
    return value;
  if (typeof value === "string")
    return value.length > 160 ? `${value.slice(0, 157)}...` : value;
  if (value instanceof Error)
    return {
      name: value.name,
      message: value.message,
      code: value.code || null,
    };
  if (depth >= 3) return "[depth-limited]";
  if (Array.isArray(value))
    return value.slice(0, 24).map((entry) => sanitize(entry, depth + 1));
  if (typeof value === "object") {
    const output = {};
    for (const [key, entry] of Object.entries(value).slice(0, 32))
      output[key] = BLOCKED_KEY.test(key)
        ? REDACTED
        : sanitize(entry, depth + 1);
    return output;
  }
  return String(value);
}

export function shortMediaId(value) {
  const text = String(value || "");
  return text.length > 12 ? `${text.slice(0, 8)}...${text.slice(-4)}` : text;
}

export function mediaDebug(event, details = {}) {
  if (!mediaDebugEnabled()) return;
  console.debug("[Media]", event, sanitize(details));
}

export function setMediaDebugEnabled(enabled) {
  globalThis.__DSPEAK_MEDIA_DEBUG__ = enabled === true;
}

export function sanitizeMediaDebugValue(value) {
  return sanitize(value);
}
