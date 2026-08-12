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

const uploadTypes = [
  "avatar",
  "room-profile",
  "room-header",
  "chat",
  "soundboard",
] as const;
type UploadType = (typeof uploadTypes)[number];
interface UploadMetadata {
  roomId?: string;
  channelId?: string;
  messageId?: string;
  objectId: string;
  mimeType: string;
  size: number;
  fileName?: string;
  name?: string;
  volume?: number;
}

function requiredMetadataString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value)
    throw createError({
      statusCode: 400,
      statusMessage: `${label} is required`,
    });
  return value;
}

export default defineEventHandler(async (event) => {
  await requireAuth(event);
  const user = event.context.user;

  const body = (await readBody(event)) as {
    type?: unknown;
    key?: unknown;
    metadata?: unknown;
  };
  const typeValue = body.type;
  const type =
    typeof typeValue === "string" &&
    uploadTypes.includes(typeValue as UploadType)
      ? (typeValue as UploadType)
      : null;
  const key = typeof body.key === "string" ? body.key : "";
  const metadata =
    body.metadata && typeof body.metadata === "object"
      ? (body.metadata as UploadMetadata)
      : null;

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
    const roomId = requiredMetadataString(metadata.roomId, "Room ID");
    const room = await getRoomById(roomId);
    if (!room)
      throw createError({ statusCode: 404, statusMessage: "Room not found" });
    await requireRoomPermission(
      room,
      user.id,
      type === "soundboard" ? "room.manage_soundboard" : "room.update_identity",
    );
  }
  if (type === "chat") {
    const channelId = requiredMetadataString(metadata.channelId, "Channel ID");
    const channel = await channelRepository.findById(channelId);
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
          and(eq(messages.id, messageId), eq(messages.channelId, channelId)),
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
    "room-profile": `rooms/${String(metadata.roomId || "")}/profile/`,
    "room-header": `rooms/${String(metadata.roomId || "")}/headers/`,
    chat: `chat/${String(metadata.channelId || "")}/`,
    soundboard: `soundboards/${String(metadata.roomId || "")}/`,
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
      const roomId = requiredMetadataString(metadata.roomId, "Room ID");
      result = await db
        .insert(roomImages)
        .values({
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
      const channelId = requiredMetadataString(
        metadata.channelId,
        "Channel ID",
      );
      const messageId = metadata.messageId;
      const fileName = requiredMetadataString(metadata.fileName, "File name");
      result = await db
        .insert(chatFiles)
        .values({
          channelId,
          messageId: messageId || null,
          uploaderId: user.id,
          fileName,
          mimeType: metadata.mimeType,
          size: metadata.size,
          r2Key: key,
        })
        .returning();
      break;
    }
    case "soundboard": {
      const roomId = requiredMetadataString(metadata.roomId, "Room ID");
      const name = requiredMetadataString(metadata.name, "Soundboard name");
      result = await db
        .insert(soundboards)
        .values({
          roomId,
          name,
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
