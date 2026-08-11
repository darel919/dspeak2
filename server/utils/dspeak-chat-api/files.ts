import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { chatFiles } from "../../db/schema/index.ts";
import { getRoomById, getChannelById } from "../room-authorization.ts";
import { cacheUploadedFile } from "../upload-cache.ts";
import { deleteObject, putObject } from "../../storage/r2.ts";

export function createChatFilesHandler(dependencies) {
  const {
    createError,
    enforceRateLimit,
    getHeader,
    requireRoomMember,
    requireValue,
    sendPushTest,
  } = dependencies;

  return async function handleRoute(event, suffix, userId, body) {
    if (suffix === "push/test" && event.method === "POST") {
      enforceRateLimit(event, "push-test", userId, 5, 60 * 60 * 1000);
      const deviceId = requireValue(
        getHeader(event, "x-dspeak-device"),
        "Device ID is required",
      );
      return sendPushTest(userId, deviceId);
    }

    if (suffix === "upload" && event.method === "POST") {
      enforceRateLimit(event, "chat-upload", userId, 30, 60 * 1000);
      const form = body;
      const channelId = requireValue(form.channelId, "Channel ID is required");
      const file = form.file;
      if (!file || !(file instanceof File))
        throw createError({
          statusCode: 400,
          statusMessage: "File is required",
        });
      if (file.size > 10 * 1024 * 1024)
        throw createError({
          statusCode: 413,
          statusMessage: "File exceeds 10MB limit",
        });
      const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
      if (!allowed.includes(file.type))
        throw createError({
          statusCode: 415,
          statusMessage: "File must be JPEG, PNG, WebP, or GIF",
        });
      const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
      const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
      const png = bytes.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10";
      const webp =
        String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
        String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
      const gif = ["GIF87a", "GIF89a"].includes(
        String.fromCharCode(...bytes.slice(0, 6)),
      );
      if (!jpeg && !png && !webp && !gif)
        throw createError({
          statusCode: 415,
          statusMessage: "Image file contents are invalid",
        });
      const channel = await getChannelById(channelId);
      if (!channel)
        throw createError({
          statusCode: 404,
          statusMessage: "Channel not found",
        });
      const room = await getRoomById(channel.roomId);
      if (!room)
        throw createError({ statusCode: 404, statusMessage: "Room not found" });
      await requireRoomMember(room, userId);
      const r2Key = `chat/${channelId}/legacy/${randomUUID()}`;
      let record;
      try {
        await putObject(r2Key, file, file.type, file.size);
        record = await db
          .insert(chatFiles)
          .values({
            id: randomUUID(),
            channelId,
            uploaderId: userId,
            fileName: file.name,
            mimeType: file.type,
            size: file.size,
            r2Key,
          })
          .returning();
      } catch (error) {
        await deleteObject(r2Key).catch(() => {});
        throw error;
      }
      const verifiedId = record[0].id;
      cacheUploadedFile(userId, {
        id: verifiedId,
        room_channel: channelId,
        name: record[0].fileName,
        size: record[0].size,
        mime_type: record[0].mimeType,
        width: 0,
        height: 0,
      });
      return {
        id: verifiedId,
        url: `/api/assets/chat-file?id=${verifiedId}`,
        name: record[0].fileName,
        size: record[0].size,
        mime_type: record[0].mimeType,
        width: 0,
        height: 0,
      };
    }

    if (suffix === "upload" && event.method === "DELETE") {
      enforceRateLimit(event, "chat-upload-delete", userId, 60, 60 * 1000);
      const fileId = requireValue(body.fileId, "File ID is required");
      const record = await db
        .select()
        .from(chatFiles)
        .where(eq(chatFiles.id, fileId))
        .limit(1);
      if (!record[0])
        throw createError({ statusCode: 404, statusMessage: "File not found" });
      if (String(record[0].uploaderId) !== String(userId))
        throw createError({
          statusCode: 403,
          statusMessage: "You can only remove your own upload",
        });
      if (record[0].messageId)
        throw createError({
          statusCode: 409,
          statusMessage: "Image is already attached to a message",
        });
      await db.delete(chatFiles).where(eq(chatFiles.id, fileId));
      return { deleted: true, id: record[0].id };
    }
    return undefined;
  };
}
