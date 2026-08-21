import type { H3Event } from "h3";
import type { InferSelectModel } from "drizzle-orm";
import type { channels, profiles, rooms } from "../db/schema/index.ts";
import type {
  ExternalField,
  ExternalRecord,
} from "../../shared/types/external.ts";

export type RoomsApiEvent = H3Event;
export type RoomRow = InferSelectModel<typeof rooms>;
export type ChannelRow = InferSelectModel<typeof channels>;
export type ProfileRow = InferSelectModel<typeof profiles>;

export interface InvitePayload {
  [key: string]: unknown;
}

export interface RoomsApiBody extends ExternalRecord {
  roomId?: string;
  channelId?: string;
  membershipId?: string;
  roleId?: string;
  targetUserId?: string;
  inviteToken?: string;
  name?: string;
  desc?: string;
  accent?: string;
  roleIds?: ExternalField;
  permissions?: ExternalField;
  position?: ExternalField;
  [key: string]: ExternalField;
}
