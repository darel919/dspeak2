import { requireAuth } from "../../../auth/middleware.ts";
import { db } from "../../../db/client.ts";
import {
  chatFiles,
  avatars,
  messages,
  profiles,
  roomImages,
  soundboards,
} from "../../../db/schema/index.ts";
import { getObjectMetadata, validateUpload } from "../../../storage/r2.ts";
import {
  channelRepository,
  membershipRepository,
} from "../../../db/repositories/rooms.ts";
import {
  getRoomById,
  requireRoomPermission,
} from "../../../utils/room-authorization.ts";
import { and, eq } from "drizzle-orm";

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
    const room = await getRoomById(metadata.roomId);
    if (!room)
      throw createError({ statusCode: 404, statusMessage: "Room not found" });
    await requireRoomPermission(
      room,
      user.id,
      type === "soundboard" ? "room.manage_soundboard" : "room.update_identity",
    );
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
    if (metadata.messageId != null) {
      const messageId = String(metadata.messageId);
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          messageId,
        )
      )
        throw createError({
          statusCode: 400,
          statusMessage: "Invalid message ID",
        });
      const message = await db
        .select({ id: messages.id, authorId: messages.authorId })
        .from(messages)
        .where(
          and(
            eq(messages.id, messageId),
            eq(messages.channelId, metadata.channelId),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]);
      if (!message)
        throw createError({
          statusCode: 400,
          statusMessage: "Message attachment target was not found",
        });
      if (String(message.authorId) !== String(user.id))
        throw createError({
          statusCode: 403,
          statusMessage: "Only the message author can attach this file",
        });
    }
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
      result = await db.transaction(async (tx) => {
        const avatarResult = await tx
          .insert(avatars)
          .values({
            id: objectId,
            userId: user.id,
            r2Key: key,
            mimeType: metadata.mimeType,
            size: metadata.size,
          })
          .returning();
        const profileResult = await tx
          .update(profiles)
          .set({ avatarKey: key, updatedAt: new Date() })
          .where(eq(profiles.id, user.id))
          .returning({ id: profiles.id });
        if (!profileResult[0])
          throw createError({
            statusCode: 409,
            statusMessage: "User profile was not found",
          });
        return avatarResult;
      });
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
          messageId: messageId || null,
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
