import { requireAuthenticatedUser } from "../../../utils/auth.ts";
import {
  getDirectMessages,
  markDirectMessagesDelivered,
  markDirectConversationRead,
  sendDirectMessage,
} from "../../../utils/direct-messages-manager.ts";
import { enforceRateLimit } from "../../../utils/rate-limit.ts";
import { getQuery } from "h3";
import {
  parseExternalError,
  parseExternalRecord,
  parseExternalString,
} from "../../../../shared/types/external.ts";

export default defineEventHandler(async (event) => {
  const userId = await requireAuthenticatedUser(event);
  const conversationId = getRouterParam(event, "conversationId");
  if (!conversationId)
    throw createError({
      statusCode: 400,
      statusMessage: "Conversation ID is required",
    });
  try {
    if (event.method === "GET") {
      const query = getQuery(event);
      return await getDirectMessages(userId, conversationId, {
        before: query.before,
        beforeId: query.beforeId,
      });
    }
    if (event.method === "POST") {
      enforceRateLimit(event, "direct-message-send", userId, 120, 60 * 1000);
      const body = parseExternalRecord(await readBody(event));
      const content = parseExternalString(body?.content);
      const clientMessageId = parseExternalString(body?.clientMessageId);
      if (content === null || clientMessageId === null)
        throw createError({
          statusCode: 400,
          statusMessage: "Message content and client message ID are required",
        });
      return await sendDirectMessage(
        userId,
        conversationId,
        content,
        clientMessageId,
      );
    }
    if (event.method === "PATCH") {
      const body = parseExternalRecord(await readBody(event));
      if (parseExternalString(body?.action) === "delivered")
        return await markDirectMessagesDelivered(
          userId,
          conversationId,
          body?.messageIds,
        );
      return await markDirectConversationRead(userId, conversationId);
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
