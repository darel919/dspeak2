import {
  DEFAULT_ROLE_TEMPLATES,
  canManageRole,
  getEffectivePermissions,
  getHighestRolePosition,
  normalizePermissions,
} from "../../shared/room-policy.ts";
import { db } from "../db/client.ts";
import {
  rooms,
  roomMemberships,
  roomRoles,
  membershipRoles,
  channels,
} from "../db/schema/index.ts";
import { eq, and } from "drizzle-orm";
import type {
  AuthorizationChannelUpdate,
  AuthorizationRoom,
  CachedRoomAccess,
} from "../types/room-authorization.ts";

const CACHE_TTL_MS = 15_000;
const CACHE_MAX_SIZE = 2_000;
const roomAccessCache = new Map<
  string,
  { value: CachedRoomAccess; timestamp: number }
>();

function evictExpiredEntries() {
  const now = Date.now();
  for (const [key, entry] of roomAccessCache) {
    if (now - entry.timestamp >= CACHE_TTL_MS) roomAccessCache.delete(key);
  }
}

export function invalidateRoomAccess(
  roomId: string | null | undefined,
  userId: string | null | undefined,
) {
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

export async function getRoomAccess(room: AuthorizationRoom, userId: string) {
  const isOwner = String(room.ownerId) === String(userId);

  const cacheKey = `${String(room.id)}:${String(userId)}`;
  const now = Date.now();
  const cached = roomAccessCache.get(cacheKey);
  let dbResult: CachedRoomAccess;

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
        id: String(m.roleId),
        name: m.roleName,
        color: m.roleColor,
        position: Number(m.rolePosition) || 0,
        permissions: normalizePermissions(m.rolePermissions),
        system: Boolean(m.roleSystem),
        isDefault: Boolean(m.roleIsDefault),
      }));

    dbResult = {
      member: membership.length > 0,
      membership: membership[0] || null,
      roles,
    };

    evictExpiredEntries();
    if (roomAccessCache.size >= CACHE_MAX_SIZE) {
      const oldestKey = roomAccessCache.keys().next().value;
      if (oldestKey) roomAccessCache.delete(oldestKey);
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

export async function requireRoomMember(
  room: AuthorizationRoom,
  userId: string,
) {
  const access = await getRoomAccess(room, userId);
  if (!access.member) {
    throw createError({
      statusCode: 403,
      statusMessage: "Access denied to this room",
    });
  }
  return access;
}

export async function requireRoomPermission(
  room: AuthorizationRoom,
  userId: string,
  permission: string,
) {
  const access = await requireRoomMember(room, userId);
  if (!access.permissions.includes(permission)) {
    throw createError({
      statusCode: 403,
      statusMessage: `Missing room permission: ${permission}`,
    });
  }
  return access;
}

export async function seedRoomRoles(
  room: AuthorizationRoom,
  ownerId: string,
  database: Pick<typeof db, "insert"> = db,
) {
  const roleTemplates = DEFAULT_ROLE_TEMPLATES;
  const createdRoles = await database
    .insert(roomRoles)
    .values(
      roleTemplates.map((template) => ({
        roomId: room.id,
        name: template.name,
        color: template.color,
        position: template.position,
        permissions: template.permissions,
        system: template.system,
        isDefault: template.is_default,
      })),
    )
    .returning();
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
    const ownerMembership = membership[0];
    if (ownerMembership)
      await database.insert(membershipRoles).values({
        membershipId: ownerMembership.id,
        roleId: ownerRole.id,
      });
  }
  invalidateRoomAccess(room.id, ownerId);
  return createdRoles;
}

export async function ensureRoomMembership(
  room: AuthorizationRoom,
  userId: string,
) {
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

export async function removeRoomMembership(roomId: string, userId: string) {
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

export async function presentRoomAccess(
  room: AuthorizationRoom,
  userId: string,
) {
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

export async function requireRoleManagement(
  room: AuthorizationRoom,
  userId: string,
  targetRole: Parameters<typeof canManageRole>[1],
) {
  const access = await requireRoomPermission(room, userId, "room.manage_roles");
  if (
    targetRole &&
    !canManageRole(
      access.roles.map((role) => ({
        permissions: normalizePermissions(role.permissions),
        position: Number(role.position) || 0,
        system: Boolean(role.system),
      })),
      targetRole,
      access.isOwner,
    )
  ) {
    throw createError({
      statusCode: 403,
      statusMessage: "You cannot manage a role at or above your position",
    });
  }
  return access;
}

export async function getChannelById(channelId: string) {
  const result = await db
    .select()
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);
  return result[0] || null;
}

export async function updateChannel(
  channelId: string,
  data: AuthorizationChannelUpdate,
) {
  const result = await db
    .update(channels)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(channels.id, channelId))
    .returning();
  return result[0] || null;
}

export async function getRoomById(roomId: string) {
  const result = await db
    .select()
    .from(rooms)
    .where(eq(rooms.id, roomId))
    .limit(1);
  return result[0] || null;
}
