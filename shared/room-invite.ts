export const INVITE_EXPIRY_OPTIONS = Object.freeze([
  { label: "30 minutes", seconds: 30 * 60 },
  { label: "1 hour", seconds: 60 * 60 },
  { label: "6 hours", seconds: 6 * 60 * 60 },
  { label: "1 day", seconds: 24 * 60 * 60 },
  { label: "7 days", seconds: 7 * 24 * 60 * 60 },
]);

export function encodeInvitePayload(payload: ExternalValue) {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function decodeInvitePayload(
  value: ExternalField,
): Record<string, unknown> | null {
  const encoded = parseExternalString(value);
  if (!encoded || encoded.length > 4096) return null;
  try {
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    const record = parseExternalRecord(payload);
    if (record === null) return null;
    if (
      !record.id ||
      !record.createdBy ||
      !record.createdAt ||
      !record.expiresAt ||
      !record.roomId
    )
      return null;
    return record;
  } catch {
    return null;
  }
}

export function validateInviteExpiry(seconds: ExternalField) {
  const value = Number(seconds);
  return INVITE_EXPIRY_OPTIONS.some((option) => option.seconds === value)
    ? value
    : null;
}
import {
  parseExternalRecord,
  parseExternalString,
  type ExternalField,
  type ExternalValue,
} from "./types/external.ts";
