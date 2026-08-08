import { randomBytes } from "node:crypto";

const pendingSessions = new Map();
const ttlMs = 60_000;

export function createPendingOAuthSession(session) {
  const now = Date.now();
  for (const [key, pending] of pendingSessions)
    if (pending.expiresAt < now) pendingSessions.delete(key);
  while (pendingSessions.size >= 1000)
    pendingSessions.delete(pendingSessions.keys().next().value);
  const code = randomBytes(32).toString("base64url");
  pendingSessions.set(code, { session, expiresAt: now + ttlMs });
  return code;
}

export function consumePendingOAuthSession(code) {
  const normalized = String(code || "");
  const pending = pendingSessions.get(normalized);
  pendingSessions.delete(normalized);
  if (!pending || pending.expiresAt < Date.now()) return null;
  return pending.session;
}
