import { requireAuthenticatedUser } from "../../../utils/authentication.js";
import {
  getFriendsList,
  getFriendRequests,
  sendFriendRequest,
  respondToFriendRequest,
  removeFriend,
} from "../../../utils/friends-manager.js";

export default defineEventHandler(async (event) => {
  const userId = await requireAuthenticatedUser(event);
  const method = getMethod(event);

  try {
    if (method === "GET") {
      const type = getQuery(event).type || "list";
      if (type === "requests") {
        return { items: await getFriendRequests(userId) };
      }
      return { items: await getFriendsList(userId) };
    }

    if (method === "POST") {
      const body = await readBody(event);
      const { action, recipientHandle, requestId, accept } = body;

      if (action === "send" && recipientHandle) {
        return await sendFriendRequest(userId, recipientHandle);
      }

      if (action === "respond" && requestId) {
        return await respondToFriendRequest(requestId, userId, Boolean(accept));
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
