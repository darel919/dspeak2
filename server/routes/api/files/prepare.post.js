import { requireAuth } from "../../../auth/middleware.js";
import { createUploadUrl, validateUpload } from "../../../storage/r2.js";
import {
  channelRepository,
  membershipRepository,
} from "../../../db/repositories/rooms.js";
import {
  getRoomById,
  requireRoomPermission,
} from "../../../utils/room-authorization.js";
import { createUploadCleanupToken } from "../../../storage/upload-cleanup-token.js";

export default defineEventHandler(async (event) => {
  await requireAuth(event);
  const user = event.context.user;

  const body = await readBody(event);
  const { type, identifiers, mimeType, size } = body;

  if (!type || !identifiers || !mimeType || size == null) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing required fields",
    });
  }

  const validation = validateUpload(type, mimeType, size);
  if (!validation.valid) {
    throw createError({ statusCode: 400, statusMessage: validation.error });
  }

  if (["room-profile", "room-header", "soundboard"].includes(type)) {
    const room = await getRoomById(identifiers.roomId);
    if (!room)
      throw createError({ statusCode: 404, statusMessage: "Room not found" });
    await requireRoomPermission(
      room,
      user.id,
      type === "soundboard" ? "room.manage_soundboard" : "room.update_identity",
    );
  }
  if (type === "chat") {
    const channel = await channelRepository.findById(identifiers.channelId);
    const membership = channel
      ? await membershipRepository.findByRoomAndUser(channel.roomId, user.id)
      : null;
    if (!membership)
      throw createError({
        statusCode: 403,
        statusMessage: "Channel access is required",
      });
  }

  identifiers.userId = user.id;

  const result = await createUploadUrl(type, identifiers, mimeType);

  return {
    uploadUrl: result.uploadUrl,
    key: result.key,
    expiresIn: result.expiresIn,
    cleanupToken: createUploadCleanupToken(user.id, result.key),
  };
});
