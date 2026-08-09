import { db } from "../client.js";
import {
  friends,
  userNicknames,
  roomInvites,
  roomAuditLog,
} from "../schema/index.js";
import { eq, and, desc, or, isNull, lt } from "drizzle-orm";

export class SocialRepository {
  async findFriendship(userId, friendId) {
    const result = await db
      .select()
      .from(friends)
      .where(and(eq(friends.userId, userId), eq(friends.friendId, friendId)))
      .limit(1);
    return result[0] || null;
  }

  async findFriendshipEither(userId, friendId) {
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

  async sendFriendRequest(userId, friendId) {
    const result = await db
      .insert(friends)
      .values({ userId, friendId, status: "pending" })
      .onConflictDoNothing({ target: [friends.userId, friends.friendId] })
      .returning();
    return result[0];
  }

  async acceptFriendRequest(userId, friendId) {
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

  async blockUser(userId, friendId) {
    const result = await db
      .update(friends)
      .set({ status: "blocked" })
      .where(and(eq(friends.userId, userId), eq(friends.friendId, friendId)))
      .returning();
    return result[0];
  }

  async removeFriend(userId, friendId) {
    await db
      .delete(friends)
      .where(
        or(
          and(eq(friends.userId, userId), eq(friends.friendId, friendId)),
          and(eq(friends.userId, friendId), eq(friends.friendId, userId)),
        ),
      );
  }

  async getFriends(userId, status = "accepted") {
    return db
      .select()
      .from(friends)
      .where(and(eq(friends.userId, userId), eq(friends.status, status)))
      .orderBy(desc(friends.createdAt));
  }

  async getPendingRequests(userId) {
    return db
      .select()
      .from(friends)
      .where(and(eq(friends.friendId, userId), eq(friends.status, "pending")))
      .orderBy(desc(friends.createdAt));
  }

  async setNickname(roomId, userId, nickname, setById) {
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

  async getNickname(roomId, userId) {
    const result = await db
      .select()
      .from(userNicknames)
      .where(
        and(eq(userNicknames.roomId, roomId), eq(userNicknames.userId, userId)),
      )
      .limit(1);
    return result[0] || null;
  }

  async removeNickname(roomId, userId) {
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
  }) {
    const result = await db
      .insert(roomInvites)
      .values({ roomId, channelId, inviterId, inviteeId, code, expiresAt })
      .returning();
    return result[0];
  }

  async getInviteByCode(code) {
    const result = await db
      .select()
      .from(roomInvites)
      .where(eq(roomInvites.code, code))
      .limit(1);
    return result[0] || null;
  }

  async useInvite(code, inviteeId) {
    const result = await db
      .update(roomInvites)
      .set({ inviteeId, usedAt: new Date() })
      .where(and(eq(roomInvites.code, code), isNull(roomInvites.usedAt)))
      .returning();
    return result[0];
  }

  async logAudit({ roomId, actorId, action, targetId, metadata }) {
    const result = await db
      .insert(roomAuditLog)
      .values({ roomId, actorId, action, targetId, metadata })
      .returning();
    return result[0];
  }

  async getAuditLog(roomId, { limit = 50, before } = {}) {
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
