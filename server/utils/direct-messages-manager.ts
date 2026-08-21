import { and, desc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  directConversations,
  directMessages,
  friends,
  notifications,
  profiles,
} from "../db/schema/index.ts";
import { sameOriginAvatarPath } from "../../shared/avatar-path.ts";
import { publicDisplayName } from "../../shared/user-profile.ts";
import { broadcastToUser } from "./dspeak-realtime.ts";
import {
  parseExternalDate,
  parseExternalRecord,
  parseExternalString,
  type ExternalField,
} from "../../shared/types/external.ts";
import type {
  DatabaseId,
  DirectConversationRow,
  DirectMessageRow,
  NotificationRow,
  ProfileRow,
} from "../types/database.ts";

const DIRECT_MESSAGE_LIMIT = 100;

function fail(statusCode: number, statusMessage: string): never {
  const error = new Error(statusMessage);
  Object.assign(error, { statusCode });
  throw error;
}

function participantPair(leftId: DatabaseId, rightId: DatabaseId) {
  return String(leftId) < String(rightId)
    ? { participantAId: leftId, participantBId: rightId }
    : { participantAId: rightId, participantBId: leftId };
}

function presentProfile(profile: ProfileRow | null | undefined) {
  if (!profile) return null;
  return {
    id: String(profile.id),
    name: publicDisplayName(profile),
    display_name: profile.displayName || "",
    handle: profile.username || "",
    avatar: sameOriginAvatarPath(profile),
  };
}

function presentMessage(
  message: DirectMessageRow,
  profile: ProfileRow | null | undefined,
) {
  return {
    id: String(message.id),
    conversation_id: String(message.conversationId),
    content: message.content,
    sender: profile ? presentProfile(profile) : null,
    created: message.createdAt,
    client_id: message.clientId || null,
    delivered_at: message.deliveredAt,
    read_at: message.readAt,
  };
}

async function findFriendship(userId: DatabaseId, friendId: DatabaseId) {
  return db
    .select()
    .from(friends)
    .where(
      and(
        eq(friends.status, "accepted"),
        or(
          and(eq(friends.userId, userId), eq(friends.friendId, friendId)),
          and(eq(friends.userId, friendId), eq(friends.friendId, userId)),
        ),
      ),
    )
    .limit(1);
}

async function requireFriend(userId: DatabaseId, friendId: DatabaseId) {
  if (!friendId || String(userId) === String(friendId))
    fail(400, "A different friend is required");
  const friendship = await findFriendship(userId, friendId);
  if (!friendship[0])
    fail(403, "Direct messages are available to friends only");
  const profile = await db
    .select()
    .from(profiles)
    .where(eq(profiles.id, friendId))
    .limit(1);
  if (!profile[0]) fail(404, "Friend profile not found");
  return profile[0];
}

async function findConversationForUser(
  userId: DatabaseId,
  conversationId: DatabaseId,
) {
  const rows = await db
    .select()
    .from(directConversations)
    .where(
      and(
        eq(directConversations.id, conversationId),
        or(
          eq(directConversations.participantAId, userId),
          eq(directConversations.participantBId, userId),
        ),
      ),
    )
    .limit(1);
  const conversation = rows[0];
  if (!conversation) fail(404, "Direct conversation not found");
  const friendId =
    String(conversation.participantAId) === String(userId)
      ? conversation.participantBId
      : conversation.participantAId;
  await requireFriend(userId, friendId);
  return { conversation, friendId };
}

async function profilesById(ids: readonly DatabaseId[]) {
  if (!ids.length) return new Map();
  const rows = await db
    .select()
    .from(profiles)
    .where(inArray(profiles.id, ids));
  return new Map(rows.map((profile) => [String(profile.id), profile]));
}

async function latestMessagesByConversation(
  conversationIds: readonly DatabaseId[],
) {
  if (!conversationIds.length) return new Map();
  const latestTimes = await db
    .select({
      conversationId: directMessages.conversationId,
      createdAt: sql`max(${directMessages.createdAt})`,
    })
    .from(directMessages)
    .where(inArray(directMessages.conversationId, conversationIds))
    .groupBy(directMessages.conversationId);
  if (!latestTimes.length) return new Map();
  const conditions = latestTimes.flatMap((latest) => {
    const createdAt = parseExternalDate(latest.createdAt);
    if (!createdAt) return [];
    return [
      and(
        eq(directMessages.conversationId, latest.conversationId),
        eq(directMessages.createdAt, createdAt),
      ),
    ];
  });
  if (!conditions.length) return new Map();
  const rows = await db
    .select()
    .from(directMessages)
    .where(or(...conditions));
  return new Map(
    rows.map((message) => [String(message.conversationId), message]),
  );
}

