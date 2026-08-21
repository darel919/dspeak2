import { db } from "../db/client.ts";
import { userPresence } from "../db/schema/index.ts";
import { eq, ne, and, lt } from "drizzle-orm";
import {
  type PresenceStatus,
  type PresenceUpdateOptions,
} from "../types/presence.ts";
import {
  parseExternalString,
  type ExternalField,
} from "../../shared/types/external.ts";

export const OFFLINE_AFTER_MS = 15 * 60 * 1000;

export function normalizePresenceStatus(value: ExternalField): PresenceStatus {
  const status = parseExternalString(value);
  switch (status) {
    case "online":
    case "idle":
    case "dnd":
    case "offline":
      return status;
    default:
      return "online";
  }
}

export async function setPresence(
  userId: string,
  status: ExternalField,
  { timestamp, isManualOverride, platform }: PresenceUpdateOptions = {},
) {
  const normalizedStatus = normalizePresenceStatus(status);
  const updatedAt = timestamp ? new Date(timestamp) : new Date();
  if (!Number.isFinite(updatedAt.getTime())) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid presence timestamp",
    });
  }
  const platformValue = parseExternalString(platform) || "web";
  await db
    .insert(userPresence)
    .values({
      userId,
      status: normalizedStatus,
      updatedAt,
      lastActivityAt: new Date(),
      isManualOverride: Boolean(isManualOverride),
      platform: platformValue,
    })
    .onConflictDoUpdate({
      target: userPresence.userId,
      set: {
        status: normalizedStatus,
        updatedAt,
        isManualOverride: Boolean(isManualOverride),
        platform: platformValue,
        lastActivityAt: new Date(),
      },
    });
  return {
    userId,
    status: normalizedStatus,
    updatedAt: updatedAt.toISOString(),
    isManualOverride: Boolean(isManualOverride),
    platform: platformValue,
  };
}

export async function markPresenceActivity(userId: string): Promise<boolean> {
  const result = await db
    .update(userPresence)
    .set({ lastActivityAt: new Date() })
    .where(
      and(eq(userPresence.userId, userId), ne(userPresence.status, "offline")),
    );
  return Number(result.count) > 0;
}

export async function markPresenceOffline(userId: string): Promise<boolean> {
  const result = await db
    .update(userPresence)
    .set({ status: "offline", updatedAt: new Date() })
    .where(eq(userPresence.userId, userId));
  return Number(result.count) > 0;
}

export async function sweepExpiredPresence(now = Date.now()) {
  const cutoff = new Date(now - OFFLINE_AFTER_MS);
  const expired = await db
    .update(userPresence)
    .set({ status: "offline", updatedAt: new Date() })
    .where(
      and(
        lt(userPresence.lastActivityAt, cutoff),
        ne(userPresence.status, "offline"),
      ),
    )
    .returning({ userId: userPresence.userId });
  return expired.map((row) => String(row.userId));
}

export async function getOnlinePresence() {
  const rows = await db
    .select()
    .from(userPresence)
    .where(ne(userPresence.status, "offline"))
    .orderBy(userPresence.updatedAt);
  return rows.map((row) => ({
    userId: String(row.userId),
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
    isManualOverride: row.isManualOverride,
    platform: row.platform || "web",
  }));
}
