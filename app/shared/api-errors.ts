import type { ApiErrorPayload } from "./types/api.ts";

function parsePayload(value: unknown): ApiErrorPayload | null {
  if (value && typeof value === "object" && !Array.isArray(value))
    return value as ApiErrorPayload;
  if (typeof value !== "string" || !value.trim()) return null;

  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as ApiErrorPayload)
      : null;
  } catch {
    return null;
  }
}

function firstMessage(payload: ApiErrorPayload | null): string | undefined {
  const candidates = [
    payload?.statusMessage,
    payload?.message,
    payload?.data?.statusMessage,
    payload?.data?.message,
  ];

  return candidates.find(
    (message): message is string =>
      typeof message === "string" && Boolean(message.trim()),
  );
}

function isStackTrace(value: string): boolean {
  return /^Error(?::|\s)/i.test(value) || /\n\s*at\s+/.test(value);
}

export function apiErrorMessage(
  value: unknown,
  status: number | null | undefined,
  fallback = "Request failed",
): string {
  const payload = parsePayload(value);
  const message = firstMessage(payload);
  if (message) return message.trim();

  if (!payload && typeof value === "string" && value.trim()) {
    const text = value.trim();
    if (!isStackTrace(text)) return text;
  }

  return status ? `${fallback} (${status})` : fallback;
}
