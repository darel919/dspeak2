import { db } from "../client.ts";
import {
  rooms,
  channels,
  roomRoles,
  roomMemberships,
  membershipRoles,
} from "../schema/index.ts";
import { eq, and, desc, asc, count } from "drizzle-orm";
export class RoomRepository {
  [key: string]: any;
  async findById(id) {
    const result = await db
      .select()
      .from(rooms)
      .where(eq(rooms.id, id))
      .limit(1);
    return result[0] || null;
  }

  async findByOwner(ownerId, { limit = 50, offset = 0 } = {} as any) {
    return db
      .select()
      .from(rooms)
      .where(eq(rooms.ownerId, ownerId))
      .orderBy(desc(rooms.createdAt))
      .limit(limit)
      .offset(offset);
  }

  async create(room) {
    const result = await db.insert(rooms).values(room).returning();
    return result[0];
  }

  async update(id, data) {
    const result = await db
      .update(rooms)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(rooms.id, id))
      .returning();
    return result[0] || null;
  }

  async delete(id) {
    await db.delete(rooms).where(eq(rooms.id, id));
  }
}
export class ChannelRepository {
  [key: string]: any;
  async findById(id) {
    const result = await db
      .select()
      .from(channels)
      .where(eq(channels.id, id))
      .limit(1);
    return result[0] || null;
  }

  async findByRoom(roomId) {
    return db
      .select()
      .from(channels)
      .where(eq(channels.roomId, roomId))
      .orderBy(asc(channels.position), asc(channels.createdAt));
  }

  async create(channel) {
    const result = await db.insert(channels).values(channel).returning();
    return result[0];
  }

  async update(id, data) {
    const result = await db
      .update(channels)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(channels.id, id))
      .returning();
    return result[0] || null;
  }

  async delete(id) {
    await db.delete(channels).where(eq(channels.id, id));
  }

  async reorder(channelOrders) {
    for (const { id, position } of channelOrders) {
      await db.update(channels).set({ position }).where(eq(channels.id, id));
    }
  }
}
export class RoomRoleRepository {
  [key: string]: any;
  async findByRoom(roomId) {
    return db
      .select()
      .from(roomRoles)
      .where(eq(roomRoles.roomId, roomId))
      .orderBy(asc(roomRoles.position));
  }

  async findById(id) {
    const result = await db
      .select()
      .from(roomRoles)
      .where(eq(roomRoles.id, id))
      .limit(1);
    return result[0] || null;
  }

  async create(role) {
    const result = await db.insert(roomRoles).values(role).returning();
    return result[0];
  }

  async update(id, data) {
    const result = await db
      .update(roomRoles)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(roomRoles.id, id))
      .returning();
    return result[0] || null;
  }

  async delete(id) {
    await db.delete(roomRoles).where(eq(roomRoles.id, id));
  }
}
export class MembershipRepository {
  [key: string]: any;
  async findByRoom(roomId) {
    return db
      .select()
      .from(roomMemberships)
      .where(eq(roomMemberships.roomId, roomId));
  }

  async findByUser(userId) {
    return db
      .select()
      .from(roomMemberships)
      .where(eq(roomMemberships.userId, userId));
  }

  async findByRoomAndUser(roomId, userId) {
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

  async create(membership) {
    const result = await db
      .insert(roomMemberships)
      .values(membership)
      .returning();
    return result[0];
  }

  async delete(roomId, userId) {
    await db
      .delete(roomMemberships)
      .where(
        and(
          eq(roomMemberships.roomId, roomId),
          eq(roomMemberships.userId, userId),
        ),
      );
  }

  async addRole(membershipId, roleId) {
    await db.insert(membershipRoles).values({ membershipId, roleId });
  }

  async removeRole(membershipId, roleId) {
    await db
      .delete(membershipRoles)
      .where(
        and(
          eq(membershipRoles.membershipId, membershipId),
          eq(membershipRoles.roleId, roleId),
        ),
      );
  }

  async getRoles(membershipId) {
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
