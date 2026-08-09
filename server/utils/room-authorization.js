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

const CACHE_TTL_MS = 15_000;
const CACHE_MAX_SIZE = 2_000;
const roomAccessCache = new Map();

function evictExpiredEntries() {
  const now = Date.now();
  for (const [key, entry] of roomAccessCache) {
    if (now - entry.timestamp >= CACHE_TTL_MS) roomAccessCache.delete(key);
  }
}

export function invalidateRoomAccess(roomId, userId) {
  if (roomId == null && userId == null) {
    roomAccessCache.clear();
    return;
  }
  if (roomId == null) {
    const uid = String(userId);
    for (const [key] of roomAccessCache) {
      if (key.endsWith(`:${uid}`)) roomAccessCache.delete(key);
    }
    return;
  }
  if (userId == null) {
    const prefix = `${String(roomId)}:`;
    for (const [key] of roomAccessCache) {
      if (key.startsWith(prefix)) roomAccessCache.delete(key);
    }
    return;
  }
  roomAccessCache.delete(`${String(roomId)}:${String(userId)}`);
}

export async function getRoomAccess(room, userId) {
  const isOwner = String(room.ownerId) === String(userId);

  const cacheKey = `${String(room.id)}:${String(userId)}`;
  const now = Date.now();
  const cached = roomAccessCache.get(cacheKey);
  let dbResult;

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    dbResult = cached.value;
  } else {
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

    dbResult = {
      member: membership.length > 0,
      membership: membership[0] || null,
      roles,
    };

    evictExpiredEntries();
    if (roomAccessCache.size >= CACHE_MAX_SIZE) {
      const oldestKey = roomAccessCache.keys().next().value;
      roomAccessCache.delete(oldestKey);
    }
    roomAccessCache.set(cacheKey, { value: dbResult, timestamp: now });
  }

  return {
    ...dbResult,
    isOwner,
    permissions: getEffectivePermissions(dbResult.roles, isOwner),
    highestPosition: getHighestRolePosition(dbResult.roles, isOwner),
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

export async function seedRoomRoles(room, ownerId, database = db) {
  const createdRoles = [];
  for (const template of DEFAULT_ROLE_TEMPLATES) {
    const result = await database
      .insert(roomRoles)
      .values({
        roomId: room.id,
        name: template.name,
        color: template.color,
        position: template.position,
        permissions: template.permissions,
        system: template.system,
        isDefault: template.isDefault ?? template.is_default,
      })
      .returning();
    createdRoles.push(result[0]);
  }
  const ownerRole = createdRoles.find((role) => role.system);
  if (ownerRole) {
    const membership = await database
      .insert(roomMemberships)
      .values({
        roomId: room.id,
        userId: ownerId,
        joinedAt: new Date(),
      })
      .returning({ id: roomMemberships.id });
    await database.insert(membershipRoles).values({
      membershipId: membership[0].id,
      roleId: ownerRole.id,
    });
  }
  invalidateRoomAccess(room.id, ownerId);
  return createdRoles;
}

export async function ensureRoomMembership(room, userId) {
  const membership = await db.transaction(async (tx) => {
    const existing = await tx
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

    const defaultRoles = await tx
      .select({ id: roomRoles.id })
      .from(roomRoles)
      .where(and(eq(roomRoles.roomId, room.id), eq(roomRoles.isDefault, true)));

    const inserted = await tx
      .insert(roomMemberships)
      .values({
        roomId: room.id,
        userId,
        joinedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning();
    const result =
      inserted[0] ||
      (
        await tx
          .select()
          .from(roomMemberships)
          .where(
            and(
              eq(roomMemberships.roomId, room.id),
              eq(roomMemberships.userId, userId),
            ),
          )
          .limit(1)
      )[0];
    if (!result) throw new Error("Room membership could not be created");

    if (inserted.length && defaultRoles.length > 0)
      await Promise.all(
        defaultRoles.map((role) =>
          tx
            .insert(membershipRoles)
            .values({
              membershipId: result.id,
              roleId: role.id,
            })
            .onConflictDoNothing(),
        ),
      );
    return result;
  });
  invalidateRoomAccess(room.id, userId);
  return membership;
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
  invalidateRoomAccess(roomId, userId);
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
