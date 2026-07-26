export const ROOM_PERMISSIONS = Object.freeze([
  "room.update_identity",
  "room.update_theme",
  "room.manage_invites",
  "room.manage_members",
  "room.manage_roles",
  "room.manage_soundboard",
  "channel.create",
  "channel.update",
  "channel.delete",
  "channel.manage_media_policy",
  "channel.moderate_voice",
  "message.moderate",
]);

export const ROOM_ACCENTS = Object.freeze([
  "cobalt",
  "cyan",
  "violet",
  "magenta",
  "orange",
  "lime",
]);

export function canAccessRoomAdministration(room) {
  return Boolean(
    room?.isOwner ||
    (room?.permissions || []).some(
      (permission) =>
        String(permission).startsWith("room.") ||
        String(permission).startsWith("channel."),
    ),
  );
}

export const DEFAULT_ROOM_ACCENT = "cobalt";

export const ROOM_ACCENT_LIGHT_COLORS = Object.freeze({
  cobalt: "#075cff",
  cyan: "#00827f",
  violet: "#7b2cff",
  magenta: "#d80073",
  orange: "#9c6800",
  lime: "#4b8212",
});

export const DEFAULT_ROLE_TEMPLATES = Object.freeze([
  {
    name: "Owner",
    color: "cobalt",
    position: 1000,
    permissions: ROOM_PERMISSIONS,
    system: true,
    is_default: false,
  },
  {
    name: "Admin",
    color: "violet",
    position: 750,
    permissions: ROOM_PERMISSIONS,
    system: false,
    is_default: false,
  },
  {
    name: "Moderator",
    color: "cyan",
    position: 500,
    permissions: [
      "room.manage_invites",
      "room.manage_members",
      "message.moderate",
    ],
    system: false,
    is_default: false,
  },
  {
    name: "Member",
    color: "lime",
    position: 100,
    permissions: [],
    system: false,
    is_default: true,
  },
]);

export function normalizePermissions(value) {
  const permissions = Array.isArray(value) ? value : [];
  return [
    ...new Set(permissions.filter((item) => ROOM_PERMISSIONS.includes(item))),
  ];
}

export function getEffectivePermissions(roles, isOwner = false) {
  if (isOwner) return [...ROOM_PERMISSIONS];
  return normalizePermissions(
    (Array.isArray(roles) ? roles : []).flatMap(
      (role) => role.permissions || [],
    ),
  );
}

export function getHighestRolePosition(roles, isOwner = false) {
  if (isOwner) return Number.POSITIVE_INFINITY;
  return Math.max(
    0,
    ...(Array.isArray(roles) ? roles : []).map(
      (role) => Number(role.position) || 0,
    ),
  );
}

export function canManageRole(actorRoles, targetRole, isOwner = false) {
  if (isOwner) return !targetRole?.system;
  const permissions = getEffectivePermissions(actorRoles);
  return (
    permissions.includes("room.manage_roles") &&
    !targetRole?.system &&
    getHighestRolePosition(actorRoles) > (Number(targetRole?.position) || 0)
  );
}

export function canManageMember(actorRoles, targetRoles, isOwner = false) {
  if ((targetRoles || []).some((role) => role.system)) return false;
  if (
    !isOwner &&
    !getEffectivePermissions(actorRoles).includes("room.manage_members")
  )
    return false;
  return (
    isOwner ||
    getHighestRolePosition(actorRoles) > getHighestRolePosition(targetRoles)
  );
}

export function canModerateVoiceMember(
  actorRoles,
  targetRoles,
  isOwner = false,
) {
  if ((targetRoles || []).some((role) => role.system)) return false;
  if (
    !isOwner &&
    !getEffectivePermissions(actorRoles).includes("channel.moderate_voice")
  )
    return false;
  return (
    isOwner ||
    getHighestRolePosition(actorRoles) > getHighestRolePosition(targetRoles)
  );
}

export function normalizeRoomAccent(value) {
  return ROOM_ACCENTS.includes(value) ? value : DEFAULT_ROOM_ACCENT;
}

export function normalizeAttenuation(value = {}) {
  value = value && typeof value === "object" ? value : {};
  return {
    enabled: value.enabled !== false,
    reductionPercent: boundedNumber(value.reductionPercent, 65, 0, 100),
    sensitivity: ["relaxed", "standard", "responsive"].includes(
      value.sensitivity,
    )
      ? value.sensitivity
      : "standard",
    attackMs: boundedNumber(value.attackMs, 120, 20, 2000),
    releaseMs: boundedNumber(value.releaseMs, 650, 50, 5000),
  };
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max
    ? Math.round(number)
    : fallback;
}
