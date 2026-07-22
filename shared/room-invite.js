export const INVITE_EXPIRY_OPTIONS = Object.freeze([
  { label: "30 minutes", seconds: 30 * 60 },
  { label: "1 hour", seconds: 60 * 60 },
  { label: "6 hours", seconds: 6 * 60 * 60 },
  { label: "1 day", seconds: 24 * 60 * 60 },
  { label: "7 days", seconds: 7 * 24 * 60 * 60 },
]);

export function encodeInvitePayload(payload) {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function decodeInvitePayload(value) {
  if (typeof value !== "string" || !value || value.length > 4096) return null;
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    if (
      !payload ||
      typeof payload !== "object" ||
      !payload.id ||
      !payload.createdBy ||
      !payload.createdAt ||
      !payload.expiresAt ||
      !payload.roomId
    )
      return null;
    return payload;
  } catch {
    return null;
  }
}

export function validateInviteExpiry(seconds) {
  const value = Number(seconds);
  return INVITE_EXPIRY_OPTIONS.some((option) => option.seconds === value)
    ? value
    : null;
}
