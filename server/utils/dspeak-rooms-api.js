import { db } from "../db/client.js";
import {
  rooms,
  channels,
  roomRoles,
  roomMemberships,
  membershipRoles,
  roomInvites,
  roomAuditLog,
  roomImages,
  profiles,
} from "../db/schema/index.js";
import { eq, and, inArray, asc, desc } from "drizzle-orm";
import {
  normalizeAttenuation,
  normalizeRoomAccent,
} from "../../shared/room-policy.js";
import {
  ensureRoomMembership,
  removeRoomMembership,
  requireRoleManagement,
  requireRoomMember,
  requireRoomPermission,
  seedRoomRoles,
  getRoomAccess,
} from "./room-authorization.js";
import { getRoomById } from "./room-authorization.js";
import { requireAuthenticatedUser } from "./auth.js";
import { broadcastToChannel, broadcastGlobally } from "./dspeak-realtime.js";
import { disconnectVoiceParticipant } from "./media-control-admin.js";
import { normalizeMediaPolicy } from "../../shared/media-policy.js";
import {
  encodeInvitePayload,
  decodeInvitePayload,
  validateInviteExpiry,
} from "../../shared/room-invite.js";
import { sameOriginAvatarPath } from "../../shared/avatar-path.js";
import { publicDisplayName } from "../../shared/user-profile.js";
import { createDownloadUrl } from "../storage/r2.js";
import { enforceRateLimit } from "./rate-limit.js";

function requireValue(value, message) {
  if (!value) throw createError({ statusCode: 400, statusMessage: message });
  return value;
}

function structuredValue(value, fallback = {}) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function presentProfile(profile) {
  if (!profile) return null;
  return {
    id: String(profile.id),
    name: publicDisplayName(profile),
    display_name: profile.displayName || "",
    username: profile.username || "",
    handle: profile.handle || "",
    online: false,
    avatar: sameOriginAvatarPath(profile),
  };
}

function presentChannel(channel, roomId) {
  const isMedia = ["voice", "stage"].includes(channel.type);
  return {
    id: channel.id,
    name: channel.name,
    desc: "",
    isMedia,
    mediaPolicy: normalizeMediaPolicy(),
    inRoom: [],
    created: channel.createdAt?.toISOString?.() || channel.createdAt,
    updated: channel.updatedAt?.toISOString?.() || channel.updatedAt,
    owner: null,
    room: String(roomId),
    policy: "free",
    slow_mode: 0,
  };
}

async function roomDetails(room, userId = null) {
  const roomChannels = await db
    .select()
    .from(channels)
    .where(eq(channels.roomId, room.id))
    .orderBy(asc(channels.position));
  const memberships = await db
    .select({
      id: roomMemberships.id,
      userId: roomMemberships.userId,
      joinedAt: roomMemberships.joinedAt,
      roleId: membershipRoles.roleId,
    })
    .from(roomMemberships)
    .leftJoin(
      membershipRoles,
      eq(membershipRoles.membershipId, roomMemberships.id),
    )
    .where(eq(roomMemberships.roomId, room.id));

  const memberIds = [
    ...new Set(memberships.map((m) => String(m.userId))).filter(Boolean),
  ];
  let memberProfiles = [];
  if (memberIds.length) {
    memberProfiles = await db
      .select()
      .from(profiles)
      .where(inArray(profiles.id, memberIds));
  }
  const profileById = new Map(memberProfiles.map((p) => [String(p.id), p]));

  const roles = memberships
    .map((m) => ({
      membershipId: String(m.id),
      userId: String(m.userId),
      roleId: m.roleId ? String(m.roleId) : null,
      joined_at: m.joinedAt,
    }))
    .filter((m) => m.roleId);

  const access = userId ? await getRoomAccess(room, userId) : null;

  const roleMemberships = await db
    .select({
      roleId: roomRoles.id,
      name: roomRoles.name,
      color: roomRoles.color,
      position: roomRoles.position,
      permissions: roomRoles.permissions,
    })
    .from(roomRoles)
    .where(eq(roomRoles.roomId, room.id))
    .orderBy(asc(roomRoles.position));

  return {
    id: String(room.id),
    name: room.name,
    desc: room.description || "",
    created: room.createdAt?.toISOString?.() || room.createdAt,
    updated: room.updatedAt?.toISOString?.() || room.updatedAt,
    picture: null,
    headerImage: null,
    accent: normalizeRoomAccent(undefined),
    attenuation: normalizeAttenuation(undefined),
    owner: presentProfile(undefined),
    members: memberships
      .map((m) => {
        const profile = profileById.get(String(m.userId));
        if (!profile) return null;
        const memberRoles = roles
          .filter((r) => String(r.userId) === String(m.userId))
          .map((r) => ({
            id: r.roleId,
            name: "",
            color: "",
            position: 0,
            system: false,
            isDefault: false,
          }));
        return { ...presentProfile(profile), roles: memberRoles };
      })
      .filter(Boolean),
    channels: roomChannels.map((c) => presentChannel(c, room.id)),
    roles: access?.roles || roleMemberships,
    permissions: access?.permissions || [],
    isOwner: access?.isOwner || false,
  };
}