async function unreadCountsByConversation(
  userId: DatabaseId,
  conversationIds: readonly DatabaseId[],
) {
  if (!conversationIds.length) return new Map();
  const rows = await db
    .select({
      conversationId: directMessages.conversationId,
      count: sql`count(*)`,
    })
    .from(directMessages)
    .where(
      and(
        inArray(directMessages.conversationId, conversationIds),
        ne(directMessages.authorId, userId),
        isNull(directMessages.readAt),
      ),
    )
    .groupBy(directMessages.conversationId);
  return new Map(
    rows.map((row) => [String(row.conversationId), Number(row.count)]),
  );
}

async function presentConversation(
  conversation: DirectConversationRow,
  _userId: DatabaseId,
  profile: ProfileRow | null | undefined,
  lastMessage: DirectMessageRow | null | undefined,
  unreadCount: number,
) {
  return {
    id: String(conversation.id),
    friend: profile ? presentProfile(profile) : null,
    last_message: lastMessage ? presentMessage(lastMessage, null) : null,
    unread_count: unreadCount,
    updated_at: conversation.updatedAt,
  };
}

function presentNotification(notification: NotificationRow) {
  let data: Record<string, unknown> = {};
  try {
    const parsed = parseExternalRecord(
      notification.data ? JSON.parse(notification.data) : {},
    );
    if (parsed) data = parsed;
  } catch {}
  return {
    ...data,
    id: String(notification.id),
    type: notification.type,
    title: notification.title,
    body: notification.body || "",
    read_at: notification.read ? notification.createdAt : null,
    created: notification.createdAt,
  };
}

async function createDirectMessageNotification(
  userId: DatabaseId,
  message: DirectMessageRow,
  sender: ProfileRow,
) {
  try {
    const rows = await db
      .insert(notifications)
      .values({
        userId,
        type: "direct_message",
        title: publicDisplayName(sender),
        body: message.content,
        data: JSON.stringify({
          conversationId: String(message.conversationId),
          messageId: String(message.id),
          senderId: String(sender.id),
        }),
      })
      .returning();
    return rows[0] || null;
  } catch {
    return null;
  }
}

async function markDirectMessageNotificationsRead(
  userId: DatabaseId,
  conversationId: DatabaseId,
) {
  const rows = await db
    .select({ id: notifications.id, data: notifications.data })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.type, "direct_message"),
        eq(notifications.read, false),
      ),
    );
  const ids = rows.flatMap((notification) => {
    try {
      const data = notification.data ? JSON.parse(notification.data) : {};
      return String(data.conversationId || data.conversation_id) ===
        String(conversationId)
        ? [notification.id]
        : [];
    } catch {
      return [];
    }
  });
  if (!ids.length) return [];
  await db
    .update(notifications)
    .set({ read: true })
    .where(
      and(eq(notifications.userId, userId), inArray(notifications.id, ids)),
    );
  await Promise.allSettled([
    broadcastToUser(String(userId), {
      type: "notifications_read",
      data: { ids: ids.map(String) },
    }),
  ]);
  return ids;
}

export async function listDirectConversations(userId: DatabaseId) {
  const acceptedFriendships = await db
    .select()
    .from(friends)
    .where(
      and(
        eq(friends.status, "accepted"),
        or(eq(friends.userId, userId), eq(friends.friendId, userId)),
      ),
    );
  const friendIds = acceptedFriendships.map((friendship) =>
    String(friendship.userId) === String(userId)
      ? friendship.friendId
      : friendship.userId,
  );
  if (!friendIds.length) return [];
  const rows = await db
    .select()
    .from(directConversations)
    .where(
      and(
        or(
          eq(directConversations.participantAId, userId),
          eq(directConversations.participantBId, userId),
        ),
        or(
          inArray(directConversations.participantAId, friendIds),
          inArray(directConversations.participantBId, friendIds),
        ),
      ),
    )
    .orderBy(desc(directConversations.updatedAt))
    .limit(DIRECT_MESSAGE_LIMIT);
  const conversationIds = rows.map((conversation) => conversation.id);
  const [friendProfiles, latestMessages, unreadCounts] = await Promise.all([
    profilesById(
      rows.map((conversation) =>
        String(conversation.participantAId) === String(userId)
          ? String(conversation.participantBId)
          : String(conversation.participantAId),
      ),
    ),
    latestMessagesByConversation(conversationIds),
    unreadCountsByConversation(userId, conversationIds),
  ]);
  return Promise.all(
    rows.map((conversation) =>
      presentConversation(
        conversation,
        userId,
        friendProfiles.get(
          String(
            String(conversation.participantAId) === String(userId)
              ? conversation.participantBId
              : conversation.participantAId,
          ),
        ),
        latestMessages.get(String(conversation.id)),
        unreadCounts.get(String(conversation.id)) || 0,
      ),
    ),
  );
}

