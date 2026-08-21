import { requireAuth } from "../../../auth/middleware.ts";
import { createUploadUrl, validateUpload } from "../../../storage/r2.ts";
import {
  channelRepository,
  membershipRepository,
} from "../../../db/repositories/rooms.ts";
import {
  getRoomById,
  requireRoomPermission,
} from "../../../utils/room-authorization.ts";
import { createUploadCleanupToken } from "../../../storage/upload-cleanup-token.ts";
import {
  parseExternalNumber,
  parseExternalRecord,
  parseExternalString,
  type ExternalField,
} from "../../../../shared/types/external.ts";
import type { R2ObjectIdentifiers } from "../../../types/storage.ts";

function parseUploadType(value: ExternalField | undefined) {
  switch (parseExternalString(value)) {
    case "avatar":
      return "avatar";
    case "room-profile":
      return "room-profile";
    case "room-header":
      return "room-header";
    case "chat":
      return "chat";
    case "soundboard":
      return "soundboard";
    default:
      return null;
  }
}

function parseIdentifiers(
  value: ExternalField | undefined,
): R2ObjectIdentifiers | null {
  const record = parseExternalRecord(value);
  const objectId = parseExternalString(record?.objectId);
  if (!objectId) return null;
  const identifiers: R2ObjectIdentifiers = { objectId };
  const roomId = parseExternalString(record?.roomId);
  const channelId = parseExternalString(record?.channelId);
  const messageId = parseExternalString(record?.messageId);
  if (roomId) identifiers.roomId = roomId;
  if (channelId) identifiers.channelId = channelId;
  if (messageId) identifiers.messageId = messageId;
  return identifiers;
}

export default defineEventHandler(async (event) => {
  await requireAuth(event);
  const user = event.context.user;

  const body = parseExternalRecord(await readBody(event));
  const type = parseUploadType(body?.type);
  const identifiers = parseIdentifiers(body?.identifiers);
  const mimeType = parseExternalString(body?.mimeType);
  const size = parseExternalNumber(body?.size);

  if (!type || !identifiers || !mimeType || size === null) {
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
    if (!identifiers.roomId)
      throw createError({
        statusCode: 400,
        statusMessage: "Room ID is required",
      });
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
    if (!identifiers.channelId)
      throw createError({
        statusCode: 400,
        statusMessage: "Channel ID is required",
      });
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

  const authorizedIdentifiers = { ...identifiers, userId: user.id };

  const result = await createUploadUrl(type, authorizedIdentifiers, mimeType);

  return {
    uploadUrl: result.uploadUrl,
    key: result.key,
    expiresIn: result.expiresIn,
    cleanupToken: createUploadCleanupToken(user.id, result.key),
  };
});
