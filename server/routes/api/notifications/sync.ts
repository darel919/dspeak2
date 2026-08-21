import { requireAuthenticatedUser } from "../../../utils/auth.ts";
import { db } from "../../../db/client.ts";
import { notifications } from "../../../db/schema/index.ts";
import { eq, and, desc, gte, count } from "drizzle-orm";
import { parseExternalRecord } from "../../../../shared/types/external.ts";

export default defineEventHandler(async (event) => {
  const userId = await requireAuthenticatedUser(event);

  if (getMethod(event) !== "GET") {
    throw createError({ statusCode: 405, statusMessage: "Method not allowed" });
  }

  const query = getQuery(event);
  const since = query.since ? new Date(String(query.since)) : null;
  if (since && !Number.isFinite(since.getTime()))
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid since date",
    });
  const requestedLimit = Number(query.limit);
  const limit = Number.isInteger(requestedLimit)
    ? Math.max(1, Math.min(requestedLimit, 200))
    : 100;

  const conditions = [eq(notifications.userId, userId)];
  if (since) conditions.push(gte(notifications.createdAt, since));

  const [notificationsList, unreadResult] = await Promise.all([
    db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt))
      .limit(limit),
    db
      .select({ count: count() })
      .from(notifications)
      .where(
        and(eq(notifications.userId, userId), eq(notifications.read, false)),
      ),
  ]);

  return {
    items: notificationsList.map((n) => {
      let data: Record<string, unknown> = {};
      try {
        const parsed = parseExternalRecord(n.data ? JSON.parse(n.data) : {});
        if (parsed) data = parsed;
      } catch {}
      return {
        id: n.id,
        type: n.type || "message",
        title: n.title || "",
        body: n.body || "",
        ...data,
        read_at: n.read ? n.createdAt : null,
        created: n.createdAt,
      };
    }),
    unreadCount: unreadResult[0]?.count || 0,
  };
});
