import { db } from "../client.ts";
import {
  messages,
  messageRevisions,
  messageReactions,
  pinnedMessages,
  bookmarks,
} from "../schema/index.ts";
import { eq, and, desc, lt, gt } from "drizzle-orm";
import type { MessageInsert, MessageRow } from "../../types/repositories.ts";

type MessageId = string;
type MessageWindow = { limit?: number; before?: Date; after?: Date };
export class ChatRepository {
  async findMessagesByChannel(
    channelId: string,
    { limit = 50, before, after }: MessageWindow = {},
  ) {
    const conditions = [eq(messages.channelId, channelId)];
    if (before) conditions.push(lt(messages.createdAt, before));
    if (after) conditions.push(gt(messages.createdAt, after));

    const result = await db
      .select()
      .from(messages)
      .where(and(...conditions))
      .orderBy(desc(messages.createdAt))
      .limit(limit);
    return result.reverse();
  }

  async findMessageById(messageId: MessageId): Promise<MessageRow | null> {
    const result = await db
      .select()
      .from(messages)
      .where(eq(messages.id, messageId))
      .limit(1);
    return result[0] || null;
  }

  async createMessage({
    channelId,
    authorId,
    content,
    replyToId,
  }: Pick<MessageInsert, "channelId" | "authorId" | "content" | "replyToId">) {
    const result = await db
      .insert(messages)
      .values({ channelId, authorId, content, replyToId })
      .returning();
    return result[0];
  }

  async updateMessage(messageId: MessageId, authorId: string, content: string) {
    const result = await db
      .update(messages)
      .set({ content, updatedAt: new Date() })
      .where(and(eq(messages.id, messageId), eq(messages.authorId, authorId)))
      .returning();
    return result[0];
  }

  async deleteMessage(messageId: MessageId, authorId: string) {
    const result = await db
      .update(messages)
      .set({ deletedAt: new Date() })
      .where(and(eq(messages.id, messageId), eq(messages.authorId, authorId)))
      .returning();
    return result[0];
  }

  async createRevision(
    messageId: MessageId,
    content: string,
    editorId: string,
  ) {
    const result = await db
      .insert(messageRevisions)
      .values({ messageId, content, editorId })
      .returning();
    return result[0];
  }

  async getRevisions(messageId: MessageId) {
    return db
      .select()
      .from(messageRevisions)
      .where(eq(messageRevisions.messageId, messageId))
      .orderBy(desc(messageRevisions.editedAt));
  }

  async addReaction(messageId: MessageId, userId: string, emoji: string) {
    const result = await db
      .insert(messageReactions)
      .values({ messageId, userId, emoji })
      .onConflictDoNothing({
        target: [
          messageReactions.messageId,
          messageReactions.userId,
          messageReactions.emoji,
        ],
      })
      .returning();
    return result[0];
  }

  async removeReaction(messageId: MessageId, userId: string, emoji: string) {
    await db
      .delete(messageReactions)
      .where(
        and(
          eq(messageReactions.messageId, messageId),
          eq(messageReactions.userId, userId),
          eq(messageReactions.emoji, emoji),
        ),
      );
  }

  async getReactions(messageId: MessageId) {
    return db
      .select()
      .from(messageReactions)
      .where(eq(messageReactions.messageId, messageId));
  }

  async pinMessage(
    channelId: string,
    messageId: MessageId,
    pinnedById: string,
  ) {
    const result = await db
      .insert(pinnedMessages)
      .values({ channelId, messageId, pinnedById })
      .onConflictDoUpdate({
        target: [pinnedMessages.channelId, pinnedMessages.messageId],
        set: { pinnedById, createdAt: new Date() },
      })
      .returning();
    return result[0];
  }

  async unpinMessage(channelId: string, messageId: MessageId) {
    await db
      .delete(pinnedMessages)
      .where(
        and(
          eq(pinnedMessages.channelId, channelId),
          eq(pinnedMessages.messageId, messageId),
        ),
      );
  }

  async getPinnedMessages(channelId: string) {
    return db
      .select()
      .from(pinnedMessages)
      .where(eq(pinnedMessages.channelId, channelId))
      .orderBy(desc(pinnedMessages.createdAt));
  }

  async addBookmark(userId: string, messageId: MessageId) {
    const result = await db
      .insert(bookmarks)
      .values({ userId, messageId })
      .onConflictDoNothing({ target: [bookmarks.userId, bookmarks.messageId] })
      .returning();
    return result[0];
  }

  async removeBookmark(userId: string, messageId: MessageId) {
    await db
      .delete(bookmarks)
      .where(
        and(eq(bookmarks.userId, userId), eq(bookmarks.messageId, messageId)),
      );
  }

  async getBookmarks(userId: string) {
    return db
      .select()
      .from(bookmarks)
      .where(eq(bookmarks.userId, userId))
      .orderBy(desc(bookmarks.createdAt));
  }
}

export const chatRepository = new ChatRepository();
