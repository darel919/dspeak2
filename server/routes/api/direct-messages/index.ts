import { requireAuthenticatedUser } from "../../../utils/auth.ts";
import {
  listDirectConversations,
  openDirectConversation,
} from "../../../utils/direct-messages-manager.ts";
import { enforceRateLimit } from "../../../utils/rate-limit.ts";

export default defineEventHandler(async (event) => {
  const userId = await requireAuthenticatedUser(event);
  try {
    if (event.method === "GET")
      return { items: await listDirectConversations(userId) };
    if (event.method === "POST") {
      enforceRateLimit(
        event,
        "direct-conversation-open",
        userId,
        60,
        60 * 1000,
      );
      const body = await readBody(event);
      if (!body?.friendId)
        throw createError({
          statusCode: 400,
          statusMessage: "friendId is required",
        });
      return await openDirectConversation(userId, body.friendId);
    }
    throw createError({ statusCode: 405, statusMessage: "Method not allowed" });
  } catch (error) {
    if (error.statusCode || error.status) throw error;
    throw createError({
      statusCode: 400,
      statusMessage: error.message || "Direct message request failed",
    });
  }
});
