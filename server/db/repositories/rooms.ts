import { db } from "../client.ts";
import {
  rooms,
  channels,
  roomRoles,
  roomMemberships,
  membershipRoles,
} from "../schema/index.ts";
import { eq, and, desc, asc, count } from "drizzle-orm";
import type {
  ChannelInsert,
  RoomInsert,
  RoomRoleInsert,
} from "../../types/repositories.ts";
type RoomPatch = Partial<RoomInsert>;
type ChannelPatch = Partial<ChannelInsert>;
type RoomRolePatch = Partial<RoomRoleInsert>;
export class RoomRepository {
  async findById(id: string) {
    const result = await db
      .select()
      .from(rooms)
      .where(eq(rooms.id, id))
      .limit(1);
    return result[0] || null;
  }

  async findByOwner(
    ownerId: string,
    { limit = 50, offset = 0 }: { limit?: number; offset?: number } = {},
  ) {
    return db
      .select()
      .from(rooms)
      .where(eq(rooms.ownerId, ownerId))
      .orderBy(desc(rooms.createdAt))
      .limit(limit)
      .offset(offset);
  }

  async create(room: RoomInsert) {
    const result = await db.insert(rooms).values(room).returning();
    return result[0];
  }

  async update(id: string, data: RoomPatch) {
    const result = await db
      .update(rooms)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(rooms.id, id))
      .returning();
    return result[0] || null;
  }

  async delete(id: string) {
    await db.delete(rooms).where(eq(rooms.id, id));
  }
}
export class ChannelRepository {
  async findById(id: string) {
    const result = await db
      .select()
      .from(channels)
      .where(eq(channels.id, id))
      .limit(1);
    return result[0] || null;
  }

  async findByRoom(roomId: string) {
    return db
      .select()
      .from(channels)
      .where(eq(channels.roomId, roomId))
      .orderBy(asc(channels.position), asc(channels.createdAt));
  }

  async create(channel: ChannelInsert) {
    const result = await db.insert(channels).values(channel).returning();
    return result[0];
  }

  async update(id: string, data: ChannelPatch) {
    const result = await db
      .update(channels)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(channels.id, id))
      .returning();
    return result[0] || null;
  }

  async delete(id: string) {
    await db.delete(channels).where(eq(channels.id, id));
  }

  async reorder(channelOrders: Array<Pick<ChannelInsert, "id" | "position">>) {
    for (const { id, position } of channelOrders) {
      if (!id) continue;
      await db.update(channels).set({ position }).where(eq(channels.id, id));
    }
  }
}
export class RoomRoleRepository {
  async findByRoom(roomId: string) {
    return db
      .select()
      .from(roomRoles)
      .where(eq(roomRoles.roomId, roomId))
      .orderBy(asc(roomRoles.position));
  }

  async findById(id: string) {
    const result = await db
      .select()
      .from(roomRoles)
      .where(eq(roomRoles.id, id))
      .limit(1);
    return result[0] || null;
  }

  async create(role: RoomRoleInsert) {
    const result = await db.insert(roomRoles).values(role).returning();
    return result[0];
  }

  async update(id: string, data: RoomRolePatch) {
    const result = await db
      .update(roomRoles)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(roomRoles.id, id))
      .returning();
    return result[0] || null;
  }

  async delete(id: string) {
    await db.delete(roomRoles).where(eq(roomRoles.id, id));
  }
}
export class MembershipRepository {
  async findByRoom(roomId: string) {
    return db
      .select()
      .from(roomMemberships)
      .where(eq(roomMemberships.roomId, roomId));
  }

  async findByUser(userId: string) {
    return db
      .select()
      .from(roomMemberships)
      .where(eq(roomMemberships.userId, userId));
  }

  async findByRoomAndUser(roomId: string, userId: string) {
    const result = await db
      .select()
      .from(roomMemberships)
      .where(
        and(
          eq(roomMemberships.roomId, roomId),
          eq(roomMemberships.userId, userId),
        ),
      )
      .limit(1);
    return result[0] || null;
  }

  async create(
    membership: import("../../types/repositories.ts").MembershipInsert,
  ) {
    const result = await db
      .insert(roomMemberships)
      .values(membership)
      .returning();
    return result[0];
  }

  async delete(roomId: string, userId: string) {
    await db
      .delete(roomMemberships)
      .where(
        and(
          eq(roomMemberships.roomId, roomId),
          eq(roomMemberships.userId, userId),
        ),
      );
  }

  async addRole(membershipId: string, roleId: string) {
    await db.insert(membershipRoles).values({ membershipId, roleId });
  }

  async removeRole(membershipId: string, roleId: string) {
    await db
      .delete(membershipRoles)
      .where(
        and(
          eq(membershipRoles.membershipId, membershipId),
          eq(membershipRoles.roleId, roleId),
        ),
      );
  }

  async getRoles(membershipId: string) {
    return db
      .select()
      .from(membershipRoles)
      .where(eq(membershipRoles.membershipId, membershipId));
  }
}

export const roomRepository = new RoomRepository();
export const channelRepository = new ChannelRepository();
export const roomRoleRepository = new RoomRoleRepository();
export const membershipRepository = new MembershipRepository();
