import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  real,
  jsonb,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  username: text("username").notNull().unique(),
  displayName: text("display_name"),
  avatarKey: text("avatar_key"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  name: text("name"),
  username: text("username").unique(),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const rooms = pgTable("rooms", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  imageKey: text("image_key"),
  accent: text("accent"),
  attenuation: jsonb("attenuation").$type().default({}).notNull(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const channels = pgTable("channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  roomId: uuid("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type", { enum: ["voice", "text", "announcement", "stage"] })
    .default("voice")
    .notNull(),
  position: integer("position").default(0).notNull(),
  policy: text("policy").default("free").notNull(),
  slowMode: integer("slow_mode").default(0).notNull(),
  mediaPolicy: jsonb("media_policy").$type().default({}).notNull(),
  ownerId: uuid("owner_id").references(() => profiles.id, {
    onDelete: "set null",
  }),
  inRoom: uuid("in_room").array().default([]).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const roomRoles = pgTable("room_roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  roomId: uuid("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color"),
  position: integer("position").default(0).notNull(),
  permissions: jsonb("permissions").$type().default([]).notNull(),
  system: boolean("system").default(false).notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const roomMemberships = pgTable(
  "room_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    uniqueRoomUser: uniqueIndex("unique_room_user").on(
      table.roomId,
      table.userId,
    ),
  }),
);

export const membershipRoles = pgTable(
  "membership_roles",
  {
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => roomMemberships.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roomRoles.id, { onDelete: "cascade" }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.membershipId, table.roleId] }),
  }),
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    replyToId: uuid("reply_to_id").references(() => messages.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    clientId: text("client_id"),
    readBy: jsonb("read_by").$type().default([]).notNull(),
    pinned: boolean("pinned").default(false).notNull(),
  },
  (table) => ({
    uniqueChannelAuthorClient: uniqueIndex("unique_channel_author_client").on(
      table.channelId,
      table.authorId,
      table.clientId,
    ),
  }),
);

export const messageRevisions = pgTable("message_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  messageId: uuid("message_id")
    .notNull()
    .references(() => messages.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  editedAt: timestamp("edited_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  editorId: uuid("editor_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
});

export const messageReactions = pgTable(
  "message_reactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    uniqueMessageUserEmoji: uniqueIndex("unique_message_user_emoji").on(
      table.messageId,
      table.userId,
      table.emoji,
    ),
  }),
);

export const pinnedMessages = pgTable(
  "pinned_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    pinnedById: uuid("pinned_by_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    uniqueChannelMessage: uniqueIndex("unique_channel_message").on(
      table.channelId,
      table.messageId,
    ),
  }),
);

export const bookmarks = pgTable(
  "bookmarks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    uniqueUserMessage: uniqueIndex("unique_user_message").on(
      table.userId,
      table.messageId,
    ),
  }),
);

export const friends = pgTable(
  "friends",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    friendId: uuid("friend_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["pending", "accepted", "blocked"] })
      .default("pending")
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    uniqueFriendship: uniqueIndex("unique_friendship").on(
      table.userId,
      table.friendId,
    ),
  }),
);

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  data: text("data"),
  read: boolean("read").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const notificationPreferences = pgTable("notification_preferences", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" })
    .unique(),
  allMessages: boolean("all_messages").default(false).notNull(),
  mentions: boolean("mentions").default(true).notNull(),
  replies: boolean("replies").default(true).notNull(),
  friendRequests: boolean("friend_requests").default(true).notNull(),
  roomInvites: boolean("room_invites").default(true).notNull(),
  push: boolean("push").default(false).notNull(),
  sound: boolean("sound").default(true).notNull(),
  previews: boolean("previews").default(true).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const roomNotificationPreferences = pgTable(
  "room_notification_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    muteUntil: timestamp("mute_until", { withTimezone: true }),
    allMessages: boolean("all_messages").default(false).notNull(),
    mentions: boolean("mentions").default(true).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    uniqueUserRoom: uniqueIndex("unique_user_room_notification").on(
      table.userId,
      table.roomId,
    ),
  }),
);

export const userNicknames = pgTable(
  "user_nicknames",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    nickname: text("nickname").notNull(),
    setById: uuid("set_by_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    uniqueRoomUser: uniqueIndex("unique_room_user_nickname").on(
      table.roomId,
      table.userId,
    ),
  }),
);

export const roomInvites = pgTable("room_invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  roomId: uuid("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  channelId: uuid("channel_id").references(() => channels.id, {
    onDelete: "set null",
  }),
  inviterId: uuid("inviter_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  inviteeId: uuid("invitee_id").references(() => profiles.id, {
    onDelete: "cascade",
  }),
  code: text("code").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const roomAuditLog = pgTable("room_audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  roomId: uuid("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  targetId: uuid("target_id"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    userEndpointUnique: uniqueIndex(
      "push_subscriptions_user_id_endpoint_unique",
    ).on(table.userId, table.endpoint),
  }),
);

export const pushJobs = pgTable("push_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  subscriptionId: uuid("subscription_id")
    .notNull()
    .references(() => pushSubscriptions.id, { onDelete: "cascade" }),
  recipientId: uuid("recipient_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  payload: text("payload").notNull(),
  status: text("status", { enum: ["pending", "sent", "failed"] })
    .default("pending")
    .notNull(),
  attempts: integer("attempts").default(0).notNull(),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const roomSoundboards = pgTable("room_soundboards", {
  id: uuid("id").primaryKey().defaultRandom(),
  roomId: uuid("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  audioKey: text("audio_key").notNull(),
  category: text("category").default("General").notNull(),
  icon: text("icon").default("🔊").notNull(),
  iconImageKey: text("icon_image_key"),
  duration: real("duration").default(0).notNull(),
  displayOrder: integer("display_order").default(0).notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  volume: integer("volume").default(100).notNull(),
  createdById: uuid("created_by_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const chatFiles = pgTable("chat_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  channelId: uuid("channel_id")
    .notNull()
    .references(() => channels.id, { onDelete: "cascade" }),
  messageId: uuid("message_id").references(() => messages.id, {
    onDelete: "set null",
  }),
  uploaderId: uuid("uploader_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  r2Key: text("r2_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const librarySongs = pgTable("library_songs", {
  id: uuid("id").primaryKey().defaultRandom(),
  roomId: uuid("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  artist: text("artist"),
  album: text("album"),
  audioKey: text("audio_key").notNull(),
  artworkKey: text("artwork_key"),
  duration: integer("duration"),
  addedById: uuid("added_by_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const streamPlayLog = pgTable("stream_play_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  roomId: uuid("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  songId: uuid("song_id").references(() => librarySongs.id, {
    onDelete: "set null",
  }),
  playedById: uuid("played_by_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const avatars = pgTable("avatars", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  r2Key: text("r2_key").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const roomImages = pgTable("room_images", {
  id: uuid("id").primaryKey().defaultRandom(),
  roomId: uuid("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["profile", "header"] }).notNull(),
  r2Key: text("r2_key").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const soundboards = pgTable("soundboards", {
  id: uuid("id").primaryKey().defaultRandom(),
  roomId: uuid("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  audioKey: text("audio_key").notNull(),
  volume: integer("volume").default(100).notNull(),
  createdById: uuid("created_by_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const userPresence = pgTable("user_presence", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => profiles.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["online", "idle", "dnd", "offline"] })
    .default("offline")
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  isManualOverride: boolean("is_manual_override").default(false).notNull(),
  platform: text("platform").default("web").notNull(),
});
