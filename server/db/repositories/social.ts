import { db } from "../client.ts";
import {
  friends,
  userNicknames,
  roomInvites,
  roomAuditLog,
} from "../schema/index.ts";
import { eq, and, desc, or, isNull, lt } from "drizzle-orm";
import type { RoomAuditInsert } from "../../types/repositories.ts";
export class SocialRepository {
  async findFriendship(userId: string, friendId: string) {
    const result = await db
      .select()
      .from(friends)
      .where(and(eq(friends.userId, userId), eq(friends.friendId, friendId)))
      .limit(1);
    return result[0] || null;
  }

  async findFriendshipEither(userId: string, friendId: string) {
    const result = await db
      .select()
      .from(friends)
      .where(
        or(
          and(eq(friends.userId, userId), eq(friends.friendId, friendId)),
          and(eq(friends.userId, friendId), eq(friends.friendId, userId)),
        ),
      )
      .limit(1);
    return result[0] || null;
  }

  async sendFriendRequest(userId: string, friendId: string) {
    const result = await db
      .insert(friends)
      .values({ userId, friendId, status: "pending" })
      .onConflictDoNothing({ target: [friends.userId, friends.friendId] })
      .returning();
    return result[0];
  }

  async acceptFriendRequest(userId: string, friendId: string) {
    const result = await db
      .update(friends)
      .set({ status: "accepted" })
      .where(
        and(
          eq(friends.userId, friendId),
          eq(friends.friendId, userId),
          eq(friends.status, "pending"),
        ),
      )
      .returning();
    return result[0];
  }

  async blockUser(userId: string, friendId: string) {
    const result = await db
      .update(friends)
      .set({ status: "blocked" })
      .where(and(eq(friends.userId, userId), eq(friends.friendId, friendId)))
      .returning();
    return result[0];
  }

  async removeFriend(userId: string, friendId: string) {
    await db
      .delete(friends)
      .where(
        or(
          and(eq(friends.userId, userId), eq(friends.friendId, friendId)),
          and(eq(friends.userId, friendId), eq(friends.friendId, userId)),
        ),
      );
  }

  async getFriends(userId: string, status = "accepted") {
    return db
      .select()
      .from(friends)
      .where(and(eq(friends.userId, userId), eq(friends.status, status)))
      .orderBy(desc(friends.createdAt));
  }

  async getPendingRequests(userId: string) {
    return db
      .select()
      .from(friends)
      .where(and(eq(friends.friendId, userId), eq(friends.status, "pending")))
      .orderBy(desc(friends.createdAt));
  }

  async setNickname(
    roomId: string,
    userId: string,
    nickname: string,
    setById: string,
  ) {
    const result = await db
      .insert(userNicknames)
      .values({ roomId, userId, nickname, setById })
      .onConflictDoUpdate({
        target: [userNicknames.roomId, userNicknames.userId],
        set: { nickname, setById, createdAt: new Date() },
      })
      .returning();
    return result[0];
  }

  async getNickname(roomId: string, userId: string) {
    const result = await db
      .select()
      .from(userNicknames)
      .where(
        and(eq(userNicknames.roomId, roomId), eq(userNicknames.userId, userId)),
      )
      .limit(1);
    return result[0] || null;
  }

  async removeNickname(roomId: string, userId: string) {
    await db
      .delete(userNicknames)
      .where(
        and(eq(userNicknames.roomId, roomId), eq(userNicknames.userId, userId)),
      );
  }

  async createInvite({
    roomId,
    channelId,
    inviterId,
    inviteeId,
    code,
    expiresAt,
  }: {
    roomId: string;
    channelId?: string | null;
    inviterId: string;
    inviteeId?: string | null;
    code: string;
    expiresAt: Date;
  }) {
    const result = await db
      .insert(roomInvites)
      .values({ roomId, channelId, inviterId, inviteeId, code, expiresAt })
      .returning();
    return result[0];
  }

  async getInviteByCode(code: string) {
    const result = await db
      .select()
      .from(roomInvites)
      .where(eq(roomInvites.code, code))
      .limit(1);
    return result[0] || null;
  }

  async useInvite(code: string, inviteeId: string) {
    const result = await db
      .update(roomInvites)
      .set({ inviteeId, usedAt: new Date() })
      .where(and(eq(roomInvites.code, code), isNull(roomInvites.usedAt)))
      .returning();
    return result[0];
  }

  async logAudit({
    roomId,
    actorId,
    action,
    targetId,
    metadata,
  }: RoomAuditInsert) {
    const result = await db
      .insert(roomAuditLog)
      .values({ roomId, actorId, action, targetId, metadata })
      .returning();
    return result[0];
  }

  async getAuditLog(
    roomId: string,
    { limit = 50, before }: { limit?: number; before?: Date } = {},
  ) {
    const conditions = [eq(roomAuditLog.roomId, roomId)];
    if (before) conditions.push(lt(roomAuditLog.createdAt, before));
    return db
      .select()
      .from(roomAuditLog)
      .where(and(...conditions))
      .orderBy(desc(roomAuditLog.createdAt))
      .limit(limit);
  }
}

export const socialRepository = new SocialRepository();
