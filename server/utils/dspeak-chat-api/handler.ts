import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db/client.ts";
import {
  messages,
  profiles,
  notifications,
  notificationPreferences,
  roomNotificationPreferences,
  chatFiles,
} from "../../db/schema/index.ts";
import { getRoomById } from "../room-authorization.ts";
import { notificationModeFromRecord } from "../../../shared/notification-policy.ts";
import { getCachedFile } from "../upload-cache.ts";
import { createChatDiscoveryHandler } from "./discovery.ts";
import { createChatFilesHandler } from "./files.ts";
import { createChatInteractionsHandler } from "./interactions.ts";
import { createChatMessagesHandler } from "./messages.ts";
import type { H3Event } from "h3";
import type {
  ChatApiDependencies,
  ChatAttachmentFile,
  ChatMessageRow,
  ChatAttachmentRecord,
  ChatProfileRow,
  ChatRouteDependencies,
} from "../../types/chat-api.ts";
import type { DSpeakProfileInput } from "../../types/dspeak-api.ts";
import {
  parseExternalRecord,
  parseExternalString,
  type ExternalField,
  type ExternalRecord,
} from "../../../shared/types/external.ts";

function createChatApiHandler(dependencies: ChatApiDependencies) {
  const {
    broadcastToUser,
    createError,
    getQuery,
    parseBody,
    presentUser,
    requireAuthenticatedUser,
    requireRoomMember,
    requireValue,
  } = dependencies;

  function presentMessageRecord(
    message: ChatMessageRow,
    author: DSpeakProfileInput | null | undefined,
    files: ChatAttachmentFile[] = [],
  ) {
    return {
      id: message.id,
      content: message.content,
      room_channel: message.channelId,
      sender: presentUser(author, true),
      created: message.createdAt,
      updated: message.updatedAt,
      edited_at: null,
      client_id: message.clientId || null,
      read_by: Array.isArray(message.readBy) ? message.readBy : [],
      attachments: files.map((file) => ({
        id: file.id,
        url: `/api/assets/chat-file?id=${encodeURIComponent(file.id)}`,
        name: file.fileName,
        size: file.size,
        mime_type: file.mimeType,
      })),
      reply_to: message.replyToId || null,
      pinned: false,
    };
  }

  async function presentMessage(message: ChatMessageRow) {
    const [author, files] = await Promise.all([
      db
        .select()
        .from(profiles)
        .where(eq(profiles.id, message.authorId))
        .limit(1),
      db.select().from(chatFiles).where(eq(chatFiles.messageId, message.id)),
    ]);
    return presentMessageRecord(message, author[0], files);
  }

  async function presentMessages(rows: ChatMessageRow[]) {
    if (!rows.length) return [];
    const authorIds: string[] = [
      ...new Set(rows.map((row) => row.authorId).filter(Boolean)),
    ];
    const messageIds = rows.map((row) => row.id).filter(Boolean);
    const [authors, files] = await Promise.all([
      authorIds.length
        ? db.select().from(profiles).where(inArray(profiles.id, authorIds))
        : [],
      messageIds.length
        ? db
            .select()
            .from(chatFiles)
            .where(inArray(chatFiles.messageId, messageIds))
        : [],
    ]);
    const authorById = new Map<string, ChatProfileRow>(
      authors.map((author) => [String(author.id), author]),
    );
    const filesByMessageId = new Map<string, ChatAttachmentFile[]>();
    for (const file of files) {
      const messageFiles = filesByMessageId.get(String(file.messageId)) || [];
      messageFiles.push(file);
      filesByMessageId.set(String(file.messageId), messageFiles);
    }
    return rows.map((row) =>
      presentMessageRecord(
        row,
        authorById.get(String(row.authorId)),
        filesByMessageId.get(String(row.id)) || [],
      ),
    );
  }

  function presentNotificationPreferences(
    row: Record<string, unknown> | null | undefined,
  ) {
    if (!row)
      return {
        mode: "all",
        push: false,
        sound: true,
        previews: true,
        attenuation_override: { mode: "room", reductionPercent: 65 },
      };
    return {
      ...row,
      mode: notificationModeFromRecord(row),
      push: row.push === true,
      sound: row.sound !== false,
      previews: row.previews !== false,
      attenuation_override: { mode: "room", reductionPercent: 65 },
    };
  }

  function presentRoomNotificationPreferences(
    row: Record<string, unknown> | null | undefined,
    roomId: string,
  ) {
    return row
      ? {
          ...row,
          room: roomId,
          mode: row.allMessages ? "all" : row.mentions ? "mentions" : "muted",
          push: null,
          sound: null,
        }
      : { room: roomId, mode: "all", push: null, sound: null };
  }

  function parseNotificationData(value: ExternalField): ExternalRecord {
    try {
      return parseExternalRecord(JSON.parse(String(value))) ?? {};
    } catch {
      return {};
    }
  }

  async function validateReplyTarget(
    replyTo: string | null | undefined,
    channelId: string,
  ) {
    if (!replyTo) return null;
    const target = await db
      .select()
      .from(messages)
      .where(eq(messages.id, replyTo))
      .limit(1);
    if (!target[0]) return null;
    if (String(target[0].channelId) !== String(channelId))
      throw createError({
        statusCode: 400,
        statusMessage: "Reply target must be in the same channel",
      });
    return target[0].replyToId || target[0].id;
  }

  async function validateMessageAttachments(
    submittedAttachments: ExternalField,
    channelId: string,
    userId: string,
  ) {
    if (submittedAttachments == null) return [];
    if (!Array.isArray(submittedAttachments) || submittedAttachments.length > 4)
      throw createError({
        statusCode: 400,
        statusMessage: "A message can include up to 4 images",
      });
    const attachments: ChatAttachmentRecord[] = [];
    const seen = new Set<string>();
    for (const submitted of submittedAttachments) {
      const submittedRecord = parseExternalRecord(submitted);
      const id = parseExternalString(submittedRecord?.id) || "";
      if (!id || seen.has(id))
        throw createError({
          statusCode: 400,
          statusMessage: "Invalid image attachment",
        });
      seen.add(id);
      const cachedValue = getCachedFile(id);
      const cached: ChatAttachmentFile | null = cachedValue
        ? {
            id: cachedValue.id,
            uploaderId: cachedValue.uploader,
            channelId: cachedValue.room_channel,
            messageId: null,
            fileName: cachedValue.name,
            mimeType: cachedValue.mime_type,
            size: cachedValue.size,
          }
        : null;
      const record = cached
        ? cached
        : await db
            .select()
            .from(chatFiles)
            .where(eq(chatFiles.id, id))
            .limit(1)
            .then((rows) => rows[0]);
      if (!record)
        throw createError({
          statusCode: 404,
          statusMessage: "Image attachment was not found",
        });
      if (
        String(record.uploaderId) !== String(userId) ||
        String(record.channelId) !== String(channelId)
      )
        throw createError({
          statusCode: 403,
          statusMessage: "Image attachment is not available in this channel",
        });
      if (record.messageId) {
        const attachedMessage = await db
          .select()
          .from(messages)
          .where(eq(messages.id, record.messageId))
          .limit(1);
        if (
          attachedMessage[0] &&
          String(attachedMessage[0].authorId) !== String(userId)
        )
          throw createError({
            statusCode: 409,
            statusMessage: "Image is already attached to a message",
          });
      }
      attachments.push({
        id: record.id,
        url: `/api/assets/chat-file?id=${encodeURIComponent(record.id)}`,
        name: record.fileName,
        size: record.size,
        mime_type: record.mimeType,
        width: 0,
        height: 0,
      });
    }
    return attachments;
  }

  async function handleNotifications(
    event: H3Event,
    userId: string,
    suffix: string,
  ) {
    const body: Record<string, unknown> =
      event.method === "GET" ? {} : await parseBody(event);
    if (suffix === "notifications" && event.method === "GET") {
      const items = await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, userId))
        .orderBy(desc(notifications.createdAt))
        .limit(100);
      return {
        page: 1,
        perPage: 100,
        totalItems: items.length,
        totalPages: 1,
        items: items.map((item) => {
          const data = parseNotificationData(item.data);
          return {
            id: item.id,
            type: item.type,
            title: item.title || "",
            body: item.body || "",
            read_at: item.read ? item.createdAt : null,
            created: item.createdAt,
            actor: null,
            room: null,
            channel: null,
            message: item.data ? { id: data.messageId || null } : null,
          };
        }),
      };
    }
    if (suffix === "notifications/read" && event.method === "POST") {
      const submittedIds = Array.isArray(body.ids)
        ? body.ids.slice(0, 100)
        : [];
      const readAt = new Date();
      let targets;
      if (submittedIds.length) {
        targets = await db
          .select()
          .from(notifications)
          .where(
            and(
              eq(notifications.userId, userId),
              inArray(notifications.id, submittedIds),
            ),
          )
          .limit(100);
      } else {
        targets = await db
          .select()
          .from(notifications)
          .where(
            and(
              eq(notifications.userId, userId),
              eq(notifications.read, false),
            ),
          )
          .limit(500);
      }
      if (targets.length)
        await db
          .update(notifications)
          .set({ read: true })
          .where(
            and(
              eq(notifications.userId, userId),
              inArray(
                notifications.id,
                targets.map((t) => t.id),
              ),
            ),
          );
      broadcastToUser(String(userId), {
        type: "notifications_read",
        data: { ids: submittedIds },
      });
      return { success: true, readAt: readAt.toISOString() };
    }
    if (suffix === "notifications/dismiss" && event.method === "POST") {
      const submittedIds = Array.isArray(body.ids)
        ? body.ids.slice(0, 100)
        : [];
      let targets;
      if (submittedIds.length) {
        targets = await db
          .select({ id: notifications.id })
          .from(notifications)
          .where(
            and(
              eq(notifications.userId, userId),
              inArray(notifications.id, submittedIds),
            ),
          )
          .limit(100);
      } else {
        targets = await db
          .select({ id: notifications.id })
          .from(notifications)
          .where(eq(notifications.userId, userId))
          .limit(500);
      }
      if (targets.length)
        await db.delete(notifications).where(
          and(
            eq(notifications.userId, userId),
            inArray(
              notifications.id,
              targets.map((t) => t.id),
            ),
          ),
        );
      broadcastToUser(String(userId), {
        type: "notifications_changed",
      });
      return { success: true };
    }
    if (suffix === "notification-preferences") {
      const existing = await db
        .select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, userId))
        .limit(1);
      if (event.method === "GET")
        return presentNotificationPreferences(existing[0]);
      if (event.method === "PUT") {
        const data = {
          userId,
          allMessages: body.mode === "all",
          mentions: body.mode === "all" || body.mode === "mentions",
          push: body.push === true,
          sound: body.sound !== false,
          previews: body.previews !== false,
        };
        const result = existing[0]
          ? await db
              .update(notificationPreferences)
              .set(data)
              .where(eq(notificationPreferences.id, existing[0].id))
          : await db.insert(notificationPreferences).values(data);
        const updated =
          result?.[0] ||
          (
            await db
              .select()
              .from(notificationPreferences)
              .where(eq(notificationPreferences.userId, userId))
              .limit(1)
          )[0];
        return presentNotificationPreferences(updated);
      }
    }
    if (suffix === "room-notification-preferences") {
      const roomId = requireValue(
        getQuery(event).roomId || body.roomId,
        "Room ID is required",
      );
      const room = await getRoomById(roomId);
      if (!room)
        throw createError({ statusCode: 404, statusMessage: "Room not found" });
      await requireRoomMember(room, userId);
      const existing = await db
        .select()
        .from(roomNotificationPreferences)
        .where(
          and(
            eq(roomNotificationPreferences.roomId, roomId),
            eq(roomNotificationPreferences.userId, userId),
          ),
        )
        .limit(1);
      if (event.method === "GET")
        return presentRoomNotificationPreferences(existing[0], roomId);
      if (event.method === "PUT") {
        const requestedMode = parseExternalString(body.mode) || "all";
        const mode = ["all", "mentions", "muted"].includes(requestedMode)
          ? requestedMode
          : "all";
        const data = {
          userId,
          roomId,
          allMessages: mode === "all",
          mentions: mode === "all" || mode === "mentions",
        };
        const result = existing[0]
          ? await db
              .update(roomNotificationPreferences)
              .set(data)
              .where(eq(roomNotificationPreferences.id, existing[0].id))
          : await db.insert(roomNotificationPreferences).values(data);
        const updated =
          result?.[0] ||
          (
            await db
              .select()
              .from(roomNotificationPreferences)
              .where(
                and(
                  eq(roomNotificationPreferences.roomId, roomId),
                  eq(roomNotificationPreferences.userId, userId),
                ),
              )
              .limit(1)
          )[0];
        return presentRoomNotificationPreferences(updated, roomId);
      }
    }
    throw createError({
      statusCode: 404,
      statusMessage: "Notification endpoint not found",
    });
  }

  const routeDependencies: ChatRouteDependencies = {
    ...dependencies,
    presentMessage,
    presentMessages,
    validateReplyTarget,
    validateMessageAttachments,
  };
  const handleMessageRoutes = createChatMessagesHandler(routeDependencies);
  const handleFileRoutes = createChatFilesHandler(routeDependencies);
  const handleInteractionRoutes =
    createChatInteractionsHandler(routeDependencies);
  const handleDiscoveryRoutes = createChatDiscoveryHandler(routeDependencies);

  async function handleChat(event: H3Event, suffix: string) {
    if (!suffix && event.method === "GET") return "dSpeak Chat";
    if (suffix === "socket" && event.method === "GET")
      throw createError({ statusCode: 426, statusMessage: "Upgrade Required" });
    const userId = await requireAuthenticatedUser(event);

    if (
      suffix === "notifications" ||
      suffix === "notifications/read" ||
      suffix === "notifications/dismiss" ||
      suffix === "notification-preferences" ||
      suffix === "room-notification-preferences"
    )
      return handleNotifications(event, userId, suffix);

    const body = event.method === "GET" ? {} : await parseBody(event);
    for (const route of [
      handleMessageRoutes,
      handleFileRoutes,
      handleInteractionRoutes,
      handleDiscoveryRoutes,
    ]) {
      const result = await route(event, suffix, userId, body);
      if (result !== undefined) return result;
    }

    throw createError({
      statusCode: 404,
      statusMessage: "Chat endpoint not found",
    });
  }

  return handleChat;
}

export default createChatApiHandler;
