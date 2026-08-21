import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, ilike, lt, sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { messages, bookmarks } from "../../db/schema/index.ts";
import { getRoomById, getChannelById } from "../room-authorization.ts";
import {
  extractFavicon,
  extractMeta,
  extractTitle,
} from "./discovery-helpers.ts";
import type {
  ChatRouteBody,
  ChatRouteDependencies,
  ChatRouteHandler,
  ChatMessageRow,
} from "../../types/chat-api.ts";
import type { H3Event } from "h3";
import {
  parseExternalError,
  parseExternalNumber,
  parseExternalRecord,
} from "../../../shared/types/external.ts";

export function createChatDiscoveryHandler(
  dependencies: ChatRouteDependencies,
): ChatRouteHandler {
  const {
    broadcastToChannel,
    assertSafeOutboundUrl,
    createError,
    enforceRateLimit,
    fetchPublicHtml,
    getQuery,
    presentUser,
    requireRoomMember,
    requireValue,
    pushAllowedHosts,
    presentMessages,
  } = dependencies;

  return async function handleRoute(
    event: H3Event,
    suffix: string,
    userId: string,
    body: ChatRouteBody,
  ) {
    if (suffix === "bookmarks" && event.method === "GET") {
      const rows = await db
        .select()
        .from(bookmarks)
        .where(eq(bookmarks.userId, userId))
        .orderBy(desc(bookmarks.createdAt));
      const bookmarkMessages = rows.length
        ? await db
            .select()
            .from(messages)
            .where(
              inArray(
                messages.id,
                rows.map((bookmark) => bookmark.messageId),
              ),
            )
        : [];
      const bookmarkMessageById = new Map(
        bookmarkMessages.map((message) => [String(message.id), message]),
      );
      const accessibleBookmarks: Array<{
        bookmark: typeof bookmarks.$inferSelect;
        message: ChatMessageRow;
      }> = [];
      const channelCache = new Map<string, ReturnType<typeof getChannelById>>();
      const roomAccessCache = new Map<string, Promise<unknown> | null>();
      for (const bookmark of rows) {
        const message = bookmarkMessageById.get(String(bookmark.messageId));
        if (!message) continue;
        try {
          if (!channelCache.has(message.channelId))
            channelCache.set(
              message.channelId,
              getChannelById(message.channelId),
            );
          const channel = await channelCache.get(message.channelId);
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
          accessibleBookmarks.push({ bookmark, message });
        } catch (error) {
          const details = parseExternalError(error);
          const record = parseExternalRecord(error);
          const response = parseExternalRecord(record?.response);
          const status =
            details.statusCode ||
            details.status ||
            parseExternalNumber(response?.status);
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
      if (!book)
        throw createError({
          statusCode: 500,
          statusMessage: "Bookmark could not be created",
        });
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
      if (query.has === "attachment")
        conditions.push(
          sql`exists (select 1 from chat_files f where f.message_id = ${messages.id})`,
        );
      if (query.has === "link")
        conditions.push(sql`${messages.content} ~* ${"(https?://|www\\.)"}`);
      if (searchQ) {
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
            statusMessage: "Invalid before date",
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
      const results = await presentMessages(rows);
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
      const presented = await presentMessages([parent[0], ...replies]);
      const parentShown = presented[0];
      const replyShown = presented.slice(1);
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
    return undefined;
  };
}
