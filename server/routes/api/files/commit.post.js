import { requireAuth } from "../../../auth/middleware.js";
import { db } from "../../../db/client.js";
import {
  chatFiles,
  avatars,
  roomImages,
  soundboards,
} from "../../../db/schema/index.js";
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

  // Verify the object exists in R2 (would be done via HEAD request in production)
  // For now, we trust the client and record metadata

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
    case "room-profile": {
      const { roomId, objectId } = metadata;
      result = await db
        .insert(roomImages)
        .values({
          id: objectId,
          roomId,
          type: "profile",
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
