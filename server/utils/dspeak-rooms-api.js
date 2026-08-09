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
import { createDownloadUrl, deleteObject, putObject } from "../storage/r2.js";
import { enforceRateLimit } from "./rate-limit.js";

function requireValue(value, message) {
  if (!value) throw createError({ statusCode: 400, statusMessage: message });
  return value;
}

function sameInstant(left, right) {
  const leftTime = left instanceof Date ? left.getTime() : Date.parse(left);
  const rightTime = Date.parse(right);
  return Number.isFinite(leftTime) && leftTime === rightTime;
}

function inviteMatchesPayload(invite, payload) {
  return (
    String(invite.id) === String(payload.id) &&
    String(invite.roomId) === String(payload.roomId) &&
    String(invite.inviterId) === String(payload.createdBy) &&
    sameInstant(invite.createdAt, payload.createdAt) &&
    sameInstant(invite.expiresAt, payload.expiresAt)
  );
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

async function parseBody(event) {
  const contentType = getHeader(event, "content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await readFormData(event);
    return Object.fromEntries(form.entries());
  }
  return (await readBody(event)) || {};
}

async function validateRoomImage(file, limit, label) {
  if (!(file instanceof File) || !file.size) return;
  if (file.size > limit)
    throw createError({
      statusCode: 413,
      statusMessage: `${label} exceeds the upload limit`,
    });
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw createError({
      statusCode: 415,
      statusMessage: `${label} must be JPEG, PNG, or WebP`,
    });
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const png = bytes.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10";
  const webp =
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (!(jpeg || png || webp))
    throw createError({
      statusCode: 415,
      statusMessage: `${label} is invalid`,
    });
}

async function replaceRoomImage(roomId, type, file) {
  if (!(file instanceof File) || !file.size) return;
  const limit = type === "header" ? 5 * 1024 * 1024 : 2 * 1024 * 1024;
  const label = type === "header" ? "Room header" : "Room picture";
  await validateRoomImage(file, limit, label);
  const previous = await db
    .select({ r2Key: roomImages.r2Key })
    .from(roomImages)
    .where(and(eq(roomImages.roomId, roomId), eq(roomImages.type, type)));
  const keyType = type === "header" ? "headers" : "profile";
  const r2Key = `rooms/${roomId}/${keyType}/${crypto.randomUUID()}`;
  await putObject(r2Key, file, file.type, file.size);
  try {
    await db.transaction(async (tx) => {
      await tx
        .delete(roomImages)
        .where(and(eq(roomImages.roomId, roomId), eq(roomImages.type, type)));
      await tx.insert(roomImages).values({
        roomId,
        type,
        r2Key,
        mimeType: file.type,
        size: file.size,
      });
    });
  } catch (error) {
    await deleteObject(r2Key).catch(() => {});
    throw error;
  }
  await Promise.all(
    previous
      .map((image) => image.r2Key)
      .filter((key) => key && key !== r2Key)
      .map((key) => deleteObject(key).catch(() => {})),
  );
}

function presentProfile(profile) {
  if (!profile) return null;
  return {
    id: String(profile.id),
    name: publicDisplayName(profile),
    display_name: profile.displayName || "",
    username: profile.username || "",
    handle: profile.username || profile.handle || "",
    online: false,
    avatar: sameOriginAvatarPath(profile),
  };
}

function presentChannel(channel, roomId) {
  const isMedia = ["voice", "stage"].includes(channel.type);
  return {
    id: channel.id,
    name: channel.name,
    desc: channel.description || "",
    isMedia,
    mediaPolicy: normalizeMediaPolicy(channel.mediaPolicy),
    inRoom: [],
    created: channel.createdAt?.toISOString?.() || channel.createdAt,
    updated: channel.updatedAt?.toISOString?.() || channel.updatedAt,
    owner: null,
    room: String(roomId),
    policy: channel.policy || "free",
    slow_mode: channel.slowMode || 0,
  };
}

async function roomDetails(room, userId = null) {
  const [roomChannels, memberships, imageRows] = await Promise.all([
    db
      .select()
      .from(channels)
      .where(eq(channels.roomId, room.id))
      .orderBy(asc(channels.position)),
    db
      .select({
        id: roomMemberships.id,
        userId: roomMemberships.userId,
        joinedAt: roomMemberships.joinedAt,
        roleId: membershipRoles.roleId,
        roleName: roomRoles.name,
        roleColor: roomRoles.color,
        rolePosition: roomRoles.position,
        roleSystem: roomRoles.system,
        roleIsDefault: roomRoles.isDefault,
      })
      .from(roomMemberships)
      .leftJoin(
        membershipRoles,
        eq(membershipRoles.membershipId, roomMemberships.id),
      )
      .leftJoin(roomRoles, eq(roomRoles.id, membershipRoles.roleId))
      .where(eq(roomMemberships.roomId, room.id)),
    db.select().from(roomImages).where(eq(roomImages.roomId, room.id)),
  ]);

  const memberIds = [
    ...new Set(memberships.map((m) => String(m.userId))),
  ].filter(Boolean);
  let memberProfiles = [];
  if (memberIds.length) {
    memberProfiles = await db
      .select()
      .from(profiles)
      .where(inArray(profiles.id, memberIds));
  }
  const profileById = new Map(memberProfiles.map((p) => [String(p.id), p]));
  const imageByType = new Map(imageRows.map((image) => [image.type, image]));

  const roles = memberships
    .map((m) => ({
      membershipId: String(m.id),
      userId: String(m.userId),
      roleId: m.roleId ? String(m.roleId) : null,
      name: m.roleName || "",
      color: m.roleColor || "",
      position: m.rolePosition || 0,
      system: Boolean(m.roleSystem),
      isDefault: Boolean(m.roleIsDefault),
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
    picture: imageByType.has("profile")
      ? `/api/room/profile?id=${encodeURIComponent(room.id)}`
      : null,
    headerImage: imageByType.has("header")
      ? `/api/room/header?id=${encodeURIComponent(room.id)}`
      : null,
    accent: normalizeRoomAccent(room.accent),
    attenuation: normalizeAttenuation(room.attenuation),
    owner: presentProfile(profileById.get(String(room.ownerId))),
    members: memberships
      .map((m) => {
        const profile = profileById.get(String(m.userId));
        if (!profile) return null;
        const memberRoles = roles
          .filter((r) => String(r.userId) === String(m.userId))
          .map((r) => ({
            id: r.roleId,
            name: r.name,
            color: r.color,
            position: r.position,
            system: Boolean(r.system),
            isDefault: Boolean(r.isDefault),
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
  const body = method === "GET" ? {} : await parseBody(event);
  const room = await getRoomById(roomId);
  if (!room)
    throw createError({ statusCode: 404, statusMessage: "Room not found" });

  if (method === "GET") {
    await requireRoomMember(room, userId);
    const roleRows = await db
      .select()
      .from(roomRoles)
      .where(eq(roomRoles.roomId, roomId))
      .orderBy(desc(roomRoles.position));
    const membershipRows = await db
      .select({
        id: roomMemberships.id,
        userId: roomMemberships.userId,
        roleId: membershipRoles.roleId,
      })
      .from(roomMemberships)
      .leftJoin(
        membershipRoles,
        eq(membershipRoles.membershipId, roomMemberships.id),
      )
      .where(eq(roomMemberships.roomId, roomId));
    const membershipById = new Map();
    for (const row of membershipRows) {
      const key = String(row.id);
      const membership = membershipById.get(key) || {
        id: row.id,
        userId: row.userId,
        roles: [],
      };
      if (row.roleId) membership.roles.push(String(row.roleId));
      membershipById.set(key, membership);
    }
    return { roles: roleRows, memberships: [...membershipById.values()] };
  }

  if (method === "POST" && body.action === "assign") {
    await requireRoleManagement(room, userId, null);
    const membershipId = requireValue(
      body.membershipId,
      "Membership ID is required",
    );
    const membership = await db
      .select({ id: roomMemberships.id })
      .from(roomMemberships)
      .where(
        and(
          eq(roomMemberships.id, membershipId),
          eq(roomMemberships.roomId, room.id),
        ),
      )
      .limit(1);
    if (!membership[0])
      throw createError({
        statusCode: 400,
        statusMessage: "Membership must belong to this room",
      });
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
    await db.transaction(async (tx) => {
      await tx
        .delete(membershipRoles)
        .where(eq(membershipRoles.membershipId, membershipId));
      await tx
        .insert(membershipRoles)
        .values(roleIds.map((roleId) => ({ membershipId, roleId })));
    });
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
    .where(and(eq(roomRoles.id, roleId), eq(roomRoles.roomId, room.id)))
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

  if (suffix === "invites" && method === "GET") {
    enforceRateLimit(event, "room-invite-preview", null, 60, 60 * 1000);
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
    if (!invite[0] || !inviteMatchesPayload(invite[0], payload))
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
    if (!room)
      throw createError({
        statusCode: 400,
        statusMessage: "Invalid invite link",
      });
    const inviter = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, invite[0].inviterId))
      .limit(1);
    return {
      room: { id: invite[0].roomId, name: room.name || "" },
      invitedBy: presentProfile(inviter[0]),
      createdAt: invite[0].createdAt,
      expiresAt: invite[0].expiresAt,
    };
  }

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

  const body = method === "GET" ? {} : await parseBody(event);

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
      details: structuredValue(r.metadata),
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
    const name = String(body.name || "").trim();
    requireValue(name, "Name is required for creating new room.");
    const created = await db.transaction(async (tx) => {
      const room = await tx
        .insert(rooms)
        .values({
          name,
          description: body.desc || "",
          ownerId: userId,
        })
        .returning();
      const nextRoom = room[0];
      await seedRoomRoles(nextRoom, userId, tx);
      await tx.insert(channels).values([
        {
          roomId: nextRoom.id,
          name: "general",
          description: "",
          type: "text",
          position: 0,
        },
        {
          roomId: nextRoom.id,
          name: "voice",
          description: "",
          type: "voice",
          position: 1,
        },
      ]);
      return nextRoom;
    });
    setResponseStatus(event, 201);
    return roomDetails(created, userId);
  }

  if (!suffix && method === "PUT") {
    const room = await getRoomById(
      requireValue(body.roomId, "Room ID is required to edit a room."),
    );
    if (!room)
      throw createError({ statusCode: 404, statusMessage: "Room not found" });
    const hasPicture = body.picture instanceof File && body.picture.size;
    const hasHeaderImage =
      body.headerImage instanceof File && body.headerImage.size;
    if (body.name || body.desc !== undefined || hasPicture || hasHeaderImage)
      await requireRoomPermission(room, userId, "room.update_identity");
    if (body.accent !== undefined || body.attenuation !== undefined)
      await requireRoomPermission(room, userId, "room.update_theme");
    const update = {};
    if (body.name) update.name = body.name;
    if (body.desc !== undefined) update.description = body.desc;
    if (body.accent !== undefined)
      update.accent = normalizeRoomAccent(body.accent);
    if (body.attenuation !== undefined)
      update.attenuation = normalizeAttenuation(
        structuredValue(body.attenuation),
      );
    if (Object.keys(update).length) {
      update.updatedAt = new Date();
      await db.update(rooms).set(update).where(eq(rooms.id, room.id));
    }
    await replaceRoomImage(room.id, "profile", body.picture);
    await replaceRoomImage(room.id, "header", body.headerImage);
    const data = {
      id: room.id,
      accent: normalizeRoomAccent(update.accent ?? room.accent),
    };
    data.attenuation = normalizeAttenuation(
      update.attenuation ?? room.attenuation,
    );
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
          !inviteMatchesPayload(invite[0], payload) ||
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