export async function openDirectConversation(
  userId: DatabaseId,
  friendId: DatabaseId,
) {
  const friend = await requireFriend(userId, friendId);
  const pair = participantPair(userId, friend.id);
  let rows = await db
    .select()
    .from(directConversations)
    .where(
      and(
        eq(directConversations.participantAId, pair.participantAId),
        eq(directConversations.participantBId, pair.participantBId),
      ),
    )
    .limit(1);
  if (!rows[0]) {
    await db
      .insert(directConversations)
      .values(pair)
      .onConflictDoNothing({
        target: [
          directConversations.participantAId,
          directConversations.participantBId,
        ],
      });
    rows = await db
      .select()
      .from(directConversations)
      .where(
        and(
          eq(directConversations.participantAId, pair.participantAId),
          eq(directConversations.participantBId, pair.participantBId),
        ),
      )
      .limit(1);
  }
  if (!rows[0]) fail(500, "Direct conversation could not be created");
  return presentConversation(rows[0], userId, friend, null, 0);
}

export async function getDirectMessages(
  userId: DatabaseId,
  conversationId: DatabaseId,
  cursor: { before?: unknown; beforeId?: unknown } = {},
) {
  const { conversation, friendId } = await findConversationForUser(
    userId,
    conversationId,
  );
  const before = cursor.before ? new Date(String(cursor.before)) : null;
  const beforeId = cursor.beforeId ? String(cursor.beforeId) : "";
  if (
    (cursor.before && (!before || !Number.isFinite(before.getTime()))) ||
    (cursor.beforeId && !beforeId)
  )
    fail(400, "Invalid direct message history cursor");
  const historyCondition =
    before && beforeId
      ? or(
          lt(directMessages.createdAt, before),
          and(
            eq(directMessages.createdAt, before),
            lt(directMessages.id, beforeId),
          ),
        )
      : before
        ? lt(directMessages.createdAt, before)
        : null;
  const rows = await db
    .select()
    .from(directMessages)
    .where(
      historyCondition
        ? and(
            eq(directMessages.conversationId, conversation.id),
            historyCondition,
          )
        : eq(directMessages.conversationId, conversation.id),
    )
    .orderBy(desc(directMessages.createdAt), desc(directMessages.id))
    .limit(DIRECT_MESSAGE_LIMIT + 1);
  const hasMore = rows.length > DIRECT_MESSAGE_LIMIT;
  if (hasMore) rows.pop();
  const orderedRows = rows.reverse();
  const profileMap = await profilesById([
    ...new Set(orderedRows.map((message) => String(message.authorId))),
  ]);
  await markDirectConversationRead(userId, conversation.id, false);
  const friendProfile = await db
    .select()
    .from(profiles)
    .where(eq(profiles.id, friendId))
    .limit(1)
    .then((result) => result[0]);
  return {
    conversation: {
      id: String(conversation.id),
      friend: presentProfile(friendProfile),
      unread_count: 0,
    },
    items: orderedRows.map((message) =>
      presentMessage(message, profileMap.get(String(message.authorId))),
    ),
    hasMore,
    nextBefore: orderedRows[0]
      ? {
          created: orderedRows[0].createdAt,
          id: String(orderedRows[0].id),
        }
      : null,
  };
}

