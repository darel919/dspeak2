import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import type {
  avatars,
  librarySongs,
  notifications,
  notificationPreferences,
  pushJobs,
  pushSubscriptions,
  roomImages,
  roomNotificationPreferences,
  roomSoundboards,
  streamPlayLog,
  bookmarks,
  channels,
  friends,
  membershipRoles,
  messageReactions,
  messageRevisions,
  messages,
  pinnedMessages,
  roomAuditLog,
  roomInvites,
  roomMemberships,
  roomRoles,
  rooms,
  userNicknames,
} from "../db/schema/index.ts";

export type RoomRow = InferSelectModel<typeof rooms>;
export type ChannelRow = InferSelectModel<typeof channels>;
export type RoomRoleRow = InferSelectModel<typeof roomRoles>;
export type MembershipRow = InferSelectModel<typeof roomMemberships>;
export type MembershipRoleRow = InferSelectModel<typeof membershipRoles>;
export type MessageRow = InferSelectModel<typeof messages>;
export type MessageRevisionRow = InferSelectModel<typeof messageRevisions>;
export type MessageReactionRow = InferSelectModel<typeof messageReactions>;
export type PinnedMessageRow = InferSelectModel<typeof pinnedMessages>;
export type BookmarkRow = InferSelectModel<typeof bookmarks>;
export type FriendshipRow = InferSelectModel<typeof friends>;
export type NicknameRow = InferSelectModel<typeof userNicknames>;
export type RoomInviteRow = InferSelectModel<typeof roomInvites>;
export type RoomAuditRow = InferSelectModel<typeof roomAuditLog>;

export type RoomInsert = InferInsertModel<typeof rooms>;
export type ChannelInsert = InferInsertModel<typeof channels>;
export type RoomRoleInsert = InferInsertModel<typeof roomRoles>;
export type MembershipInsert = InferInsertModel<typeof roomMemberships>;
export type MessageInsert = InferInsertModel<typeof messages>;
export type RoomAuditInsert = InferInsertModel<typeof roomAuditLog>;

export type SoundboardInsert = InferInsertModel<typeof roomSoundboards>;
export type LibrarySongInsert = InferInsertModel<typeof librarySongs>;
export type PlayLogInsert = InferInsertModel<typeof streamPlayLog>;
export type AvatarInsert = InferInsertModel<typeof avatars>;
export type RoomImageInsert = InferInsertModel<typeof roomImages>;
export type NotificationInsert = InferInsertModel<typeof notifications>;
export type NotificationPreferenceInsert = InferInsertModel<
  typeof notificationPreferences
>;
export type RoomNotificationPreferenceInsert = InferInsertModel<
  typeof roomNotificationPreferences
>;
export type PushSubscriptionInsert = InferInsertModel<typeof pushSubscriptions>;
export type PushJobInsert = InferInsertModel<typeof pushJobs>;
export type NotificationPreferencePatch = Partial<NotificationPreferenceInsert>;
export type RoomNotificationPreferencePatch =
  Partial<RoomNotificationPreferenceInsert>;
