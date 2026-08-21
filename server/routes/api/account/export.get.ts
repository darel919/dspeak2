import { requireAuthenticatedUser } from "../../../utils/auth.ts";
import { db } from "../../../db/client.ts";
import {
  users,
  rooms,
  channels,
  roomMemberships,
  messages,
  directConversations,
  directMessages,
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
  profiles,
  avatars,
  librarySongs,
  soundboards,
  streamPlayLog,
} from "../../../db/schema/index.ts";
import { eq, or, desc, inArray, sql } from "drizzle-orm";
import { enforceRateLimit } from "../../../utils/rate-limit.ts";

export default defineEventHandler(async (event) => {
  const userId = await requireAuthenticatedUser(event);
  enforceRateLimit(event, "account-export", userId, 10, 60 * 60 * 1000);

  const [
    user,
    profile,
    avatarsList,
    roomsList,
    memberships,
    channelsList,
    messagesList,
    directConversationsList,
    directMessagesList,
    readReceipts,
    reactions,
    revisions,
    nicknames,
    notificationsList,
    notificationPreferencesList,
    roomNotificationPreferencesList,
    pushSubscriptionsList,
    pushJobsList,
    soundboardsList,
    legacySoundboards,
    librarySongsList,
    streamPlayLogList,
    chatFilesList,
    pinnedMessagesList,
    bookmarksList,
    friendsList,
    invites,
    auditLogs,
  ] = await Promise.all([
    db.select().from(users).where(eq(users.id, userId)).limit(1),
    db.select().from(profiles).where(eq(profiles.id, userId)).limit(1),
    db.select().from(avatars).where(eq(avatars.userId, userId)),
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
      .from(directConversations)
      .where(
        or(
          eq(directConversations.participantAId, userId),
          eq(directConversations.participantBId, userId),
        ),
      )
      .orderBy(desc(directConversations.updatedAt)),
    db
      .select()
      .from(directMessages)
      .where(
        or(
          eq(directMessages.authorId, userId),
          inArray(
            directMessages.conversationId,
            db
              .select({ id: directConversations.id })
              .from(directConversations)
              .where(
                or(
                  eq(directConversations.participantAId, userId),
                  eq(directConversations.participantBId, userId),
                ),
              ),
          ),
        ),
      )
      .orderBy(desc(directMessages.createdAt)),
    db
      .select()
      .from(messages)
      .where(sql`${messages.readBy} ? ${userId}`)
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
    db.select().from(soundboards).where(eq(soundboards.createdById, userId)),
    db.select().from(librarySongs).where(eq(librarySongs.addedById, userId)),
    db.select().from(streamPlayLog).where(eq(streamPlayLog.playedById, userId)),
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
    profile: profile[0] || null,
    avatars: avatarsList,
    rooms: roomsList,
    memberships,
    channels: channelsList,
    messages: messagesList,
    directConversations: directConversationsList,
    directMessages: directMessagesList,
    readReceipts,
    reactions,
    revisions,
    nicknames,
    notifications: notificationsList,
    notificationPreferences: notificationPreferencesList,
    roomNotificationPreferences: roomNotificationPreferencesList,
    pushSubscriptions: pushSubscriptionsList,
    pushJobs: pushJobsList,
    soundboards: soundboardsList,
    legacySoundboards,
    librarySongs: librarySongsList,
    streamPlayLog: streamPlayLogList,
    chatFiles: chatFilesList,
    pinnedMessages: pinnedMessagesList,
    bookmarks: bookmarksList,
    friends: friendsList,
    invites,
    auditLogs,
  };
});
