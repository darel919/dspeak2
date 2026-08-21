import type { ApiErrorPayload } from "./types/api.ts";
import { isExternalRecord, isExternalString } from "./types/boundary.ts";

function parsePayload<T>(value: T): ApiErrorPayload | null {
  if (isExternalRecord(value)) return value;
  if (!isExternalString(value) || !value.trim()) return null;

  try {
    const parsed = JSON.parse(value);
    return isExternalRecord(parsed) ? parsed : null;
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
      isExternalString(message) && Boolean(message.trim()),
  );
}

function isStackTrace(value: string): boolean {
  return /^Error(?::|\s)/i.test(value) || /\n\s*at\s+/.test(value);
}

function isHtmlDocument(value: string): boolean {
  return /<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]|<style[\s>]|<script[\s>]/i.test(
    value,
  );
}

export function apiErrorMessage<T>(
  value: T,
  status: number | null | undefined,
  fallback = "Request failed",
): string {
  const payload = parsePayload(value);
  const message = firstMessage(payload);
  if (message) return message.trim();

  if (!payload && isExternalString(value) && value.trim()) {
    const text = value.trim();
    if (!isStackTrace(text) && !isHtmlDocument(text)) return text;
  }

  return status ? `${fallback} (${status})` : fallback;
}