async function handleRoomRoles(event, roomId, userId) {
  const method = event.method;
  const body = method === "GET" ? {} : (await readBody(event)) || {};
  const room = await getRoomById(roomId);
  if (!room)
    throw createError({ statusCode: 404, statusMessage: "Room not found" });

  if (method === "GET") {
    const roleRows = await db
      .select()
      .from(roomRoles)
      .where(eq(roomRoles.roomId, roomId))
      .orderBy(desc(roomRoles.position));
    return { roles: roleRows, memberships: [] };
  }

  if (method === "POST" && body.action === "assign") {
    await requireRoleManagement(room, userId, null);
    const membershipId = body.membershipId;
    const roleIds = [
      ...new Set((Array.isArray(body.roleIds) ? body.roleIds : []).map(String)),
    ];
    if (!roleIds.length)
      throw createError({
        statusCode: 400,
        statusMessage: "A room member must have at least one role",
      });
    const roomRolesForRoom = await db
      .select({ id: roomRoles.id })
      .from(roomRoles)
      .where(and(eq(roomRoles.roomId, roomId), inArray(roomRoles.id, roleIds)));
    const validIds = new Set(roomRolesForRoom.map((r) => String(r.id)));
    const invalid = roleIds.filter((id) => !validIds.has(id));
    if (invalid.length)
      throw createError({
        statusCode: 400,
        statusMessage: "Assigned roles must belong to this room",
      });
    await db
      .delete(membershipRoles)
      .where(eq(membershipRoles.membershipId, membershipId));
    if (roleIds.length)
      await db
        .insert(membershipRoles)
        .values(roleIds.map((roleId) => ({ membershipId, roleId })));
    return { success: true };
  }

  if (method === "POST") {
    const access = await requireRoleManagement(room, userId, null);
    const position = Math.max(1, Math.floor(Number(body.position) || 1));
    if (!access.isOwner && position >= access.highestPosition)
      throw createError({
        statusCode: 403,
        statusMessage: "New roles must be below your highest role",
      });
    const result = await db
      .insert(roomRoles)
      .values({
        roomId,
        name: requireValue(body.name, "Role name is required"),
        color: normalizeRoomAccent(body.color),
        position,
        permissions: Array.isArray(body.permissions) ? body.permissions : [],
      })
      .returning();
    setResponseStatus(event, 201);
    return result[0];
  }

  const roleId = requireValue(body.roleId, "Role ID is required");
  const role = await db
    .select()
    .from(roomRoles)
    .where(eq(roomRoles.id, roleId))
    .limit(1);
  if (!role[0])
    throw createError({ statusCode: 404, statusMessage: "Role not found" });
  await requireRoleManagement(room, userId, role[0]);

  if (method === "PUT") {
    const position = Math.max(
      1,
      Math.floor(Number(body.position) || role[0].position),
    );
    const result = await db
      .update(roomRoles)
      .set({
        name: body.name || role[0].name,
        color: normalizeRoomAccent(body.color || role[0].color || undefined),
        position,
        permissions:
          body.permissions === undefined
            ? role[0].permissions
            : body.permissions,
      })
      .where(eq(roomRoles.id, roleId))
      .returning();
    return result[0];
  }

  if (method === "DELETE") {
    await db.delete(roomRoles).where(eq(roomRoles.id, roleId));
    return { success: true };
  }

  throw createError({ statusCode: 405, statusMessage: "Method not allowed" });
}

