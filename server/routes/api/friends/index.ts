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
      const body = (await readBody(event)) as Record<string, unknown>;
      const { action, recipientHandle, targetUserId, requestId, accept } = body;

      if (action === "send" && recipientHandle) {
        return await sendFriendRequest(userId, String(recipientHandle));
      }

      if (action === "send" && targetUserId) {
        return await sendFriendRequestById(userId, String(targetUserId));
      }

      if (action === "respond" && requestId) {
        return await respondToFriendRequest(
          String(requestId),
          userId,
          accept === true || accept === "true",
        );
      }

      if (action === "cancel" && requestId) {
        return await cancelFriendRequest(String(requestId), userId);
      }

      throw createError({ statusCode: 400, statusMessage: "Invalid request" });
    }

    if (method === "DELETE") {
      const body = (await readBody(event)) as { friendId?: unknown };
      const { friendId } = body;

      if (!friendId) {
        throw createError({
          statusCode: 400,
          statusMessage: "friendId is required",
        });
      }

      return await removeFriend(userId, String(body.friendId));
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
      statusMessage: errorRecord.message || "Friend request failed",
    });
  }
});
