import { requireAuthenticatedUser } from "../../../utils/auth.js";
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
} from "../../../utils/friends-manager.js";

export default defineEventHandler(async (event) => {
  const userId = await requireAuthenticatedUser(event);
  const method = getMethod(event);

  try {
    if (method === "GET") {
      const query = getQuery(event);
      const type = query.type || "list";

      if (type === "requests") {
        return { items: await getFriendRequests(userId) };
      }

      if (type === "sent") {
        return { items: await getSentFriendRequests(userId) };
      }

      if (type === "status" && query.targetId) {
        return await getFriendshipStatus(userId, query.targetId);
      }

      if (type === "mutual" && query.targetId) {
        return { items: await getMutualFriends(userId, query.targetId) };
      }

      return { items: await getFriendsList(userId) };
    }

    if (method === "POST") {
      const body = await readBody(event);
      const { action, recipientHandle, targetUserId, requestId, accept } = body;

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
      const body = await readBody(event);
      const { friendId } = body;

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
    if (error.statusCode || error.status) throw error;
    throw createError({
      statusCode: 400,
      statusMessage: error.message || "Friend request failed",
    });
  }
});
