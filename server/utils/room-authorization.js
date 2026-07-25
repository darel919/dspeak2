import {
  DEFAULT_ROLE_TEMPLATES,
  canManageRole,
  getEffectivePermissions,
  getHighestRolePosition,
  normalizePermissions,
} from "../../shared/room-policy.js";
import { getBoundedList } from "./pocketbase-query.js";

export async function getRoomAccess(pb, room, userId) {
  const isOwner = String(room.owner) === String(userId);
  try {
    const membership = await pb
      .collection("dspeak_room_memberships")
      .getFirstListItem(`room = '${room.id}' && user = '${userId}'`, {
        expand: "roles",
      });
    const roles = membership.expand?.roles || [];
    return {
      member: true,
      membership,
      roles,
      isOwner,
      permissions: getEffectivePermissions(roles, isOwner),
      highestPosition: getHighestRolePosition(roles, isOwner),
    };
  } catch (error) {
    if (error?.status !== 404 && error?.response?.status !== 404) throw error;
  }
  return {
    member: false,
    membership: null,
    roles: [],
    isOwner,
    permissions: [],
    highestPosition: isOwner ? Number.POSITIVE_INFINITY : 0,
  };
}

export async function requireRoomMember(pb, room, userId) {
  const access = await getRoomAccess(pb, room, userId);
  if (!access.member)
    throw createError({
      statusCode: 403,
      statusMessage: "Access denied to this room",
    });
  return access;
}

export async function requireRoomPermission(pb, room, userId, permission) {
  const access = await requireRoomMember(pb, room, userId);
  if (!access.permissions.includes(permission))
    throw createError({
      statusCode: 403,
      statusMessage: `Missing room permission: ${permission}`,
    });
  return access;
}

export async function seedRoomRoles(pb, room, ownerId) {
  const roles = [];
  for (const template of DEFAULT_ROLE_TEMPLATES) {
    roles.push(
      await pb.collection("dspeak_room_roles").create({
        room: room.id,
        ...template,
        permissions: [...template.permissions],
      }),
    );
  }
  const ownerRole = roles.find((role) => role.system);
  await pb.collection("dspeak_room_memberships").create({
    room: room.id,
    user: ownerId,
    roles: ownerRole ? [ownerRole.id] : [],
    joined_at: new Date().toISOString(),
  });
  return roles;
}

export async function ensureRoomMembership(pb, room, userId) {
  const existing = await getBoundedList(
    pb,
    "dspeak_room_memberships",
    {
      filter: `room = '${room.id}' && user = '${userId}'`,
    },
    2,
  );
  if (existing.length) return existing[0];
  const roles = await getBoundedList(pb, "dspeak_room_roles", {
    filter: `room = '${room.id}' && is_default = true`,
  });
  return pb.collection("dspeak_room_memberships").create({
    room: room.id,
    user: userId,
    roles: roles.map((role) => role.id),
    joined_at: new Date().toISOString(),
  });
}

export async function removeRoomMembership(pb, roomId, userId) {
  const memberships = await getBoundedList(
    pb,
    "dspeak_room_memberships",
    {
      filter: `room = '${roomId}' && user = '${userId}'`,
    },
    2,
  );
  await Promise.all(
    memberships.map((membership) =>
      pb.collection("dspeak_room_memberships").delete(membership.id),
    ),
  );
}

export async function presentRoomAccess(pb, room, userId) {
  const access = await getRoomAccess(pb, room, userId);
  return {
    roles: access.roles.map((role) => ({
      id: role.id,
      name: role.name,
      color: role.color,
      position: role.position,
      permissions: normalizePermissions(role.permissions),
      system: Boolean(role.system),
      isDefault: Boolean(role.is_default),
    })),
    permissions: access.permissions,
    isOwner: access.isOwner,
  };
}

export async function requireRoleManagement(pb, room, userId, targetRole) {
  const access = await requireRoomPermission(
    pb,
    room,
    userId,
    "room.manage_roles",
  );
  if (targetRole && !canManageRole(access.roles, targetRole, access.isOwner))
    throw createError({
      statusCode: 403,
      statusMessage: "You cannot manage a role at or above your position",
    });
  return access;
}
