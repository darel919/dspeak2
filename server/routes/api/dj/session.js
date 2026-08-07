import { requireAuthenticatedUser } from "../../../utils/auth.js";
import {
  requireRoomMember,
  getChannelById,
  getRoomById,
} from "../../../utils/room-authorization.js";
import { isActiveVoiceParticipant } from "../../../utils/mediasoup-sfu.js";
import { enforceIdentifierRateLimit } from "../../../utils/rate-limit.js";
import {
  closeDjSession,
  createDjSession,
  getDjSession,
} from "../../../domains/dj/dj-sessions.js";

export default defineEventHandler(async (event) => {
  const userId = await requireAuthenticatedUser(event);
  const method = getMethod(event);

  if (method === "POST") {
    enforceIdentifierRateLimit("dj-session-create", userId, 10, 60 * 1000);
    const body = await readBody(event);
    const channelId = String(body?.channelId || "");
    if (!channelId)
      throw createError({
        statusCode: 400,
        statusMessage: "channelId is required",
      });
    const channel = await getChannelById(channelId);
    if (!channel)
      throw createError({
        statusCode: 404,
        statusMessage: "Channel not found",
      });
    if (!["voice", "stage"].includes(channel.type))
      throw createError({
        statusCode: 400,
        statusMessage: "DJ Mode requires a voice channel",
      });
    const room = await getRoomById(channel.roomId);
    if (!room)
      throw createError({ statusCode: 404, statusMessage: "Room not found" });
    await requireRoomMember(room, userId);
    if (!(await isActiveVoiceParticipant(channelId, userId)))
      throw createError({
        statusCode: 409,
        statusMessage: "Join this voice channel before starting DJ Mode",
      });
    return createDjSession({ channelId, userId });
  }

  const sessionId = String(getQuery(event).sessionId || "");
  if (!sessionId)
    throw createError({
      statusCode: 400,
      statusMessage: "sessionId is required",
    });

  if (method === "GET") {
    const session = getDjSession(sessionId, userId);
    if (!session)
      throw createError({
        statusCode: 404,
        statusMessage: "DJ session not found",
      });
    return session;
  }

  if (method === "DELETE") {
    if (!closeDjSession(sessionId, userId))
      throw createError({
        statusCode: 404,
        statusMessage: "DJ session not found",
      });
    return { success: true };
  }

  throw createError({ statusCode: 405, statusMessage: "Method not allowed" });
});
