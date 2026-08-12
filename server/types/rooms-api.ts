import type { H3Event } from "h3";
import type { InferSelectModel } from "drizzle-orm";
import type { channels, profiles, rooms } from "../db/schema/index.ts";

export type RoomsApiEvent = H3Event;
export type RoomRow = InferSelectModel<typeof rooms>;
export type ChannelRow = InferSelectModel<typeof channels>;
export type ProfileRow = InferSelectModel<typeof profiles>;

export interface InvitePayload {
  [key: string]: unknown;
}

export interface RoomsApiBody extends Record<string, unknown> {
  roomId?: string;
  channelId?: string;
  name?: string;
  desc?: string;
  roleIds?: unknown;
  permissions?: unknown;
  position?: unknown;
  [key: string]: unknown;
}
