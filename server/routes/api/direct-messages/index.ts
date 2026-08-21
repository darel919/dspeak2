import { requireAuthenticatedUser } from "../../../utils/auth.ts";
import {
  listDirectConversations,
  openDirectConversation,
} from "../../../utils/direct-messages-manager.ts";
import { enforceRateLimit } from "../../../utils/rate-limit.ts";
import {
  parseExternalError,
  parseExternalRecord,
  parseExternalString,
} from "../../../../shared/types/external.ts";

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
      const body = parseExternalRecord(await readBody(event));
      const friendId = parseExternalString(body?.friendId);
      if (!friendId)
        throw createError({
          statusCode: 400,
          statusMessage: "friendId is required",
        });
      return await openDirectConversation(userId, friendId);
    }
    throw createError({ statusCode: 405, statusMessage: "Method not allowed" });
  } catch (error) {
    const errorDetails = parseExternalError(error);
    if (errorDetails.statusCode || errorDetails.status) throw error;
    throw createError({
      statusCode: 400,
      statusMessage: errorDetails.message || "Direct message request failed",
    });
  }
});