export async function sendDirectMessage(
  userId: DatabaseId,
  conversationId: DatabaseId,
  content: string,
  clientMessageId: string,
) {
  const { conversation, friendId } = await findConversationForUser(
    userId,
    conversationId,
  );
  if (!content.trim()) fail(400, "Message content is required");
  if (content.length > 4000)
    fail(400, "Message content must be at most 4000 characters");
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(String(clientMessageId || "")))
    fail(400, "A valid client message ID is required");
  const normalizedContent = content.trim();
  const createdRows = await db
    .insert(directMessages)
    .values({
      conversationId: conversation.id,
      authorId: userId,
      content: normalizedContent,
      clientId: clientMessageId,
    })
    .onConflictDoNothing()
    .returning();
  const created =
    createdRows[0] ||
    (await db
      .select()
      .from(directMessages)
      .where(
        and(
          eq(directMessages.conversationId, conversation.id),
          eq(directMessages.authorId, userId),
          eq(directMessages.clientId, clientMessageId),
        ),
      )
      .limit(1)
      .then((result) => result[0]));
  if (!created) fail(500, "Direct message could not be created");
  if (createdRows[0])
    await db
      .update(directConversations)
      .set({ updatedAt: created.createdAt })
      .where(eq(directConversations.id, conversation.id));
  const sender = await db
    .select()
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  const senderProfile = sender[0];
  if (!senderProfile) fail(500, "Sender profile not found");
  const result = presentMessage(created, senderProfile);
  if (createdRows[0]) {
    const event = {
      type: "direct_message",
      data: { conversation_id: String(conversation.id), message: result },
    };
    const notification = await createDirectMessageNotification(
      friendId,
      created,
      senderProfile,
    );
    if (notification) {
      await Promise.allSettled([
        broadcastToUser(String(friendId), {
          type: "notification_created",
          data: presentNotification(notification),
        }),
      ]);
    }
    await Promise.allSettled([
      broadcastToUser(String(friendId), event),
      broadcastToUser(String(userId), event),
    ]);
  }
  return result;
}

export async function markDirectConversationRead(
  userId: DatabaseId,
  conversationId: DatabaseId,
  validate = true,
) {
  const { conversation, friendId } = validate
    ? await findConversationForUser(userId, conversationId)
    : await db
        .select()
        .from(directConversations)
        .where(eq(directConversations.id, conversationId))
        .limit(1)
        .then((rows) => {
          const conversation = rows[0];
          if (!conversation) fail(404, "Direct conversation not found");
          const friendId =
            String(conversation.participantAId) === String(userId)
              ? conversation.participantBId
              : conversation.participantAId;
          return { conversation, friendId };
        });
  const readAt = new Date();
  const updatedRows = await db
    .update(directMessages)
    .set({ deliveredAt: readAt, readAt })
    .where(
      and(
        eq(directMessages.conversationId, conversation.id),
        ne(directMessages.authorId, userId),
        isNull(directMessages.readAt),
      ),
    )
    .returning({ id: directMessages.id });
  const messageIds = updatedRows.map((message) => String(message.id));
  await markDirectMessageNotificationsRead(userId, conversation.id);
  if (messageIds.length)
    await Promise.allSettled([
      broadcastToUser(String(friendId), {
        type: "direct_messages_read",
        data: {
          conversation_id: String(conversation.id),
          message_ids: messageIds,
          read_at: readAt.toISOString(),
        },
      }),
    ]);
  return { success: true, message_ids: messageIds };
}

export async function markDirectMessagesDelivered(
  userId: DatabaseId,
  conversationId: DatabaseId,
  messageIds: ExternalField,
) {
  const { conversation, friendId } = await findConversationForUser(
    userId,
    conversationId,
  );
  const ids = [
    ...new Set(
      (Array.isArray(messageIds) ? messageIds : []).flatMap((id) => {
        const value = parseExternalString(id);
        return value === null ? [] : [value];
      }),
    ),
  ];
  if (!ids.length) return { success: true, message_ids: [] };
  const deliveredAt = new Date();
  const updatedRows = await db
    .update(directMessages)
    .set({ deliveredAt })
    .where(
      and(
        eq(directMessages.conversationId, conversation.id),
        ne(directMessages.authorId, userId),
        inArray(directMessages.id, ids),
        isNull(directMessages.deliveredAt),
      ),
    )
    .returning({ id: directMessages.id });
  const updatedIds = updatedRows.map((message) => String(message.id));
  if (updatedIds.length)
    await Promise.allSettled([
      broadcastToUser(String(friendId), {
        type: "direct_messages_delivered",
        data: {
          conversation_id: String(conversation.id),
          message_ids: updatedIds,
          delivered_at: deliveredAt.toISOString(),
        },
      }),
    ]);
  return { success: true, message_ids: updatedIds };
}
