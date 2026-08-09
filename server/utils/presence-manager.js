import { db } from "../db/client.js";
import { userPresence } from "../db/schema/index.js";
import { eq, ne, and, lt } from "drizzle-orm";

export const PRESENCE_STATUSES = ["online", "idle", "dnd", "offline"];

export const OFFLINE_AFTER_MS = 15 * 60 * 1000;

export function normalizePresenceStatus(value) {
  return PRESENCE_STATUSES.includes(value) ? value : "online";
}

export async function setPresence(
  userId,
  status,
  { timestamp, isManualOverride, platform } = {},
) {
  const normalizedStatus = normalizePresenceStatus(status);
  const updatedAt = timestamp ? new Date(timestamp) : new Date();
  if (!Number.isFinite(updatedAt.getTime())) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid presence timestamp",
    });
  }
  const platformValue =
    typeof platform === "string" && platform ? platform : "web";
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

export async function markPresenceActivity(userId) {
  const result = await db
    .update(userPresence)
    .set({ lastActivityAt: new Date() })
    .where(
      and(eq(userPresence.userId, userId), ne(userPresence.status, "offline")),
    );
  return result.rowCount > 0;
}

export async function markPresenceOffline(userId) {
  const result = await db
    .update(userPresence)
    .set({ status: "offline", updatedAt: new Date() })
    .where(eq(userPresence.userId, userId));
  return result.rowCount > 0;
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