async function handleRooms(event, suffix) {
  const method = event.method;
  const query = getQuery(event);
  const userId = await requireAuthenticatedUser(event);

  if (suffix === "roles")
    return handleRoomRoles(event, query.roomId || query.id, userId);

  if (suffix === "profile" || suffix === "header") {
    const id = requireValue(query.id, "Room ID is required");
    const room = await getRoomById(id);
    if (!room)
      throw createError({ statusCode: 404, statusMessage: "Room not found" });
    await requireAuthenticatedUser(event);
    await requireRoomMember(room, userId);
    const type = suffix === "header" ? "header" : "profile";
    const row = await db
      .select()
      .from(roomImages)
      .where(and(eq(roomImages.roomId, id), eq(roomImages.type, type)))
      .orderBy(desc(roomImages.createdAt))
      .limit(1);
    const image = row[0];
    if (!image)
      throw createError({ statusCode: 404, statusMessage: "Image not found" });
    const url = await createDownloadUrl(image.r2Key);
    setHeader(event, "Cache-Control", "private, max-age=604800");
    setHeader(event, "X-Content-Type-Options", "nosniff");
    return sendRedirect(event, url, 302);
  }

  if (suffix === "details" && method === "GET") {
    const room = await getRoomById(
      requireValue(query.id, "Room ID is required"),
    );
    if (!room)
      throw createError({ statusCode: 404, statusMessage: "Room not found" });
    await requireRoomMember(room, userId);
    return roomDetails(room, userId);
  }

  if (suffix === "invites" && method === "GET") {
    const payload = decodeInvitePayload(String(query.token || ""));
    if (!payload)
      throw createError({
        statusCode: 400,
        statusMessage: "Invalid invite link",
      });
    const invite = await db
      .select()
      .from(roomInvites)
      .where(eq(roomInvites.id, payload.id))
      .limit(1);
    if (!invite[0])
      throw createError({
        statusCode: 400,
        statusMessage: "Invalid invite link",
      });
    if (Date.parse(invite[0].expiresAt) <= Date.now())
      throw createError({
        statusCode: 410,
        statusMessage: "This invite link has expired",
      });
    const room = await getRoomById(invite[0].roomId);
    return {
      room: { id: invite[0].roomId, name: room?.name || "" },
      invitedBy: presentProfile(undefined),
      createdAt: invite[0].createdAt,
      expiresAt: invite[0].expiresAt,
    };
  }

  if (!["GET", "HEAD"].includes(method))
    enforceRateLimit(event, "room-mutation", userId, 60, 60 * 1000);

  if (!suffix && method === "GET") {
    const rows = await db
      .select({ roomId: roomMemberships.roomId })
      .from(roomMemberships)
      .where(eq(roomMemberships.userId, userId));
    const ids = [...new Set(rows.map((r) => String(r.roomId)))];
    if (!ids.length) return [];
    const myRooms = await db.select().from(rooms).where(inArray(rooms.id, ids));
    return Promise.all(myRooms.map((room) => roomDetails(room, userId)));
  }

  const body = method === "GET" ? {} : (await readBody(event)) || {};

  if (suffix === "invites" && method === "POST") {
    const room = await getRoomById(
      requireValue(body.roomId, "Room ID is required"),
    );
    if (!room)
      throw createError({ statusCode: 404, statusMessage: "Room not found" });
    await requireRoomPermission(room, userId, "room.manage_invites");
    const expirySeconds = validateInviteExpiry(body.expirySeconds);
    if (!expirySeconds)
      throw createError({
        statusCode: 400,
        statusMessage: "Invalid invite expiry",
      });
    const createdAt = new Date();
    const expiresAt = new Date(Date.now() + expirySeconds * 1000);
    const invite = await db
      .insert(roomInvites)
      .values({
        roomId: room.id,
        inviterId: userId,
        code: crypto.randomUUID(),
        createdAt,
        expiresAt,
      })
      .returning();
    const payload = {
      id: invite[0].id,
      createdBy: String(userId),
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      roomId: String(room.id),
    };
    await db.insert(roomAuditLog).values({
      roomId: room.id,
      actorId: userId,
      action: "invite.created",
      metadata: JSON.stringify({ expiresAt }),
    });
    setResponseStatus(event, 201);
    return { token: encodeInvitePayload(payload), ...payload };
  }

  if (suffix === "audit" && method === "GET") {
    const room = await getRoomById(
      requireValue(query.roomId, "Room ID is required"),
    );
    if (!room)
      throw createError({ statusCode: 404, statusMessage: "Room not found" });
    const access = await requireRoomMember(room, userId);
    if (
      !access.isOwner &&
      !access.permissions.some((p) =>
        ["room.manage_invites", "room.manage_members"].includes(p),
      )
    )
      throw createError({
        statusCode: 403,
        statusMessage: "Missing permission to view the audit log",
      });
    const rows = await db
      .select()
      .from(roomAuditLog)
      .where(eq(roomAuditLog.roomId, room.id))
      .orderBy(desc(roomAuditLog.createdAt))
      .limit(100);
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      occurredAt: r.createdAt,
      details: r.metadata ? JSON.parse(r.metadata) : {},
      actor: null,
      subject: null,
    }));
  }

  if (suffix === "kick" && method === "POST") {
    const room = await getRoomById(
      requireValue(body.roomId, "Room ID is required."),
    );
    if (!room)
      throw createError({ statusCode: 404, statusMessage: "Room not found" });
    const targetUserId = String(
      requireValue(body.targetUserId, "Target user ID is required."),
    );
    if (targetUserId === String(userId))
      throw createError({
        statusCode: 400,
        statusMessage: "You cannot kick yourself.",
      });
    if (targetUserId === String(room.ownerId))
      throw createError({
        statusCode: 403,
        statusMessage: "The room owner cannot be kicked.",
      });
    await requireRoomPermission(room, userId, "room.manage_members");
    const membership = await db
      .select()
      .from(roomMemberships)
      .where(
        and(
          eq(roomMemberships.roomId, room.id),
          eq(roomMemberships.userId, targetUserId),
        ),
      )
      .limit(1);
    if (!membership[0])
      throw createError({
        statusCode: 404,
        statusMessage: "This user is not a room member.",
      });
    const roomChannels = await db
      .select()
      .from(channels)
      .where(eq(channels.roomId, room.id));
    await Promise.all(
      roomChannels
        .filter((c) => c.type === "voice" || c.type === "stage")
        .map((c) => disconnectVoiceParticipant(c.id, targetUserId)),
    );
    await removeRoomMembership(room.id, targetUserId);
    for (const c of roomChannels)
      broadcastToChannel(c.id, { type: "participant_change" });
    return { message: "Member kicked successfully." };
  }

  if (!suffix && method === "POST") {
    requireValue(body.name, "Name is required for creating new room.");
    const room = await db
      .insert(rooms)
      .values({
        name: body.name,
        description: body.desc || "",
        ownerId: userId,
      })
      .returning();
    const created = room[0];
    await seedRoomRoles(created, userId);
    const general = await db
      .insert(channels)
      .values({
        roomId: created.id,
        name: "general",
        type: "text",
        position: 0,
      })
      .returning();
    await db.insert(channels).values({
      roomId: created.id,
      name: "voice",
      type: "voice",
      position: 1,
    });
    await db.insert(roomMemberships).values({ roomId: created.id, userId });
    setResponseStatus(event, 201);
    return roomDetails(created, userId);
  }

  if (!suffix && method === "PUT") {
    const room = await getRoomById(
      requireValue(body.roomId, "Room ID is required to edit a room."),
    );
    if (!room)
      throw createError({ statusCode: 404, statusMessage: "Room not found" });
    if (body.name || body.desc !== undefined)
      await requireRoomPermission(room, userId, "room.update_identity");
    const update = {};
    if (body.name) update.name = body.name;
    if (body.desc !== undefined) update.description = body.desc;
    if (Object.keys(update).length) {
      await db.update(rooms).set(update).where(eq(rooms.id, room.id));
    }
    const data = { id: room.id, accent: normalizeRoomAccent(body.accent) };
    data.attenuation = normalizeAttenuation(structuredValue(body.attenuation));
    broadcastGlobally({ type: "room_updated", data });
    return roomDetails({ ...room, ...update }, userId);
  }

  if (!suffix && method === "DELETE") {
    const room = await getRoomById(
      requireValue(body.roomId, "Room ID is required to delete a room."),
    );
    if (!room)
      throw createError({ statusCode: 404, statusMessage: "Room not found" });
    if (String(room.ownerId) !== String(userId))
      throw createError({
        statusCode: 403,
        statusMessage: "Only the owner can delete this room.",
      });
    const roomChannels = await db
      .select()
      .from(channels)
      .where(eq(channels.roomId, room.id));
    for (const c of roomChannels)
      await db.delete(channels).where(eq(channels.id, c.id));
    await db.delete(rooms).where(eq(rooms.id, room.id));
    return { message: "Room deleted successfully." };
  }

  if ((suffix === "join" || suffix === "leave") && method === "POST") {
    const room = await getRoomById(
      requireValue(body.roomId, `Room ID is required to ${suffix} a room.`),
    );
    if (!room)
      throw createError({ statusCode: 404, statusMessage: "Room not found" });
    const existing = await db
      .select({ id: roomMemberships.id })
      .from(roomMemberships)
      .where(
        and(
          eq(roomMemberships.roomId, room.id),
          eq(roomMemberships.userId, userId),
        ),
      )
      .limit(1);
    if (suffix === "join") {
      let joinedInvite = null;
      const payload = decodeInvitePayload(String(body.inviteToken || ""));
      if (!existing.length) {
        if (!payload || String(payload.roomId) !== String(room.id))
          throw createError({
            statusCode: 403,
            statusMessage: "A valid invite link is required",
          });
        const invite = await db
          .select()
          .from(roomInvites)
          .where(eq(roomInvites.id, payload.id))
          .limit(1);
        if (
          !invite[0] ||
          String(invite[0].roomId) !== String(room.id) ||
          String(invite[0].inviterId) !== String(payload.createdBy) ||
          Date.parse(invite[0].expiresAt) <= Date.now()
        )
          throw createError({
            statusCode: 403,
            statusMessage: "Invalid invite link",
          });
        joinedInvite = invite[0];
      }
      await ensureRoomMembership(room, userId);
      if (joinedInvite)
        await db.insert(roomAuditLog).values({
          roomId: room.id,
          actorId: joinedInvite.inviterId,
          action: "member.joined_via_invite",
        });
    } else {
      if (String(room.ownerId) === String(userId))
        throw createError({
          statusCode: 400,
          statusMessage: "Transfer ownership before leaving this room",
        });
      await removeRoomMembership(room.id, userId);
    }
    const roomChannels = await db
      .select()
      .from(channels)
      .where(eq(channels.roomId, room.id));
    for (const c of roomChannels)
      broadcastToChannel(c.id, { type: "participant_change" });
    return {
      message: `Successfully ${suffix === "join" ? "joined" : "left"} the room.`,
    };
  }

  throw createError({
    statusCode: 404,
    statusMessage: "Room endpoint not found",
  });
}

export function createRoomsApiHandler(dependencies) {
  return handleRooms;
}
