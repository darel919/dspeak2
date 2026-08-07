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
import { eq, and, or, desc, inArray, sql } from "drizzle-orm";
import { enforceRateLimit } from "../../../utils/rate-limit.js";

export default defineEventHandler(async (event) => {
  const userId = await requireAuthenticatedUser(event);
  enforceRateLimit(event, "account-export", userId, 10, 60 * 60 * 1000);

  const [
    user,
    roomsList,
    memberships,
    channelsList,
    messagesList,
    readReceipts,
    reactions,
    revisions,
    nicknames,
    notificationsList,
    notificationPreferencesList,
    roomNotificationPreferencesList,
    pushSubscriptionsList,
    pushJobsList,
    soundboards,
    chatFilesList,
    pinnedMessagesList,
    bookmarksList,
    friendsList,
    invites,
    auditLogs,
  ] = await Promise.all([
    db.select().from(users).where(eq(users.id, userId)).limit(1),
    db.select().from(rooms).where(eq(rooms.ownerId, userId)),
    db.select().from(roomMemberships).where(eq(roomMemberships.userId, userId)),
    db.select().from(channels).where(eq(channels.ownerId, userId)),
    db
      .select()
      .from(messages)
      .where(eq(messages.authorId, userId))
      .orderBy(desc(messages.createdAt)),
    db
      .select()
      .from(messages)
      .where(sql`${messages.readBy} @> ARRAY[${userId}]::uuid[]`)
      .orderBy(desc(messages.createdAt)),
    db
      .select()
      .from(messageReactions)
      .where(eq(messageReactions.userId, userId)),
    db
      .select()
      .from(messageRevisions)
      .where(eq(messageRevisions.editorId, userId)),
    db.select().from(userNicknames).where(eq(userNicknames.setById, userId)),
    db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt)),
    db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId)),
    db
      .select()
      .from(roomNotificationPreferences)
      .where(eq(roomNotificationPreferences.userId, userId)),
    db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId)),
    db.select().from(pushJobs).where(eq(pushJobs.recipientId, userId)),
    db
      .select()
      .from(roomSoundboards)
      .where(eq(roomSoundboards.createdById, userId)),
    db.select().from(chatFiles).where(eq(chatFiles.uploaderId, userId)),
    db
      .select()
      .from(pinnedMessages)
      .where(eq(pinnedMessages.pinnedById, userId)),
    db.select().from(bookmarks).where(eq(bookmarks.userId, userId)),
    db
      .select()
      .from(friends)
      .where(or(eq(friends.userId, userId), eq(friends.friendId, userId))),
    db.select().from(roomInvites).where(eq(roomInvites.inviterId, userId)),
    db
      .select()
      .from(roomAuditLog)
      .where(
        or(eq(roomAuditLog.actorId, userId), eq(roomAuditLog.targetId, userId)),
      ),
  ]);

  setHeader(event, "Cache-Control", "private, no-store");
  setHeader(event, "Content-Type", "application/json; charset=utf-8");
  setHeader(
    event,
    "Content-Disposition",
    `attachment; filename="dspeak-export-${userId}-${Date.now()}.json"`,
  );

  return {
    exportedAt: new Date().toISOString(),
    user: user[0] || null,
    rooms: roomsList,
    memberships,
    channels: channelsList,
    messages: messagesList,
    readReceipts,
    reactions,
    revisions,
    nicknames,
    notifications: notificationsList,
    notificationPreferences: notificationPreferencesList,
    roomNotificationPreferences: roomNotificationPreferencesList,
    pushSubscriptions: pushSubscriptionsList,
    pushJobs: pushJobsList,
    soundboards,
    chatFiles: chatFilesList,
    pinnedMessages: pinnedMessagesList,
    bookmarks: bookmarksList,
    friends: friendsList,
    invites,
    auditLogs,
  };
});
