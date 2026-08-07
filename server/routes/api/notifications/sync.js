import { requireAuthenticatedUser } from "../../../utils/auth.js";
import { db } from "../../../db/client.js";
import {
  notifications,
  notificationPreferences,
} from "../../../db/schema/index.js";
import { eq, and, desc, gte, isNull, count } from "drizzle-orm";

export default defineEventHandler(async (event) => {
  const userId = await requireAuthenticatedUser(event);

  if (getMethod(event) !== "GET") {
    throw createError({ statusCode: 405, statusMessage: "Method not allowed" });
  }

  const since = getQuery(event).since || null;
  const limit = Math.min(Number(getQuery(event).limit) || 100, 200);

  const conditions = [eq(notifications.userId, userId)];
  if (since) {
    conditions.push(gte(notifications.createdAt, new Date(since)));
  }

  const notificationsList = await db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  const unreadResult = await db
    .select({ count: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));

  return {
    items: notificationsList.map((n) => ({
      id: n.id,
      type: n.type || "message",
      title: n.title || "",
      body: n.body || "",
      room: n.roomId || null,
      channel: n.channelId || null,
      message: n.messageId || null,
      actor: n.actorId || null,
      read_at: n.readAt || null,
      created: n.createdAt,
    })),
    unreadCount: unreadResult[0]?.count || 0,
  };
});
