import { requireAuthenticatedUser } from "../../../utils/auth.ts";
import {
  getDirectMessages,
  markDirectMessagesDelivered,
  markDirectConversationRead,
  sendDirectMessage,
} from "../../../utils/direct-messages-manager.ts";
import { enforceRateLimit } from "../../../utils/rate-limit.ts";

export default defineEventHandler(async (event) => {
  const userId = await requireAuthenticatedUser(event);
  const conversationId = getRouterParam(event, "conversationId");
  if (!conversationId)
    throw createError({
      statusCode: 400,
      statusMessage: "Conversation ID is required",
    });
  try {
    if (event.method === "GET")
      return await getDirectMessages(userId, conversationId);
    if (event.method === "POST") {
      enforceRateLimit(event, "direct-message-send", userId, 120, 60 * 1000);
      const body = (await readBody(event)) as {
        content?: unknown;
        clientMessageId?: unknown;
      };
      if (
        typeof body.content !== "string" ||
        typeof body.clientMessageId !== "string"
      )
        throw createError({
          statusCode: 400,
          statusMessage: "Message content and client message ID are required",
        });
      return await sendDirectMessage(
        userId,
        conversationId,
        body.content,
        body.clientMessageId,
      );
    }
    if (event.method === "PATCH") {
      const body = (await readBody(event)) as {
        action?: unknown;
        messageIds?: unknown;
      };
      if (body?.action === "delivered")
        return await markDirectMessagesDelivered(
          userId,
          conversationId,
          body.messageIds,
        );
      return await markDirectConversationRead(userId, conversationId);
    }
    throw createError({ statusCode: 405, statusMessage: "Method not allowed" });
  } catch (error: unknown) {
    const errorRecord =
      error && typeof error === "object"
        ? (error as { statusCode?: number; status?: number; message?: string })
        : {};
    if (errorRecord.statusCode || errorRecord.status) throw error;
    throw createError({
      statusCode: 400,
      statusMessage: errorRecord.message || "Direct message request failed",
    });
  }
});
