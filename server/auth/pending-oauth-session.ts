import { randomBytes } from "node:crypto";
import type { PendingOAuthSession } from "../types/auth.ts";
import type { Session } from "@supabase/supabase-js";
import type { ExternalField } from "../../shared/types/external.ts";

const pendingSessions = new Map<string, PendingOAuthSession>();
const ttlMs = 60_000;

export function createPendingOAuthSession(session: Session): string {
  const now = Date.now();
  for (const [key, pending] of pendingSessions)
    if (pending.expiresAt < now) pendingSessions.delete(key);
  while (pendingSessions.size >= 1000) {
    const oldest = pendingSessions.keys().next().value;
    if (oldest === undefined) break;
    pendingSessions.delete(oldest);
  }
  const code = randomBytes(32).toString("base64url");
  pendingSessions.set(code, { session, expiresAt: now + ttlMs });
  return code;
}

export function consumePendingOAuthSession(code: ExternalField) {
  const normalized = String(code || "");
  const pending = pendingSessions.get(normalized);
  pendingSessions.delete(normalized);
  if (!pending || pending.expiresAt < Date.now()) return null;
  return pending.session;
}
