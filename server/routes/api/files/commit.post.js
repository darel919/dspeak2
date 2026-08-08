import { requireAuth } from "../../../auth/middleware.js";
import { db } from "../../../db/client.js";
import {
  chatFiles,
  avatars,
  roomImages,
  soundboards,
} from "../../../db/schema/index.js";
import { getObjectMetadata, validateUpload } from "../../../storage/r2.js";
import {
  channelRepository,
  membershipRepository,
} from "../../../db/repositories/rooms.js";
import { eq } from "drizzle-orm";

export default defineEventHandler(async (event) => {
  await requireAuth(event);
  const user = event.context.user;

  const body = await readBody(event);
  const { type, key, metadata } = body;

  if (!type || !key) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing required fields",
    });
  }

  if (!metadata || typeof metadata !== "object")
    throw createError({
      statusCode: 400,
      statusMessage: "File metadata is required",
    });
  let objectMetadata;
  try {
    objectMetadata = await getObjectMetadata(key);
  } catch {
    throw createError({
      statusCode: 409,
      statusMessage: "Uploaded object is not available",
    });
  }
  const validation = validateUpload(type, metadata.mimeType, metadata.size);
  if (!validation.valid)
    throw createError({ statusCode: 400, statusMessage: validation.error });
  if (
    objectMetadata.contentLength !== Number(metadata.size) ||
    objectMetadata.contentType !== String(metadata.mimeType).toLowerCase()
  )
    throw createError({
      statusCode: 409,
      statusMessage: "Uploaded object metadata does not match",
    });

  if (["room-profile", "room-header", "soundboard"].includes(type)) {
    const membership = await membershipRepository.findByRoomAndUser(
      metadata.roomId,
      user.id,
    );
    if (!membership)
      throw createError({
        statusCode: 403,
        statusMessage: "Room access is required",
      });
  }
  if (type === "chat") {
    const channel = await channelRepository.findById(metadata.channelId);
    const membership = channel
      ? await membershipRepository.findByRoomAndUser(channel.roomId, user.id)
      : null;
    if (!membership)
      throw createError({
        statusCode: 403,
        statusMessage: "Channel access is required",
      });
  }

  const expectedPrefix = {
    avatar: `avatars/${user.id}/`,
    "room-profile": `rooms/${metadata.roomId}/profile/`,
    "room-header": `rooms/${metadata.roomId}/headers/`,
    chat: `chat/${metadata.channelId}/`,
    soundboard: `soundboards/${metadata.roomId}/`,
  }[type];
  if (!expectedPrefix || !key.startsWith(expectedPrefix))
    throw createError({
      statusCode: 403,
      statusMessage: "File key is not authorized",
    });

  let result;
  switch (type) {
    case "avatar": {
      const { objectId } = metadata;
      result = await db
        .insert(avatars)
        .values({
          id: objectId,
          userId: user.id,
          r2Key: key,
          mimeType: metadata.mimeType,
          size: metadata.size,
        })
        .returning();
      break;
    }
    case "room-profile":
    case "room-header": {
      const { roomId, objectId } = metadata;
      result = await db
        .insert(roomImages)
        .values({
          id: objectId,
          roomId,
          type: type === "room-header" ? "header" : "profile",
          r2Key: key,
          mimeType: metadata.mimeType,
          size: metadata.size,
        })
        .returning();
      break;
    }
    case "chat": {
      const { channelId, messageId, objectId } = metadata;
      result = await db
        .insert(chatFiles)
        .values({
          id: objectId,
          channelId,
          messageId,
          uploaderId: user.id,
          fileName: metadata.fileName,
          mimeType: metadata.mimeType,
          size: metadata.size,
          r2Key: key,
        })
        .returning();
      break;
    }
    case "soundboard": {
      const { roomId, objectId } = metadata;
      result = await db
        .insert(soundboards)
        .values({
          id: objectId,
          roomId,
          name: metadata.name,
          audioKey: key,
          volume: metadata.volume || 100,
          createdById: user.id,
        })
        .returning();
      break;
    }
    default:
      throw createError({
        statusCode: 400,
        statusMessage: "Unknown file type",
      });
  }

  return { success: true, record: result[0] };
});
