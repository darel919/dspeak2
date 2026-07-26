import { requireAuthenticatedUser } from "../../../utils/authentication.js";
import { usePocketBaseAdmin } from "../../../utils/pocketbase.js";
import { getBoundedList } from "../../../utils/pocketbase-query.js";

export default defineEventHandler(async (event) => {
  const userId = await requireAuthenticatedUser(event);
  const pb = await usePocketBaseAdmin();

  if (getMethod(event) !== "GET") {
    throw createError({ statusCode: 405, statusMessage: "Method not allowed" });
  }

  const since = getQuery(event).since || null;
  const limit = Math.min(Number(getQuery(event).limit) || 100, 200);

  const filterParts = [`recipient = '${userId}'`];
  if (since) {
    filterParts.push(`created >= '${since}'`);
  }

  const notifications = await getBoundedList(
    pb,
    "dspeak_notifications",
    {
      filter: filterParts.join(" && "),
      sort: "-created",
    },
    limit,
  );

  const unreadResult = await pb
    .collection("dspeak_notifications")
    .getList(1, 1, {
      filter: `recipient = '${userId}' && read_at = null`,
      fields: "id",
    })
    .catch(() => ({ totalItems: 0 }));

  return {
    items: notifications.map((n) => ({
      id: n.id,
      type: n.type || "message",
      title: n.title || "",
      body: n.body || "",
      room: n.room || null,
      channel: n.channel || null,
      message: n.message || null,
      actor: n.actor || null,
      read_at: n.read_at || null,
      created: n.created,
    })),
    unreadCount: unreadResult.totalItems || 0,
  };
});
