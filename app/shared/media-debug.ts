const MEDIA_DEBUG_STORAGE_KEY = "dspeak.media.debug";
const REDACTED = "[redacted]";
const BLOCKED_KEY =
  /token|ticket|secret|authorization|password|private|sdp|candidate/i;

import { isExternalRecord, isExternalString } from "./types/boundary.ts";

type SanitizedMediaValue =
  | null
  | boolean
  | number
  | string
  | SanitizedMediaValue[]
  | { [key: string]: SanitizedMediaValue };

function mediaDebugEnabled() {
  if (globalThis.__DSPEAK_MEDIA_DEBUG__ === true) return true;
  if (import.meta.dev) return true;
  try {
    return globalThis.localStorage?.getItem(MEDIA_DEBUG_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function sanitize<T>(value: T, depth = 0): SanitizedMediaValue {
  if (value === null || value === undefined) return null;
  if (value === true) return true;
  if (value === false) return false;
  if (isExternalString(value))
    return value.length > 160 ? `${value.slice(0, 157)}...` : value;
  try {
    const number = Number(value);
    if (Object.is(value, number) && Number.isFinite(number)) return number;
  } catch {}
  if (value instanceof Error)
    return {
      name: value.name,
      message: value.message,
      code: "code" in value ? String(value.code) : null,
    };
  if (depth >= 3) return "[depth-limited]";
  if (Array.isArray(value))
    return value.slice(0, 24).map((entry) => sanitize(entry, depth + 1));
  if (isExternalRecord(value)) {
    const output: { [key: string]: SanitizedMediaValue } = {};
    for (const [key, entry] of Object.entries(value).slice(0, 32))
      output[key] = BLOCKED_KEY.test(key)
        ? REDACTED
        : sanitize(entry, depth + 1);
    return output;
  }
  return String(value);
}

export function shortMediaId<T>(value: T): string {
  const text = String(value || "");
  return text.length > 12 ? `${text.slice(0, 8)}...${text.slice(-4)}` : text;
}

export function mediaDebug<T>(event: string, details?: T) {
  if (!mediaDebugEnabled()) return;
  console.debug("[Media]", event, sanitize(details));
}

export function setMediaDebugEnabled(enabled: boolean) {
  globalThis.__DSPEAK_MEDIA_DEBUG__ = enabled === true;
}

export function sanitizeMediaDebugValue<T>(value: T): SanitizedMediaValue {
  return sanitize(value);
}
