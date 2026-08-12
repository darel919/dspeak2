import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import type { channels, rooms } from "../db/schema/index.ts";

export type AuthorizationRoom = InferSelectModel<typeof rooms>;
export type AuthorizationChannel = InferSelectModel<typeof channels>;
export type AuthorizationChannelUpdate = Partial<
  InferInsertModel<typeof channels>
>;

export interface CachedRoomAccess {
  member: boolean;
  membership: Record<string, unknown> | null;
  roles: Array<{
    id: string | null;
    name: string | null;
    color: string | null;
    position: number | null;
    permissions: string[];
    system: boolean;
    isDefault: boolean;
  }>;
}

export interface RoomMemberAccess extends CachedRoomAccess {
  isOwner: boolean;
  permissions: string[];
  highestPosition: number;
}
