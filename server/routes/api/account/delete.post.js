import { requireAuthenticatedUser } from "../../../utils/auth.js";
import { withTransaction } from "../../../db/transactions.js";
import {
  users,
  profiles,
  rooms,
  channels,
  roomMemberships,
  membershipRoles,
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
import { supabaseAdmin } from "../../../auth/supabase.js";

const accountDeletionLocksKey = Symbol.for("dspeak.account-deletion-locks");

function accountDeletionLocks() {
  if (!globalThis[accountDeletionLocksKey]) {
    globalThis[accountDeletionLocksKey] = new Set();
  }
  return globalThis[accountDeletionLocksKey];
}

async function deleteAccount(tx, userId) {
  const ownedRooms = await tx
    .select({ id: rooms.id })
    .from(rooms)
    .where(eq(rooms.ownerId, userId));
  for (const room of ownedRooms) {
    const otherMembers = await tx
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
      await tx
        .update(rooms)
        .set({ ownerId: otherMembers[0].userId })
        .where(eq(rooms.id, room.id));
    } else {
      await tx.delete(rooms).where(eq(rooms.id, room.id));
    }
  }

  await tx
    .delete(membershipRoles)
    .where(
      inArray(
        membershipRoles.membershipId,
        tx
          .select({ id: roomMemberships.id })
          .from(roomMemberships)
          .where(eq(roomMemberships.userId, userId)),
      ),
    );
  await tx.delete(roomMemberships).where(eq(roomMemberships.userId, userId));

  await tx
    .update(channels)
    .set({ ownerId: null })
    .where(eq(channels.ownerId, userId));
  await tx
    .update(channels)
    .set({ inRoom: sql`array_remove(${channels.inRoom}, ${userId})` })
    .where(sql`${channels.inRoom} @> ARRAY[${userId}]::uuid[]`);

  await tx
    .update(messages)
    .set({ content: "[deleted]" })
    .where(eq(messages.authorId, userId));
  await tx
    .update(messages)
    .set({ readBy: sql`${messages.readBy} - ${userId}` })
    .where(sql`${messages.readBy} @> ${JSON.stringify([userId])}::jsonb`);

  await tx
    .delete(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId));
  await tx
    .delete(roomNotificationPreferences)
    .where(eq(roomNotificationPreferences.userId, userId));
  await tx.delete(pushJobs).where(eq(pushJobs.recipientId, userId));
  await tx
    .delete(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  await tx.delete(bookmarks).where(eq(bookmarks.userId, userId));
  await tx
    .delete(userNicknames)
    .where(
      or(eq(userNicknames.userId, userId), eq(userNicknames.setById, userId)),
    );
  await tx
    .delete(friends)
    .where(or(eq(friends.userId, userId), eq(friends.friendId, userId)));
  await tx.delete(messageReactions).where(eq(messageReactions.userId, userId));
  await tx
    .delete(messageRevisions)
    .where(eq(messageRevisions.editorId, userId));
  await tx.delete(notifications).where(eq(notifications.userId, userId));
  await tx
    .delete(roomSoundboards)
    .where(eq(roomSoundboards.createdById, userId));
  await tx.delete(chatFiles).where(eq(chatFiles.uploaderId, userId));
  await tx.delete(pinnedMessages).where(eq(pinnedMessages.pinnedById, userId));
  await tx
    .delete(roomInvites)
    .where(
      or(eq(roomInvites.inviterId, userId), eq(roomInvites.inviteeId, userId)),
    );
  await tx.delete(roomAuditLog).where(eq(roomAuditLog.actorId, userId));

  const deletedUsername = `deleted_${userId}`;
  const updatedAt = new Date();
  await tx
    .update(profiles)
    .set({
      username: deletedUsername,
      displayName: "",
      avatarKey: null,
      updatedAt,
    })
    .where(eq(profiles.id, userId));
  await tx
    .update(users)
    .set({
      name: "[deleted]",
      username: deletedUsername,
      displayName: "",
      email: `deleted+${userId}@deleted.invalid`,
      updatedAt,
    })
    .where(eq(users.id, userId));
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
    await withTransaction((tx) => deleteAccount(tx, userId));
    if (!supabaseAdmin)
      throw createError({
        statusCode: 503,
        statusMessage: "Account deletion is unavailable",
      });
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error)
      throw createError({
        statusCode: 502,
        statusMessage: "Application data was deleted but Auth deletion failed",
      });
    return { success: true };
  } finally {
    locks.delete(userId);
  }
});
