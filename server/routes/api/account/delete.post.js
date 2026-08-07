import { requireAuthenticatedUser } from "../../../utils/auth.js";
import { db } from "../../../db/client.js";
import {
  users,
  rooms,
  channels,
  roomMemberships,
  membershipRoles,
  roomRoles,
  messages,
  messageReactions,
  messageRevisions,
  userNicknames,
  notifications,
  notificationPreferences,
  roomNotificationPreferences,
  pushSubscriptions,
  pushJobs,
  roomSoundboards,
  chatFiles,
  pinnedMessages,
  bookmarks,
  friends,
  roomInvites,
  roomAuditLog,
} from "../../../db/schema/index.js";
import { eq, and, or, inArray, sql } from "drizzle-orm";
import { enforceRateLimit } from "../../../utils/rate-limit.js";
import { disconnectVoiceParticipant } from "../../../utils/mediasoup-sfu.js";

const accountDeletionLocksKey = Symbol.for("dspeak.account-deletion-locks");

function accountDeletionLocks() {
  if (!globalThis[accountDeletionLocksKey]) {
    globalThis[accountDeletionLocksKey] = new Set();
  }
  return globalThis[accountDeletionLocksKey];
}

async function deleteAccount(userId) {
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(roomMemberships).where(eq(roomMemberships.userId, userId));
  await db
    .delete(membershipRoles)
    .where(
      inArray(
        membershipRoles.membershipId,
        db
          .select({ id: roomMemberships.id })
          .from(roomMemberships)
          .where(eq(roomMemberships.userId, userId)),
      ),
    );

  const ownedRooms = await db
    .select({ id: rooms.id })
    .from(rooms)
    .where(eq(rooms.ownerId, userId));
  for (const room of ownedRooms) {
    const otherMembers = await db
      .select({ userId: roomMemberships.userId })
      .from(roomMemberships)
      .where(
        and(
          eq(roomMemberships.roomId, room.id),
          sql`${roomMemberships.userId} != ${userId}`,
        ),
      )
      .limit(1);
    if (otherMembers.length > 0) {
      await db
        .update(rooms)
        .set({ ownerId: otherMembers[0].userId })
        .where(eq(rooms.id, room.id));
    } else {
      await db.delete(rooms).where(eq(rooms.id, room.id));
    }
  }

  await db.delete(channels).where(eq(channels.ownerId, userId));

  await db
    .update(channels)
    .set({ inRoom: sql`array_remove(${channels.inRoom}, ${userId})` })
    .where(sql`${channels.inRoom} @> ARRAY[${userId}]::uuid[]`);

  await db
    .update(messages)
    .set({ content: "[deleted]" })
    .where(eq(messages.authorId, userId));

  await db
    .update(messages)
    .set({ readBy: sql`array_remove(${messages.readBy}, ${userId})` })
    .where(sql`${messages.readBy} @> ARRAY[${userId}]::uuid[]`);

  await db
    .delete(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId));
  await db
    .delete(roomNotificationPreferences)
    .where(eq(roomNotificationPreferences.userId, userId));
  await db
    .delete(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  await db.delete(bookmarks).where(eq(bookmarks.userId, userId));
  await db.delete(userNicknames).where(eq(userNicknames.setById, userId));
  await db
    .delete(friends)
    .where(or(eq(friends.userId, userId), eq(friends.friendId, userId)));
  await db.delete(messageReactions).where(eq(messageReactions.userId, userId));
  await db
    .delete(messageRevisions)
    .where(eq(messageRevisions.editorId, userId));
  await db.delete(notifications).where(eq(notifications.userId, userId));
  await db.delete(pushJobs).where(eq(pushJobs.recipientId, userId));
  await db
    .delete(roomSoundboards)
    .where(eq(roomSoundboards.createdById, userId));
  await db.delete(chatFiles).where(eq(chatFiles.uploaderId, userId));
  await db.delete(pinnedMessages).where(eq(pinnedMessages.pinnedById, userId));
  await db.delete(roomInvites).where(eq(roomInvites.inviterId, userId));
  await db.delete(roomAuditLog).where(eq(roomAuditLog.actorId, userId));

  await disconnectVoiceParticipant(userId, userId);

  await db
    .update(users)
    .set({
      name: "[deleted]",
      username: `deleted_${userId.slice(0, 8)}`,
      displayName: "",
      email: "",
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  return { success: true };
}

export default defineEventHandler(async (event) => {
  const userId = await requireAuthenticatedUser(event);
  enforceRateLimit(event, "account-delete", userId, 3, 60 * 60 * 1000);

  const locks = accountDeletionLocks();
  if (locks.has(userId)) {
    throw createError({
      statusCode: 409,
      statusMessage: "Account deletion is already in progress",
    });
  }

  locks.add(userId);
  try {
    return await deleteAccount(userId);
  } finally {
    locks.delete(userId);
  }
});
