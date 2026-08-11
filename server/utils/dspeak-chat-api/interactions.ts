import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db/client.ts";
import {
  messages,
  messageReactions,
  pinnedMessages,
} from "../../db/schema/index.ts";
import { getRoomById, getChannelById } from "../room-authorization.ts";

export function createChatInteractionsHandler(dependencies) {
  const {
    broadcastToChannel,
    createError,
    enforceRateLimit,
    getQuery,
    presentUser,
    requireRoomMember,
    requireValue,
  } = dependencies;

  return async function handleRoute(event, suffix, userId, body) {
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
      const grouped = {} as any;
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
      const pinnedMessageRows = pins.length
        ? await db
            .select()
            .from(messages)
            .where(
              inArray(
                messages.id,
                pins.map((pin) => pin.messageId),
              ),
            )
        : [];
      const pinnedMessageById = new Map(
        pinnedMessageRows.map((message) => [String(message.id), message]),
      );
      const pined = [] as any;
      for (const pin of pins) {
        const message = pinnedMessageById.get(String(pin.messageId));
        pined.push({
          id: pin.id,
          message: pin.messageId,
          pinned_by: presentUser({ id: pin.pinnedById }),
          pinned_at: pin.createdAt,
          expand: {
            message: message
              ? {
                  id: message.id,
                  content: message.content,
                  created: message.createdAt,
                  sender: presentUser({ id: message.authorId }),
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
    return undefined;
  };
}
