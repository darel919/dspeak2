import { db } from "../db/client.ts";
import { avatars, chatFiles } from "../db/schema/index.ts";
import { createDownloadUrl } from "../storage/r2.ts";
import {
  getChannelById,
  getRoomById,
  requireRoomMember,
} from "./room-authorization.ts";
import { requireAuthenticatedUser } from "./auth.ts";
import { desc, eq } from "drizzle-orm";

function requireValue(value, message) {
  if (!value) throw createError({ statusCode: 400, statusMessage: message });
  return value;
}

export async function handleAssets(event, suffix) {
  if (event.method !== "GET")
    throw createError({
      statusCode: 404,
      statusMessage: "Asset endpoint not found",
    });

  const authenticatedUserId = await requireAuthenticatedUser(event);
  const query = getQuery(event);

  if (suffix === "chat-file") {
    const fileId = requireValue(query.id, "Chat file ID is required");
    const fileRows = await db
      .select()
      .from(chatFiles)
      .where(eq(chatFiles.id, fileId))
      .limit(1);
    const file = fileRows[0];
    if (!file)
      throw createError({
        statusCode: 404,
        statusMessage: "Chat file not found",
      });
    const channel = await getChannelById(file.channelId);
    if (!channel)
      throw createError({
        statusCode: 404,
        statusMessage: "Channel not found",
      });
    const room = await getRoomById(channel.roomId);
    if (!room)
      throw createError({ statusCode: 404, statusMessage: "Room not found" });
    await requireRoomMember(room, authenticatedUserId);
    const url = await createDownloadUrl(file.r2Key);
    setHeader(event, "Cache-Control", "private, max-age=604800, immutable");
    setHeader(
      event,
      "Content-Type",
      file.mimeType || "application/octet-stream",
    );
    setHeader(event, "X-Content-Type-Options", "nosniff");
    return sendRedirect(event, url, 302);
  }

  if (suffix === "avatar") {
    const targetUserId = requireValue(query.userId, "User ID is required");
    const requestedFileName = requireValue(
      query.fileName,
      "Avatar filename is required",
    );
    const avatarRows = await db
      .select()
      .from(avatars)
      .where(eq(avatars.userId, targetUserId))
      .orderBy(desc(avatars.createdAt))
      .limit(1);
    const avatar = avatarRows[0];
    if (!avatar || avatar.r2Key !== requestedFileName)
      throw createError({
        statusCode: 404,
        statusMessage: "Avatar not found",
      });
    const url = await createDownloadUrl(avatar.r2Key);
    setHeader(event, "Cache-Control", "private, max-age=604800, immutable");
    setHeader(event, "Content-Type", avatar.mimeType || "image/jpeg");
    setHeader(event, "X-Content-Type-Options", "nosniff");
    return sendRedirect(event, url, 302);
  }

  throw createError({
    statusCode: 404,
    statusMessage: "Asset endpoint not found",
  });
}
