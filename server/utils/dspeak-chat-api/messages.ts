import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import {
  messages,
  messageRevisions,
  channels,
  roomMemberships,
  chatFiles,
  rooms,
} from "../../db/schema/index.ts";
import { getRoomById, getChannelById } from "../room-authorization.ts";
import {
  canSendInChannel,
  isSlowModeCooldownActive,
  normalizeChannelPolicy,
  normalizeSlowMode,
  slowModeRemainingMs,
} from "../../../shared/channel-policy.ts";
import { messageContainsBroadcastMention } from "../../../shared/notification-policy.ts";
import type {
  ChatRouteBody,
  ChatRouteDependencies,
  ChatRouteHandler,
} from "../../types/chat-api.ts";
import type { H3Event } from "h3";
import { parseExternalString } from "../../../shared/types/external.ts";

export function createChatMessagesHandler(
  dependencies: ChatRouteDependencies,
): ChatRouteHandler {
  const {
    broadcastToChannel,
    broadcastToUser,
    canDeleteMessage,
    canViewMessageHistory,
    createError,
    enforceRateLimit,
    getQuery,
    isMessageOwner,
    persistMessageNotifications,
    requireRoomMember,
    requireValue,
    setResponseStatus,
    presentMessage,
    presentMessages,
    validateReplyTarget,
    validateMessageAttachments,
  } = dependencies;

  return async function handleRoute(
    event: H3Event,
    suffix: string,
    userId: string,
    body: ChatRouteBody,
  ) {
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
        .select({ id: channels.id, roomId: channels.roomId })
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
      const channelsIds = channelRows.map((channel) => channel.id);
      const unreadRows = await db
        .select({
          channelId: messages.channelId,
          unreadCount: sql`count(*)`,
        })
        .from(messages)
        .where(
          and(
            inArray(messages.channelId, channelsIds),
            sql`NOT (${messages.readBy}::jsonb ? ${userId})`,
          ),
        )
        .groupBy(messages.channelId);
      for (const row of unreadRows) {
        const channel = channelById.get(String(row.channelId));
        if (channel) channel.unreadCount = Number(row.unreadCount) || 0;
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
      return presentMessages(rows.reverse());
    }

    if (suffix === "message" && event.method === "POST") {
      enforceRateLimit(event, "chat-message", userId, 120, 60 * 1000);
      const channelId = requireValue(body.channelId, "Channel ID is required");
      const contentValue = parseExternalString(body.content);
      const content = contentValue?.trim() || "";
      const hasContent = contentValue !== null;
      const hasAttachments =
        Array.isArray(body.attachments) && body.attachments.length > 0;
      if (!content && !hasAttachments)
        throw createError({
          statusCode: 400,
          statusMessage: "Message content or an image is required",
        });
      if (hasContent && contentValue.length > 4000)
        throw createError({
          statusCode: 400,
          statusMessage: "Message content must be at most 4000 characters",
        });
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
      const channel = await getChannelById(channelId);
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
        channelPolicy: normalizeChannelPolicy(channel.policy),
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
      const slowModeSeconds = normalizeSlowMode(channel.slowMode ?? 0);
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
      const replyToValue = parseExternalString(body.replyTo);
      const replyTo = await validateReplyTarget(replyToValue, channel.id);
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
          clientId,
        })
        .onConflictDoNothing()
        .returning();
      const created = createdRows[0];
      if (created && validatedAttachments.length)
        await db
          .update(chatFiles)
          .set({ messageId: created.id })
          .where(
            inArray(
              chatFiles.id,
              validatedAttachments.map((attachment) => attachment.id),
            ),
          );
      const persisted =
        created ||
        (await db
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.channelId, channel.id),
              eq(messages.authorId, userId),
              eq(messages.clientId, clientId),
            ),
          )
          .orderBy(desc(messages.createdAt))
          .limit(1)
          .then((r) => r[0]));
      if (!persisted)
        throw createError({
          statusCode: 500,
          statusMessage: "Message could not be persisted",
        });
      const result = await presentMessage(persisted);
      const wasCreated = Boolean(created);
      if (wasCreated)
        broadcastToChannel(channel.id, { type: "new_message", data: result });
      const delivery = await persistMessageNotifications({
        room,
        channel,
        message: persisted,
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
        if (content.length > 4000)
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
          editorId: userId,
        });
        const updated = await db
          .update(messages)
          .set({ content: nextContent, updatedAt: editedAt })
          .where(eq(messages.id, target.id))
          .returning();
        const updatedMessage = updated[0];
        if (!updatedMessage)
          throw createError({
            statusCode: 500,
            statusMessage: "Message update did not persist",
          });
        const result = {
          id: updatedMessage.id,
          content: updatedMessage.content,
          updated: updatedMessage.updatedAt,
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
            .flatMap((messageId) => {
              const value = parseExternalString(messageId);
              return value === null ? [] : [value.trim()];
            })
            .filter(Boolean),
        ),
      ];
      requireValue(ids.length, "At least one message ID is required");
      if (ids.length > 200)
        throw createError({
          statusCode: 400,
          statusMessage: "A maximum of 200 message IDs is allowed",
        });
      const results: Array<Record<string, unknown>> = [];
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
          await db
            .update(messages)
            .set({
              readBy: sql`CASE
                WHEN COALESCE(${messages.readBy}, '[]'::jsonb) ? ${userId}
                  THEN COALESCE(${messages.readBy}, '[]'::jsonb)
                ELSE COALESCE(${messages.readBy}, '[]'::jsonb) || jsonb_build_array(${userId})
              END`,
            })
            .where(eq(messages.id, messageId));
          results.push({ messageId, status: "marked_as_read" });
        } catch {
          results.push({
            messageId,
            status: "error",
            error: { code: "READ_UPDATE_FAILED" },
          });
        }
      }
      return { results };
    }
    return undefined;
  };
}
