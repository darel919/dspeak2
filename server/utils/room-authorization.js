import {
  DEFAULT_ROLE_TEMPLATES,
  canManageRole,
  getEffectivePermissions,
  getHighestRolePosition,
  normalizePermissions,
} from "../../shared/room-policy.js";
import { db } from "../db/client.js";
import {
  rooms,
  roomMemberships,
  roomRoles,
  membershipRoles,
  channels,
} from "../db/schema/index.js";
import { eq, and, inArray } from "drizzle-orm";

export async function getRoomAccess(room, userId) {
  const isOwner = String(room.ownerId) === String(userId);
  const membership = await db
    .select({
      id: roomMemberships.id,
      userId: roomMemberships.userId,
      roomId: roomMemberships.roomId,
      roleId: membershipRoles.roleId,
      roleName: roomRoles.name,
      roleColor: roomRoles.color,
      rolePosition: roomRoles.position,
      rolePermissions: roomRoles.permissions,
      roleSystem: roomRoles.system,
      roleIsDefault: roomRoles.isDefault,
    })
    .from(roomMemberships)
    .leftJoin(
      membershipRoles,
      eq(membershipRoles.membershipId, roomMemberships.id),
    )
    .leftJoin(roomRoles, eq(roomRoles.id, membershipRoles.roleId))
    .where(
      and(
        eq(roomMemberships.roomId, room.id),
        eq(roomMemberships.userId, userId),
      ),
    );

  const roles = membership
    .filter((m) => m.roleId)
    .map((m) => ({
      id: m.roleId,
      name: m.roleName,
      color: m.roleColor,
      position: m.rolePosition,
      permissions: m.rolePermissions,
      system: m.roleSystem,
      isDefault: m.roleIsDefault,
    }));

  return {
    member: membership.length > 0,
    membership: membership[0] || null,
    roles,
    isOwner,
    permissions: getEffectivePermissions(roles, isOwner),
    highestPosition: getHighestRolePosition(roles, isOwner),
  };
}

export async function requireRoomMember(room, userId) {
  const access = await getRoomAccess(room, userId);
  if (!access.member) {
    throw createError({
      statusCode: 403,
      statusMessage: "Access denied to this room",
    });
  }
  return access;
}

export async function requireRoomPermission(room, userId, permission) {
  const access = await requireRoomMember(room, userId);
  if (!access.permissions.includes(permission)) {
    throw createError({
      statusCode: 403,
      statusMessage: `Missing room permission: ${permission}`,
    });
  }
  return access;
}

export async function seedRoomRoles(room, ownerId) {
  const createdRoles = [];
  for (const template of DEFAULT_ROLE_TEMPLATES) {
    const result = await db
      .insert(roomRoles)
      .values({
        roomId: room.id,
        name: template.name,
        color: template.color,
        position: template.position,
        permissions: template.permissions,
        system: template.system,
        isDefault: template.isDefault,
      })
      .returning();
    createdRoles.push(result[0]);
  }
  const ownerRole = createdRoles.find((role) => role.system);
  if (ownerRole) {
    await db.insert(roomMemberships).values({
      roomId: room.id,
      userId: ownerId,
      joinedAt: new Date(),
    });
  }
  return createdRoles;
}

export async function ensureRoomMembership(room, userId) {
  const existing = await db
    .select()
    .from(roomMemberships)
    .where(
      and(
        eq(roomMemberships.roomId, room.id),
        eq(roomMemberships.userId, userId),
      ),
    )
    .limit(1);
  if (existing.length) return existing[0];

  const defaultRoles = await db
    .select({ id: roomRoles.id })
    .from(roomRoles)
    .where(and(eq(roomRoles.roomId, room.id), eq(roomRoles.isDefault, true)));

  const membership = await db
    .insert(roomMemberships)
    .values({
      roomId: room.id,
      userId,
      joinedAt: new Date(),
    })
    .returning();

  if (defaultRoles.length > 0) {
    await Promise.all(
      defaultRoles.map((role) =>
        db.insert(membershipRoles).values({
          membershipId: membership[0].id,
          roleId: role.id,
        }),
      ),
    );
  }
  return membership[0];
}

export async function removeRoomMembership(roomId, userId) {
  await db
    .delete(roomMemberships)
    .where(
      and(
        eq(roomMemberships.roomId, roomId),
        eq(roomMemberships.userId, userId),
      ),
    );
}

export async function presentRoomAccess(room, userId) {
  const access = await getRoomAccess(room, userId);
  return {
    roles: access.roles.map((role) => ({
      id: role.id,
      name: role.name,
      color: role.color,
      position: role.position,
      permissions: normalizePermissions(role.permissions),
      system: Boolean(role.system),
      isDefault: Boolean(role.isDefault),
    })),
    permissions: access.permissions,
    isOwner: access.isOwner,
  };
}

export async function requireRoleManagement(room, userId, targetRole) {
  const access = await requireRoomPermission(room, userId, "room.manage_roles");
  if (targetRole && !canManageRole(access.roles, targetRole, access.isOwner)) {
    throw createError({
      statusCode: 403,
      statusMessage: "You cannot manage a role at or above your position",
    });
  }
  return access;
}

export async function getChannelById(channelId) {
  const result = await db
    .select()
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);
  return result[0] || null;
}

export async function updateChannel(channelId, data) {
  const result = await db
    .update(channels)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(channels.id, channelId))
    .returning();
  return result[0] || null;
}

export async function getRoomById(roomId) {
  const result = await db
    .select()
    .from(rooms)
    .where(eq(rooms.id, roomId))
    .limit(1);
  return result[0] || null;
}
