import { requireAuthenticatedUser } from "../../../utils/authentication.js";
import { requireRoomMember } from "../../../utils/room-authorization.js";
import { usePocketBaseAdmin } from "../../../utils/pocketbase.js";
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
    const pb = await usePocketBaseAdmin();
    const channel = await pb
      .collection("dspeak_rooms_channels")
      .getOne(channelId, { fields: "id,room,isMedia" });
    if (!channel.isMedia)
      throw createError({
        statusCode: 400,
        statusMessage: "DJ Mode requires a voice channel",
      });
    await requireRoomMember(pb, { id: channel.room }, userId);
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

  throw createError({
    statusCode: 405,
    statusMessage: "Method not allowed",
  });
});
