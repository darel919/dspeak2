import type { InferSelectModel } from "drizzle-orm";
import type {
  directConversations,
  directMessages,
  friends,
  notifications,
  profiles,
} from "../db/schema/index.ts";

export type DatabaseId = string;
export type ProfileRow = InferSelectModel<typeof profiles>;
export type DirectConversationRow = InferSelectModel<
  typeof directConversations
>;
export type DirectMessageRow = InferSelectModel<typeof directMessages>;
export type FriendRow = InferSelectModel<typeof friends>;
export type NotificationRow = InferSelectModel<typeof notifications>;
