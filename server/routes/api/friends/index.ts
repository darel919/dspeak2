import { requireAuthenticatedUser } from "../../../utils/auth.ts";
import {
  getFriendsList,
  getFriendRequests,
  getSentFriendRequests,
  getFriendshipStatus,
  getMutualFriends,
  sendFriendRequest,
  sendFriendRequestById,
  respondToFriendRequest,
  cancelFriendRequest,
  removeFriend,
} from "../../../utils/friends-manager.ts";
import {
  parseExternalBoolean,
  parseExternalError,
  parseExternalRecord,
  parseExternalString,
} from "../../../../shared/types/external.ts";

export default defineEventHandler(async (event) => {
  const userId = await requireAuthenticatedUser(event);
  const method = getMethod(event);

  try {
    if (method === "GET") {
      const query = getQuery(event);
      const type = String(query.type || "list");

      if (type === "requests") {
        return { items: await getFriendRequests(userId) };
      }

      if (type === "sent") {
        return { items: await getSentFriendRequests(userId) };
      }

      if (type === "status" && query.targetId) {
        return await getFriendshipStatus(userId, String(query.targetId));
      }

      if (type === "mutual" && query.targetId) {
        return {
          items: await getMutualFriends(userId, String(query.targetId)),
        };
      }

      return { items: await getFriendsList(userId) };
    }

    if (method === "POST") {
      const body = parseExternalRecord(await readBody(event));
      const action = parseExternalString(body?.action);
      const recipientHandle = parseExternalString(body?.recipientHandle);
      const targetUserId = parseExternalString(body?.targetUserId);
      const requestId = parseExternalString(body?.requestId);
      const accept =
        parseExternalBoolean(body?.accept) ?? parseExternalString(body?.accept);

      if (action === "send" && recipientHandle) {
        return await sendFriendRequest(userId, recipientHandle);
      }

      if (action === "send" && targetUserId) {
        return await sendFriendRequestById(userId, targetUserId);
      }

      if (action === "respond" && requestId) {
        return await respondToFriendRequest(
          requestId,
          userId,
          accept === true || accept === "true",
        );
      }

      if (action === "cancel" && requestId) {
        return await cancelFriendRequest(requestId, userId);
      }

      throw createError({ statusCode: 400, statusMessage: "Invalid request" });
    }

    if (method === "DELETE") {
      const body = parseExternalRecord(await readBody(event));
      const friendId = parseExternalString(body?.friendId);

      if (!friendId) {
        throw createError({
          statusCode: 400,
          statusMessage: "friendId is required",
        });
      }

      return await removeFriend(userId, friendId);
    }

    throw createError({ statusCode: 405, statusMessage: "Method not allowed" });
  } catch (error) {
    const errorDetails = parseExternalError(error);
    if (errorDetails.statusCode || errorDetails.status) throw error;
    throw createError({
      statusCode: 400,
      statusMessage: errorDetails.message || "Friend request failed",
    });
  }
});
