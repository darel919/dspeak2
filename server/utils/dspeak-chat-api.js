import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, ilike, lt, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  messages,
  messageReactions,
  messageRevisions,
  pinnedMessages,
  bookmarks,
  channels,
  profiles,
  roomMemberships,
  notifications,
  notificationPreferences,
  roomNotificationPreferences,
  pushSubscriptions,
  chatFiles,
} from "../db/schema/index.js";
import { getRoomById, getChannelById } from "./room-authorization.js";
import {
  canSendInChannel,
  isSlowModeCooldownActive,
  normalizeChannelPolicy,
  normalizeSlowMode,
  slowModeRemainingMs,
} from "../../shared/channel-policy.js";
import { messageContainsBroadcastMention } from "../../shared/notification-policy.js";
import { cacheUploadedFile, getCachedFile } from "./upload-cache.js";

export function createChatApiHandler(dependencies) {
  const {
    broadcastToChannel,
    broadcastToUser,
    assertSafeOutboundUrl,
    canDeleteMessage,
    canViewMessageHistory,
    createError,
    enforceRateLimit,
    ensureMember,
    fetchPublicHtml,
    getBoundedList,
    getHeader,
    getQuery,
    isMessageOwner,
    parseBody,
    persistMessageNotifications,
    presentUser,
    requireAuthenticatedUser,
    requireRoomMember,
    requireValue,
    sendPushTest,
    setResponseStatus,
    usePocketBaseAdmin,
    pushAllowedHosts,
  } = dependencies;

  async function presentMessage(message) {
    const author = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, message.authorId))
      .limit(1);
    const files = await db
      .select()
      .from(chatFiles)
      .where(eq(chatFiles.messageId, message.id));
    message.attachments = files.map((file) => ({
      id: file.id,
      url: `/api/assets/chat-file?id=${encodeURIComponent(file.id)}`,
      name: file.fileName,
      size: file.size,
      mime_type: file.mimeType,
    }));
    return {
      id: message.id,
      content: message.content,
      room_channel: message.channelId,
      sender: presentUser(author[0], true),
      created: message.createdAt,
      updated: message.updatedAt,
      edited_at: null,
      client_id: null,
      read_by: [],
      attachments: parseAttachments(message),
      reply_to: message.replyToId || null,
      pinned: false,
    };
  }

  async function validateReplyTarget(replyTo, channelId) {
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
    submittedAttachments,
    channelId,
    userId,
    clientId,
  ) {
    if (submittedAttachments == null) return [];
    if (!Array.isArray(submittedAttachments) || submittedAttachments.length > 4)
      throw createError({
        statusCode: 400,
        statusMessage: "A message can include up to 4 images",
      });
    const attachments = [];
    const seen = new Set();
    for (const submitted of submittedAttachments) {
      const id = String(submitted?.id || "");
      if (!id || seen.has(id))
        throw createError({
          statusCode: 400,
          statusMessage: "Invalid image attachment",
        });
      seen.add(id);
      const cached = getCachedFile(id);
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

  async function handleNotifications(event, userId, suffix) {
    const body = event.method === "GET" ? {} : await parseBody(event);
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
        items: items.map((item) => ({
          id: item.id,
          type: item.type,
          title: item.title || "",
          body: item.body || "",
          read_at: item.read ? item.createdAt : null,
          created: item.createdAt,
          actor: null,
          room: null,
          channel: null,
          message: item.data
            ? { id: JSON.parse(item.data).messageId || null }
            : null,
        })),
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
        return (
          existing[0] || {
            mode: "all",
            push: false,
            sound: true,
            previews: true,
            attenuation_override: { mode: "room", reductionPercent: 65 },
          }
        );
      if (event.method === "PUT") {
        const data = {
          userId,
          allMessages: ["all", "mentions", "muted"].includes(body.mode)
            ? body.mode === "all"
            : false,
          mentions: body.mode !== "muted",
        };
        if (existing[0])
          await db
            .update(notificationPreferences)
            .set(data)
            .where(eq(notificationPreferences.id, existing[0].id));
        else await db.insert(notificationPreferences).values(data);
        return (
          existing[0] || {
            id: undefined,
            userId,
            mode:
              body.mode && ["all", "mentions", "muted"].includes(body.mode)
                ? body.mode
                : "all",
            push: Boolean(body.push),
            sound: body.sound !== false,
            previews: body.previews !== false,
            ...data,
          }
        );
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
        return (
          existing[0] || { room: roomId, mode: "all", push: null, sound: null }
        );
      if (event.method === "PUT") {
        const mode = ["all", "mentions", "muted"].includes(body.mode)
          ? body.mode
          : "all";
        const data = {
          userId,
          roomId,
          allMessages: mode === "all",
          mentions: mode === "all" || mode === "mentions",
        };
        if (existing[0])
          await db
            .update(roomNotificationPreferences)
            .set(data)
            .where(eq(roomNotificationPreferences.id, existing[0].id));
        else await db.insert(roomNotificationPreferences).values(data);
        return existing[0] || { room: roomId, mode, push: null, sound: null };
      }
    }
    throw createError({
      statusCode: 404,
      statusMessage: "Notification endpoint not found",
    });
  }

  async function handleChat(event, suffix) {
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

    if (suffix === "unread" && event.method === "GET") {
      const memberships = await db
        .select({ roomId: roomMemberships.roomId })
        .from(roomMemberships)
        .where(eq(roomMemberships.userId, userId));
      if (!memberships.length) return [];
      const roomIds = memberships.map((m) => m.roomId);
      const roomRows = await db
        .select({ id: rooms.id })
        .from(rooms)
        .where(inArray(rooms.id, roomIds));
      if (!roomRows.length) return [];
      const channelRows = await db
        .select()
        .from(channels)
        .where(
          inArray(
            channels.roomId,
            roomRows.map((r) => r.id),
          ),
        );
      if (!channelRows.length) return [];
      const channelById = new Map(
        channelRows.map((channel) => [
          String(channel.id),
          {
            channelId: channel.id,
            roomId: channel.roomId,
            unreadCount: 0,
          },
        ]),
      );
      const channelsIds = channelRows.map((c) => c.id);
      const recent = await db
        .select({ channelId: messages.channelId })
        .from(messages)
        .where(
          and(
            inArray(messages.channelId, channelsIds),
            sql`NOT (${messages.readBy}::jsonb ? ${userId})`,
          ),
        );
      for (const message of recent) {
        const count = channelById.get(String(message.channelId));
        if (count) count.unreadCount += 1;
      }
      return [...channelById.values()];
    }

    if (suffix === "messages" && event.method === "GET") {
      const channelId = requireValue(
        getQuery(event).channelId,
        "Channel ID is required",
      );
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
      const rows = await db
        .select()
        .from(messages)
        .where(eq(messages.channelId, channelId))
        .orderBy(desc(messages.createdAt))
        .limit(200);
      return Promise.all(rows.reverse().map(presentMessage));
    }

    const body = event.method === "GET" ? {} : await parseBody(event);

    if (suffix === "message" && event.method === "POST") {
      enforceRateLimit(event, "chat-message", userId, 120, 60 * 1000);
      requireValue(body.channelId, "Channel ID is required");
      const hasContent = typeof body.content === "string";
      const content = hasContent ? body.content.trim() : "";
      const hasAttachments =
        Array.isArray(body.attachments) && body.attachments.length > 0;
      if (!content && !hasAttachments)
        throw createError({
          statusCode: 400,
          statusMessage: "Message content or an image is required",
        });
      if (!hasContent || body.content.length > 4000)
        throw createError({
          statusCode: 400,
          statusMessage: "Message content must be at most 4000 characters",
        });
      const trimmedContent = (body.content || "").trim();
      if (trimmedContent.startsWith("/")) {
        const spaceIndex = trimmedContent.indexOf(" ");
        const command =
          spaceIndex === -1
            ? trimmedContent.toLowerCase()
            : trimmedContent.slice(0, spaceIndex).toLowerCase();
        const args =
          spaceIndex === -1 ? "" : trimmedContent.slice(spaceIndex + 1).trim();
      }
      if (String(body.ownerId || "") !== String(userId))
        throw createError({
          statusCode: 409,
          statusMessage: "Queued message belongs to another account",
        });
      const clientId = String(body.clientMessageId || "");
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(clientId))
        throw createError({
          statusCode: 400,
          statusMessage: "A valid client message ID is required",
        });
      const channel = await getChannelById(body.channelId);
      if (!channel)
        throw createError({
          statusCode: 404,
          statusMessage: "Channel not found",
        });
      const room = await getRoomById(channel.roomId);
      if (!room)
        throw createError({ statusCode: 404, statusMessage: "Room not found" });
      const access = await requireRoomMember(room, userId);
      if (["voice", "stage"].includes(channel.type))
        throw createError({
          statusCode: 400,
          statusMessage: "Cannot send text messages to a media channel",
        });
      const canSend = canSendInChannel({
        channelPolicy: normalizeChannelPolicy(channel.type),
        isModeratorOrAbove:
          access.isOwner || access.permissions?.includes("message.moderate"),
        hasSendPermission: access.permissions?.includes("message.send"),
      });
      if (!canSend)
        throw createError({
          statusCode: 403,
          statusMessage: "You do not have permission to send in this channel",
        });
      if (
        (messageContainsBroadcastMention(content, "everyone") ||
          messageContainsBroadcastMention(content, "here")) &&
        !access.isOwner &&
        !access.permissions?.includes("message.moderate")
      )
        throw createError({
          statusCode: 403,
          statusMessage: "Missing permission to mention everyone or here",
        });
      const slowModeSeconds = normalizeSlowMode(
        typeof channel.slowMode === "number" ? channel.slowMode : 0,
      );
      const slowModeApplies =
        slowModeSeconds > 0 &&
        !access.isOwner &&
        !access.permissions?.includes("message.moderate");
      if (slowModeApplies) {
        const recent = await db
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.channelId, channel.id),
              eq(messages.authorId, userId),
            ),
          )
          .orderBy(desc(messages.createdAt))
          .limit(1);
        const lastMessageAt = recent[0]
          ? new Date(recent[0].createdAt).getTime()
          : 0;
        if (isSlowModeCooldownActive(lastMessageAt, slowModeSeconds))
          throw createError({
            statusCode: 429,
            statusMessage: `Slow mode is active. Try again in ${Math.ceil(
              slowModeRemainingMs(lastMessageAt, slowModeSeconds) / 1000,
            )} seconds`,
          });
      }
      const validatedAttachments = await validateMessageAttachments(
        body.attachments,
        channel.id,
        userId,
        clientId,
      );
      const replyTo = await validateReplyTarget(body.replyTo, channel.id);
      if (slowModeApplies)
        enforceRateLimit(
          event,
          "chat-slow-mode",
          `${userId}:${channel.id}`,
          1,
          slowModeSeconds * 1000,
        );
      const createdRows = await db
        .insert(messages)
        .values({
          id: randomUUID(),
          channelId: channel.id,
          authorId: userId,
          content,
          replyToId: replyTo,
          clientId: null,
        })
        .onConflictDoNothing()
        .returning();
      const created = createdRows[0];
      if (created) {
        for (const attachment of validatedAttachments)
          await db
            .update(chatFiles)
            .set({ messageId: created.id })
            .where(eq(chatFiles.id, attachment.id));
      }
      const result = created
        ? await presentMessage(created)
        : await presentMessage(
            await db
              .select()
              .from(messages)
              .where(eq(messages.channelId, channel.id))
              .orderBy(desc(messages.createdAt))
              .limit(1)
              .then((r) => r[0]),
          );
      const wasCreated = Boolean(created);
      if (wasCreated)
        broadcastToChannel(channel.id, { type: "new_message", data: result });
      const delivery = await persistMessageNotifications({
        room,
        channel,
        message: created || result,
        senderId: userId,
      });
      if (delivery.notifications) {
        for (const recipient of delivery.recipients) {
          broadcastToUser(recipient, { type: "notifications_changed" });
        }
      }
      setResponseStatus(event, 201);
      return result;
    }

    if (
      ["message/edit", "message/delete", "message/history"].includes(suffix)
    ) {
      const messageId = requireValue(
        body.messageId || getQuery(event).messageId,
        "Message ID is required",
      );
      const message = await db
        .select()
        .from(messages)
        .where(eq(messages.id, messageId))
        .limit(1);
      if (!message[0])
        throw createError({
          statusCode: 404,
          statusMessage: "Message not found",
        });
      const target = message[0];
      const channel = await getChannelById(target.channelId);
      if (!channel)
        throw createError({
          statusCode: 404,
          statusMessage: "Channel not found",
        });
      const room = await getRoomById(channel.roomId);
      if (!room)
        throw createError({ statusCode: 404, statusMessage: "Room not found" });
      const access = await requireRoomMember(room, userId);

      if (suffix === "message/history" && event.method === "GET") {
        if (!canViewMessageHistory(access.permissions, access.isOwner))
          throw createError({
            statusCode: 403,
            statusMessage:
              "Missing permission to view message revision history",
          });
        const revisions = await db
          .select()
          .from(messageRevisions)
          .where(eq(messageRevisions.messageId, target.id))
          .orderBy(asc(messageRevisions.editedAt))
          .limit(100);
        return revisions.map((revision) => ({
          id: revision.id,
          revision: 1,
          content: revision.content,
          edited_at: revision.editedAt,
          editor: null,
        }));
      }

      if (suffix === "message/edit" && event.method === "PATCH") {
        if (!isMessageOwner(target, userId))
          throw createError({
            statusCode: 403,
            statusMessage: "You can only edit your own messages",
          });
        const content = requireValue(
          body.content,
          "Message content is required",
        );
        if (typeof content !== "string" || content.length > 4000)
          throw createError({
            statusCode: 400,
            statusMessage: "Message content must be at most 4000 characters",
          });
        const nextContent = content.trim();
        requireValue(nextContent, "Message content is required");
        if (nextContent === target.content)
          throw createError({
            statusCode: 409,
            statusMessage: "The message content has not changed",
          });
        const editedAt = new Date();
        await db.insert(messageRevisions).values({
          messageId: target.id,
          content: nextContent,
          editedAt,
        });
        const updated = await db
          .update(messages)
          .set({ content: nextContent, updatedAt: editedAt })
          .where(eq(messages.id, target.id))
          .returning();
        const result = {
          id: updated[0].id,
          content: updated[0].content,
          updated: updated[0].updatedAt,
          edited_at: editedAt.toISOString(),
        };
        broadcastToChannel(channel.id, {
          type: "message_updated",
          data: result,
        });
        return result;
      }

      if (suffix === "message/delete" && event.method === "DELETE") {
        if (
          !canDeleteMessage(target, userId, access.permissions, access.isOwner)
        )
          throw createError({
            statusCode: 403,
            statusMessage: "Missing permission to delete this message",
          });
        await db.delete(messages).where(eq(messages.id, target.id));
        broadcastToChannel(channel.id, {
          type: "message_deleted",
          data: { id: target.id },
        });
        return { id: target.id, deleted: true };
      }
    }

    if (suffix === "read" && event.method === "POST") {
      const submittedIds = Array.isArray(body.messageIds)
        ? body.messageIds
        : body.messageId
          ? [body.messageId]
          : [];
      const ids = [
        ...new Set(
          submittedIds
            .filter((messageId) => typeof messageId === "string")
            .map((messageId) => messageId.trim())
            .filter(Boolean),
        ),
      ];
      requireValue(ids.length, "At least one message ID is required");
      if (ids.length > 200)
        throw createError({
          statusCode: 400,
          statusMessage: "A maximum of 200 message IDs is allowed",
        });
      const results = [];
      for (const messageId of ids) {
        try {
          const message = await db
            .select()
            .from(messages)
            .where(eq(messages.id, messageId))
            .limit(1);
          if (!message[0]) {
            results.push({
              messageId,
              status: "error",
              error: { code: "READ_UPDATE_FAILED" },
            });
            continue;
          }
          const channel = await getChannelById(message[0].channelId);
          if (!channel) {
            results.push({
              messageId,
              status: "error",
              error: { code: "READ_UPDATE_FAILED" },
            });
            continue;
          }
          const room = await getRoomById(channel.roomId);
          if (!room) {
            results.push({
              messageId,
              status: "error",
              error: { code: "READ_UPDATE_FAILED" },
            });
            continue;
          }
          await requireRoomMember(room, userId);
          results.push({ messageId, status: "marked_as_read" });
        } catch (error) {
          results.push({
            messageId,
            status: "error",
            error: { code: "READ_UPDATE_FAILED" },
          });
        }
      }
      return { results };
    }

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
      const record = await db
        .insert(chatFiles)
        .values({
          id: randomUUID(),
          channelId,
          uploaderId: userId,
          fileName: file.name,
          mimeType: file.type,
          size: file.size,
          r2Key: `upload-${randomUUID()}`,
        })
        .returning();
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

    if (suffix === "reaction" && event.method === "POST") {
      enforceRateLimit(event, "chat-reaction", userId, 120, 60 * 1000);
      const messageId = requireValue(body.messageId, "Message ID is required");
      const emoji = String(requireValue(body.emoji, "Emoji is required"));
      if (
        emoji.length > 32 ||
        !/^[\p{Extended_Pictographic}\p{Emoji_Modifier}\u200d\ufe0f\u20e3\u{1f1e6}-\u{1f1ff}0-9#*]+$/u.test(
          emoji,
        )
      )
        throw createError({ statusCode: 400, statusMessage: "Invalid emoji" });
      const message = await db
        .select()
        .from(messages)
        .where(eq(messages.id, messageId))
        .limit(1);
      if (!message[0])
        throw createError({
          statusCode: 404,
          statusMessage: "Message not found",
        });
      const channel = await getChannelById(message[0].channelId);
      if (!channel)
        throw createError({
          statusCode: 404,
          statusMessage: "Channel not found",
        });
      const room = await getRoomById(channel.roomId);
      if (!room)
        throw createError({ statusCode: 404, statusMessage: "Room not found" });
      await requireRoomMember(room, userId);
      const existing = await db
        .select()
        .from(messageReactions)
        .where(
          and(
            eq(messageReactions.messageId, messageId),
            eq(messageReactions.userId, userId),
            eq(messageReactions.emoji, emoji),
          ),
        )
        .limit(1);
      if (existing[0]) {
        await db
          .delete(messageReactions)
          .where(eq(messageReactions.id, existing[0].id));
        broadcastToChannel(channel.id, {
          type: "message_reaction_removed",
          data: { messageId, emoji, userId },
        });
      } else {
        await db
          .insert(messageReactions)
          .values({
            id: randomUUID(),
            messageId,
            userId,
            emoji,
          })
          .onConflictDoNothing();
        broadcastToChannel(channel.id, {
          type: "message_reaction_added",
          data: { messageId, emoji, userId },
        });
      }

      const allReactions = await db
        .select()
        .from(messageReactions)
        .where(eq(messageReactions.messageId, messageId));
      const grouped = {};
      for (const reaction of allReactions) {
        if (!grouped[reaction.emoji])
          grouped[reaction.emoji] = {
            emoji: reaction.emoji,
            count: 0,
            users: [],
          };
        grouped[reaction.emoji].count += 1;
        grouped[reaction.emoji].users.push(
          presentUser({ id: reaction.userId }),
        );
      }
      return { reactions: Object.values(grouped) };
    }

    if (suffix === "reactions" && event.method === "GET") {
      const query = getQuery(event);
      const channelId = requireValue(query.channelId, "Channel ID is required");
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
      const messageIds = [
        ...new Set(
          String(query.messageIds || query.messageId || "")
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean),
        ),
      ];
      if (!messageIds.length || messageIds.length > 200)
        throw createError({
          statusCode: 400,
          statusMessage: "Between 1 and 200 message IDs are required",
        });
      if (messageIds.some((id) => !/^[A-Za-z0-9_-]{1,64}$/.test(id)))
        throw createError({
          statusCode: 400,
          statusMessage: "Invalid message ID",
        });
      const requestedMessages = await db
        .select({ id: messages.id, channelId: messages.channelId })
        .from(messages)
        .where(inArray(messages.id, messageIds))
        .limit(200);
      if (
        requestedMessages.length !== messageIds.length ||
        requestedMessages.some(
          (message) => String(message.channelId) !== String(channelId),
        )
      )
        throw createError({
          statusCode: 404,
          statusMessage: "Message was not found in this channel",
        });
      const allReactions = await db
        .select()
        .from(messageReactions)
        .where(inArray(messageReactions.messageId, messageIds))
        .limit(1000);
      const reactionsByMessage = Object.fromEntries(
        messageIds.map((id) => [id, []]),
      );
      const grouped = new Map();
      for (const reaction of allReactions) {
        const key = `${reaction.messageId}:${reaction.emoji}`;
        if (!grouped.has(key))
          grouped.set(key, {
            messageId: reaction.messageId,
            emoji: reaction.emoji,
            count: 0,
            users: [],
          });
        const group = grouped.get(key);
        group.count += 1;
        group.users.push(presentUser({ id: reaction.userId }));
      }
      for (const group of grouped.values()) {
        reactionsByMessage[group.messageId].push({
          emoji: group.emoji,
          count: group.count,
          users: group.users,
        });
      }
      return {
        reactionsByMessage,
        reactions:
          messageIds.length === 1
            ? reactionsByMessage[messageIds[0]]
            : undefined,
      };
    }

    if (suffix === "pinned" && event.method === "GET") {
      const channelId = requireValue(
        getQuery(event).channelId,
        "Channel ID is required",
      );
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
      const pins = await db
        .select()
        .from(pinnedMessages)
        .where(eq(pinnedMessages.channelId, channelId))
        .orderBy(desc(pinnedMessages.createdAt));
      const pined = [];
      for (const pin of pins) {
        const message = await db
          .select()
          .from(messages)
          .where(eq(messages.id, pin.messageId))
          .limit(1);
        pined.push({
          id: pin.id,
          message: pin.messageId,
          pinned_by: presentUser({ id: pin.pinnedById }),
          pinned_at: pin.createdAt,
          expand: {
            message: message[0]
              ? {
                  id: message[0].id,
                  content: message[0].content,
                  created: message[0].createdAt,
                  sender: presentUser({ id: message[0].authorId }),
                }
              : null,
            pinned_by: presentUser({ id: pin.pinnedById }),
          },
        });
      }
      return { pinned: pined };
    }

    if (suffix === "pin" && event.method === "POST") {
      enforceRateLimit(event, "chat-pin", userId, 60, 60 * 1000);
      const messageId = requireValue(body.messageId, "Message ID is required");
      const channelId = requireValue(body.channelId, "Channel ID is required");
      const message = await db
        .select()
        .from(messages)
        .where(eq(messages.id, messageId))
        .limit(1);
      if (!message[0])
        throw createError({
          statusCode: 404,
          statusMessage: "Message not found",
        });
      const channel = await getChannelById(channelId);
      if (!channel)
        throw createError({
          statusCode: 404,
          statusMessage: "Channel not found",
        });
      if (String(message[0].channelId) !== String(channel.id))
        throw createError({
          statusCode: 400,
          statusMessage: "Message does not belong to this channel",
        });
      const room = await getRoomById(channel.roomId);
      if (!room)
        throw createError({ statusCode: 404, statusMessage: "Room not found" });
      const access = await requireRoomMember(room, userId);
      if (!access.isOwner && !access.permissions?.includes("message.moderate"))
        throw createError({
          statusCode: 403,
          statusMessage: "Missing permission to pin messages",
        });
      const existing = await db
        .select()
        .from(pinnedMessages)
        .where(eq(pinnedMessages.messageId, messageId))
        .limit(1);
      if (existing[0])
        throw createError({
          statusCode: 409,
          statusMessage: "Message is already pinned",
        });
      const pin = await db
        .insert(pinnedMessages)
        .values({
          id: randomUUID(),
          channelId,
          messageId,
          pinnedById: userId,
        })
        .onConflictDoNothing()
        .returning();
      await db
        .update(messages)
        .set({ pinned: true })
        .where(eq(messages.id, messageId));
      const pinRecord =
        pin[0] ||
        (await db
          .select()
          .from(pinnedMessages)
          .where(eq(pinnedMessages.messageId, messageId))
          .limit(1)
          .then((r) => r[0]));
      broadcastToChannel(channel.id, {
        type: "message_pinned",
        data: { id: pinRecord.id, messageId, channelId, pinnedBy: userId },
      });
      return { id: pinRecord.id, messageId, pinned: true };
    }

    if (suffix === "unpin" && event.method === "POST") {
      enforceRateLimit(event, "chat-unpin", userId, 60, 60 * 1000);
      const messageId = requireValue(body.messageId, "Message ID is required");
      const message = await db
        .select()
        .from(messages)
        .where(eq(messages.id, messageId))
        .limit(1);
      if (!message[0])
        throw createError({
          statusCode: 404,
          statusMessage: "Message not found",
        });
      const channel = await getChannelById(message[0].channelId);
      if (!channel)
        throw createError({
          statusCode: 404,
          statusMessage: "Channel not found",
        });
      const room = await getRoomById(channel.roomId);
      if (!room)
        throw createError({ statusCode: 404, statusMessage: "Room not found" });
      const access = await requireRoomMember(room, userId);
      if (!access.isOwner && !access.permissions?.includes("message.moderate"))
        throw createError({
          statusCode: 403,
          statusMessage: "Missing permission to unpin messages",
        });
      await db
        .delete(pinnedMessages)
        .where(
          and(
            eq(pinnedMessages.channelId, channel.id),
            eq(pinnedMessages.messageId, messageId),
          ),
        );
      await db
        .update(messages)
        .set({ pinned: false })
        .where(eq(messages.id, messageId));
      broadcastToChannel(channel.id, {
        type: "message_unpinned",
        data: { messageId, channelId: channel.id },
      });
      return { success: true };
    }

    if (suffix === "bookmarks" && event.method === "GET") {
      const rows = await db
        .select()
        .from(bookmarks)
        .where(eq(bookmarks.userId, userId))
        .orderBy(desc(bookmarks.createdAt));
      const accessibleBookmarks = [];
      const channelCache = new Map();
      const roomAccessCache = new Map();
      for (const bookmark of rows) {
        const message = await db
          .select()
          .from(messages)
          .where(eq(messages.id, bookmark.messageId))
          .limit(1);
        if (!message[0]) continue;
        try {
          if (!channelCache.has(message[0].channelId))
            channelCache.set(
              message[0].channelId,
              getChannelById(message[0].channelId),
            );
          const channel = await channelCache.get(message[0].channelId);
          if (!channel) continue;
          if (!roomAccessCache.has(channel.roomId))
            roomAccessCache.set(
              channel.roomId,
              (async () => {
                const room = await getRoomById(channel.roomId);
                return room ? requireRoomMember(room, userId) : null;
              })(),
            );
          await roomAccessCache.get(channel.roomId);
          accessibleBookmarks.push({ bookmark, message: message[0] });
        } catch (error) {
          const status =
            error?.statusCode || error?.status || error?.response?.status;
          if (status !== 403 && status !== 404) throw error;
        }
      }
      return {
        bookmarks: accessibleBookmarks.map(({ bookmark, message }) => ({
          id: bookmark.id,
          message: bookmark.messageId,
          note: "",
          saved_at: bookmark.createdAt,
          expand: {
            message: {
              id: message.id,
              content: message.content,
              created: message.createdAt,
              room_channel: message.channelId,
              sender: presentUser({ id: message.authorId }),
            },
          },
        })),
      };
    }

    if (suffix === "bookmark" && event.method === "POST") {
      enforceRateLimit(event, "chat-bookmark", userId, 60, 60 * 1000);
      const messageId = requireValue(body.messageId, "Message ID is required");
      const message = await db
        .select()
        .from(messages)
        .where(eq(messages.id, messageId))
        .limit(1);
      if (!message[0])
        throw createError({
          statusCode: 404,
          statusMessage: "Message not found",
        });
      const channel = await getChannelById(message[0].channelId);
      if (!channel)
        throw createError({
          statusCode: 404,
          statusMessage: "Channel not found",
        });
      const room = await getRoomById(channel.roomId);
      if (!room)
        throw createError({ statusCode: 404, statusMessage: "Room not found" });
      await requireRoomMember(room, userId);
      const existing = await db
        .select()
        .from(bookmarks)
        .where(
          and(eq(bookmarks.userId, userId), eq(bookmarks.messageId, messageId)),
        )
        .limit(1);
      if (existing[0])
        throw createError({
          statusCode: 409,
          statusMessage: "Message is already bookmarked",
        });
      const bookmark = await db
        .insert(bookmarks)
        .values({
          id: randomUUID(),
          userId,
          messageId,
        })
        .onConflictDoNothing()
        .returning();
      const book = bookmark[0];
      return { id: book.id, messageId, saved_at: book.createdAt };
    }

    if (suffix === "bookmark" && event.method === "DELETE") {
      enforceRateLimit(event, "chat-bookmark", userId, 60, 60 * 1000);
      const messageId = requireValue(body.messageId, "Message ID is required");
      await db
        .delete(bookmarks)
        .where(
          and(eq(bookmarks.userId, userId), eq(bookmarks.messageId, messageId)),
        );
      return { success: true };
    }

    if (suffix === "search" && event.method === "GET") {
      enforceRateLimit(event, "chat-search", userId, 30, 60 * 1000);
      const query = getQuery(event);
      const channelId = requireValue(query.channelId, "Channel ID is required");
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
      const searchQ = String(query.q || "").trim();
      if (searchQ.length > 200)
        throw createError({
          statusCode: 400,
          statusMessage: "Search query must be 200 characters or fewer",
        });
      if (query.has && !["attachment", "link"].includes(String(query.has)))
        throw createError({
          statusCode: 400,
          statusMessage: "Invalid content filter",
        });
      const hasFilters = Boolean(
        query.author || query.has || query.before || query.after,
      );
      if (!searchQ && !hasFilters) return { messages: [], total: 0 };
      const conditions = [eq(messages.channelId, channelId)];
      if (searchQ) {
        if (query.has === "attachment")
          conditions.push(
            sql`exists (select 1 from chat_files f where f.message_id = ${messages.id})`,
          );
        conditions.push(ilike(messages.content, `%${searchQ}%`));
      }
      if (query.author) {
        const author = String(query.author);
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(author))
          throw createError({
            statusCode: 400,
            statusMessage: "Invalid author filter",
          });
        conditions.push(eq(messages.authorId, author));
      }
      if (query.before) {
        const timestamp = Date.parse(String(query.before));
        if (!Number.isFinite(timestamp))
          throw createError({
            statusCode: 400,
            statusMessage: `Invalid ${name} date`,
          });
        conditions.push(lt(messages.createdAt, new Date(timestamp)));
      }
      if (query.after) {
        const timestamp = Date.parse(String(query.after));
        if (!Number.isFinite(timestamp))
          throw createError({
            statusCode: 400,
            statusMessage: `Invalid ${"after"} date`,
          });
        conditions.push(gt(messages.createdAt, new Date(timestamp)));
      }
      const rows = await db
        .select()
        .from(messages)
        .where(and(...conditions))
        .orderBy(desc(messages.createdAt))
        .limit(50);
      const results = [];
      for (const row of rows) {
        const author = await db
          .select()
          .from(profiles)
          .where(eq(profiles.id, row.authorId))
          .limit(1);
        const files = await db
          .select()
          .from(chatFiles)
          .where(eq(chatFiles.messageId, row.id));
        results.push({
          id: row.id,
          content: row.content,
          room_channel: row.channelId,
          sender: presentUser(author[0], true),
          created: row.createdAt,
          updated: row.updatedAt,
          edited_at: null,
          attachments: files.map((file) => ({
            id: file.id,
            url: `/api/assets/chat-file?id=${encodeURIComponent(file.id)}`,
            name: file.fileName,
            size: file.size,
            mime_type: file.mimeType,
          })),
          reply_to: row.replyToId || null,
          pinned: false,
        });
      }
      return {
        messages: results,
        total: results.length,
      };
    }

    if (suffix === "link-preview" && event.method === "GET") {
      enforceRateLimit(event, "link-preview", userId, 60, 60 * 1000);
      const url = requireValue(getQuery(event).url, "URL is required");
      try {
        await assertSafeOutboundUrl(url, { allowedHosts: pushAllowedHosts });
      } catch {
        throw createError({
          statusCode: 400,
          statusMessage: "URL is not permitted",
        });
      }
      try {
        const previewPage = await fetchPublicHtml(url, {
          allowedHosts: pushAllowedHosts,
          maxBytes: 512 * 1024,
          maxRedirects: 3,
          timeoutMs: 5000,
        });
        const html = previewPage.html;
        const title =
          extractMeta(html, "og:title") ||
          extractMeta(html, "twitter:title") ||
          extractTitle(html);
        const description =
          extractMeta(html, "og:description") ||
          extractMeta(html, "twitter:description") ||
          "";
        const image =
          extractMeta(html, "og:image") ||
          extractMeta(html, "twitter:image") ||
          "";
        const siteName = extractMeta(html, "og:site_name") || "";
        const favicon = extractFavicon(html, previewPage.url);
        return {
          url: previewPage.url,
          title,
          description,
          image,
          siteName,
          favicon,
        };
      } catch {
        return {
          url,
          title: "",
          description: "",
          image: "",
          siteName: "",
          favicon: "",
        };
      }
    }

    if (suffix === "thread" && event.method === "GET") {
      const messageId = requireValue(
        getQuery(event).messageId,
        "Message ID is required",
      );
      const parent = await db
        .select()
        .from(messages)
        .where(eq(messages.id, messageId))
        .limit(1);
      if (!parent[0])
        throw createError({
          statusCode: 404,
          statusMessage: "Message not found",
        });
      const channel = await getChannelById(parent[0].channelId);
      if (!channel)
        throw createError({
          statusCode: 404,
          statusMessage: "Channel not found",
        });
      const room = await getRoomById(channel.roomId);
      if (!room)
        throw createError({ statusCode: 404, statusMessage: "Room not found" });
      await requireRoomMember(room, userId);
      const replies = await db
        .select()
        .from(messages)
        .where(eq(messages.replyToId, messageId))
        .orderBy(asc(messages.createdAt));
      const parentShown = await presentMessage(parent[0]);
      const replyShown = await Promise.all(replies.map(presentMessage));
      return {
        parent: parentShown,
        replies: replyShown,
      };
    }

    if (suffix === "message/undo" && event.method === "POST") {
      const messageId = requireValue(body.messageId, "Message ID is required");
      const message = await db
        .select()
        .from(messages)
        .where(eq(messages.id, messageId))
        .limit(1);
      if (!message[0])
        throw createError({
          statusCode: 404,
          statusMessage: "Message not found",
        });
      if (String(message[0].authorId) !== String(userId))
        throw createError({
          statusCode: 403,
          statusMessage: "You can only undo your own messages",
        });
      const created = new Date(message[0].createdAt).getTime();
      if (Date.now() - created > 3000)
        throw createError({
          statusCode: 400,
          statusMessage: "Undo window has expired (3 seconds)",
        });
      const channel = await getChannelById(message[0].channelId);
      await db.delete(messages).where(eq(messages.id, messageId));
      if (channel)
        broadcastToChannel(channel.id, {
          type: "message_deleted",
          data: { id: messageId },
        });
      return { id: messageId, deleted: true };
    }

    throw createError({
      statusCode: 404,
      statusMessage: "Chat endpoint not found",
    });
  }

  return handleChat;
}

function extractMeta(html, property) {
  const regex = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escapeRegex(property)}["'][^>]+content=["']([^"']*)["']`,
    "i",
  );
  const match = html.match(regex);
  if (match) return decodeHtmlEntities(match[1]);
  const altRegex = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escapeRegex(property)}["']`,
    "i",
  );
  const altMatch = html.match(altRegex);
  return altMatch ? decodeHtmlEntities(altMatch[1]) : "";
}

function extractTitle(html) {
  const match = html.match(/<title>([^<]*)<\/title>/i);
  return match ? decodeHtmlEntities(match[1]) : "";
}

function extractFavicon(html, baseUrl) {
  const match = html.match(
    /<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']*)["']/i,
  );
  if (!match) {
    try {
      return new URL("/favicon.ico", baseUrl).href;
    } catch {
      return "";
    }
  }
  try {
    return new URL(match[1], baseUrl).href;
  } catch {
    return match[1];
  }
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
}
