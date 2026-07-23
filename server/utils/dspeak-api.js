import { createIceServers } from "../const/ice-servers";
import {
  normalizeMediaPolicy,
  validateMediaPolicy,
} from "../../shared/media-policy.js";
import {
  canManageMember,
  canModerateVoiceMember,
  normalizeAttenuation,
  normalizePermissions,
  normalizeRoomAccent,
} from "../../shared/room-policy.js";
import {
  normalizeDisplayName,
  normalizeHandle,
  normalizeNickname,
  publicDisplayName,
} from "../../shared/user-profile.js";
import {
  broadcastGlobally,
  broadcastToChannel,
  broadcastToUser,
} from "./dspeak-realtime";
import { persistMessageNotifications, sendPushTest } from "./push-delivery";
import {
  createAuthenticatedSession,
  requireAuthenticatedUser,
  restoreAuthenticatedSession,
  revokeAuthenticatedSession,
} from "./authentication";
import {
  disconnectVoiceParticipant,
  isActiveVoiceParticipant,
  moderateVoiceParticipant,
  updateActiveUserProfile,
} from "./mediasoup-sfu";
import { pocketBaseError, usePocketBaseAdmin } from "./pocketbase";
import {
  ensureRoomMembership,
  presentRoomAccess,
  removeRoomMembership,
  requireRoleManagement,
  requireRoomMember,
  requireRoomPermission,
  seedRoomRoles,
} from "./room-authorization";
import { handleSoundboardApi } from "./soundboard-api";
import {
  decodeInvitePayload,
  encodeInvitePayload,
  validateInviteExpiry,
} from "../../shared/room-invite.js";
import { enforceRateLimit } from "./rate-limit.js";
import {
  canDeleteMessage,
  canViewMessageHistory,
  isMessageOwner,
} from "../../shared/message-policy.js";

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

function sameInstant(left, right) {
  return (
    Number.isFinite(Date.parse(left)) && Date.parse(left) === Date.parse(right)
  );
}

async function validateRoomImage(file, limit, label) {
  if (!(file instanceof File) || !file.size) return;
  if (file.size > limit)
    throw createError({
      statusCode: 413,
      statusMessage: `${label} exceeds the upload limit`,
    });
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type))
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
  if (!jpeg && !png && !webp)
    throw createError({
      statusCode: 415,
      statusMessage: `${label} is invalid`,
    });
}

async function ensureMember(pb, room, userId) {
  return requireRoomMember(pb, room, userId);
}

function avatarPath(user, authPrefix = false) {
  if (!user?.id || !user?.avatar) return null;
  return `${authPrefix ? "auth/" : ""}assets/avatar?userId=${encodeURIComponent(user.id)}&fileName=${encodeURIComponent(user.avatar)}`;
}

function presentUser(user, authPrefix = false) {
  if (!user) return null;
  return { ...user, avatar: avatarPath(user, authPrefix) };
}

function presentPublicProfile(user) {
  const publicName = publicDisplayName(user);
  return {
    id: String(user.id),
    name: publicName,
    display_name: user.display_name || "",
    provider_name: user.name || "",
    username: user.username || "",
    handle: user.handle || "",
    avatar: avatarPath(user, true),
  };
}

function presentChannel(channel) {
  const mediaPolicy = normalizeMediaPolicy(
    channel.media_policy,
    channel.audio_bitrate,
  );
  return {
    id: channel.id,
    name: channel.name,
    desc: channel.desc,
    isMedia: channel.isMedia,
    audio_bitrate: channel.audio_bitrate,
    mediaPolicy,
    inRoom: channel.inRoom || [],
    created: channel.created,
    updated: channel.updated,
    owner: presentUser(channel.expand?.owner, true),
    room: channel.room,
  };
}

async function parseBody(event) {
  const type = getHeader(event, "content-type") || "";
  if (type.includes("multipart/form-data")) {
    const form = await readFormData(event);
    return Object.fromEntries(form.entries());
  }
  return (await readBody(event)) || {};
}

async function roomDetails(pb, room, userId = null) {
  const [channels, memberships] = await Promise.all([
    pb.collection("dspeak_rooms_channels").getFullList({
      filter: `room = '${room.id}'`,
      expand: "owner",
      sort: "created",
    }),
    pb.collection("dspeak_room_memberships").getFullList({
      filter: `room = '${room.id}'`,
      expand: "roles",
    }),
  ]);
  const access = userId ? await presentRoomAccess(pb, room, userId) : null;
  const rolesByUserId = new Map(
    memberships.map((membership) => [
      String(membership.user),
      (membership.expand?.roles || []).map((role) => ({
        id: role.id,
        name: role.name,
        color: role.color,
        position: role.position,
        system: Boolean(role.system),
        isDefault: Boolean(role.is_default),
      })),
    ]),
  );
  return {
    id: room.id,
    name: room.name,
    desc: room.desc,
    created: room.created,
    updated: room.updated,
    picture: room.picture ? `room/profile?id=${room.id}` : null,
    headerImage: room.header_image ? `room/header?id=${room.id}` : null,
    accent: normalizeRoomAccent(room.accent),
    attenuation: normalizeAttenuation(room.attenuation),
    owner: presentUser(room.expand?.owner),
    members: (room.expand?.members || []).map((member) => ({
      ...presentUser(member),
      roles: rolesByUserId.get(String(member.id)) || [],
    })),
    channels: channels.map(presentChannel),
    roles: access?.roles || [],
    permissions: access?.permissions || [],
    isOwner: access?.isOwner || false,
  };
}

async function broadcastParticipantChange(pb, roomId) {
  const channels = await pb
    .collection("dspeak_rooms_channels")
    .getFullList({ filter: `room = '${roomId}'` });
  for (const channel of channels)
    broadcastToChannel(channel.id, { type: "participant_change" });
}

async function handleRoomRoles(event, pb, userId) {
  const method = event.method;
  const body = method === "GET" ? {} : await parseBody(event);
  const roomId = requireValue(
    getQuery(event).roomId || body.roomId,
    "Room ID is required",
  );
  const room = await pb.collection("dspeak_rooms").getOne(roomId);
  await requireRoomMember(pb, room, userId);
  if (method === "GET") {
    const roles = await pb.collection("dspeak_room_roles").getFullList({
      filter: `room = '${roomId}'`,
      sort: "-position",
    });
    const memberships = await pb
      .collection("dspeak_room_memberships")
      .getFullList({ filter: `room = '${roomId}'`, expand: "user,roles" });
    return { roles, memberships };
  }
  if (method === "POST" && body.action === "assign") {
    await requireRoleManagement(pb, room, userId, null);
    const membership = await pb
      .collection("dspeak_room_memberships")
      .getOne(requireValue(body.membershipId, "Membership ID is required"), {
        expand: "roles",
      });
    if (String(membership.room) !== String(roomId))
      throw createError({
        statusCode: 400,
        statusMessage: "Membership must belong to this room",
      });
    for (const role of membership.expand?.roles || [])
      await requireRoleManagement(pb, room, userId, role);
    const roleIds = [
      ...new Set((Array.isArray(body.roleIds) ? body.roleIds : []).map(String)),
    ];
    if (!roleIds.length)
      throw createError({
        statusCode: 400,
        statusMessage: "A room member must have at least one role",
      });
    for (const roleId of roleIds) {
      const role = await pb.collection("dspeak_room_roles").getOne(roleId);
      if (String(role.room) !== String(roomId))
        throw createError({
          statusCode: 400,
          statusMessage: "Assigned roles must belong to this room",
        });
      await requireRoleManagement(pb, room, userId, role);
    }
    return pb
      .collection("dspeak_room_memberships")
      .update(membership.id, { roles: roleIds });
  }
  if (method === "POST") {
    const access = await requireRoleManagement(pb, room, userId, null);
    const position = Math.max(1, Math.floor(Number(body.position) || 1));
    if (!access.isOwner && position >= access.highestPosition)
      throw createError({
        statusCode: 403,
        statusMessage: "New roles must be below your highest role",
      });
    setResponseStatus(event, 201);
    return pb.collection("dspeak_room_roles").create({
      room: roomId,
      name: requireValue(body.name, "Role name is required"),
      color: normalizeRoomAccent(body.color),
      position,
      permissions: normalizePermissions(body.permissions),
      system: false,
      is_default: Boolean(body.isDefault),
    });
  }
  const role = await pb
    .collection("dspeak_room_roles")
    .getOne(requireValue(body.roleId, "Role ID is required"));
  const access = await requireRoleManagement(pb, room, userId, role);
  if (method === "PUT") {
    const position = Math.max(
      1,
      Math.floor(Number(body.position) || role.position),
    );
    if (!access.isOwner && position >= access.highestPosition)
      throw createError({
        statusCode: 403,
        statusMessage: "Roles must remain below your highest role",
      });
    return pb.collection("dspeak_room_roles").update(role.id, {
      name: body.name || role.name,
      color: normalizeRoomAccent(body.color || role.color),
      position,
      permissions:
        body.permissions === undefined
          ? role.permissions
          : normalizePermissions(body.permissions),
      is_default:
        body.isDefault === undefined
          ? role.is_default
          : Boolean(body.isDefault),
    });
  }
  if (method === "DELETE") {
    await pb.collection("dspeak_room_roles").delete(role.id);
    return { success: true };
  }
  throw createError({ statusCode: 405, statusMessage: "Method not allowed" });
}

async function handleRooms(event, suffix) {
  const pb = await usePocketBaseAdmin();
  const method = event.method;
  const query = getQuery(event);

  if (suffix === "roles")
    return handleRoomRoles(event, pb, await requireAuthenticatedUser(event));

  if ((suffix === "profile" || suffix === "header") && method === "GET") {
    const id = requireValue(query.id, "Room ID is required");
    const room = await pb.collection("dspeak_rooms").getOne(id);
    const field = suffix === "header" ? "header_image" : "picture";
    if (!room[field])
      throw createError({ statusCode: 404, statusMessage: "Image not found" });
    const response = await fetch(pb.files.getURL(room, room[field]));
    if (!response.ok)
      throw createError({
        statusCode: response.status,
        statusMessage: "Failed to fetch room image",
      });
    setHeader(event, "Cache-Control", "public, max-age=604800");
    setHeader(
      event,
      "Content-Type",
      response.headers.get("content-type") || "image/jpeg",
    );
    return sendWebResponse(event, response);
  }

  if (suffix === "details" && method === "GET") {
    const room = await pb
      .collection("dspeak_rooms")
      .getOne(requireValue(query.id, "Room ID is required"), {
        expand: "owner,members",
      });
    const userId = await requireAuthenticatedUser(event);
    await requireRoomMember(pb, room, userId);
    return roomDetails(pb, room, userId);
  }

  if (suffix === "invites" && method === "GET") {
    const payload = decodeInvitePayload(String(query.token || ""));
    if (!payload)
      throw createError({
        statusCode: 400,
        statusMessage: "Invalid invite link",
      });
    const invite = await pb
      .collection("dspeak_room_invites")
      .getOne(payload.id, { expand: "room,created_by" });
    if (
      String(invite.room) !== String(payload.roomId) ||
      String(invite.created_by) !== String(payload.createdBy) ||
      !sameInstant(invite.created_at, payload.createdAt) ||
      !sameInstant(invite.expires_at, payload.expiresAt)
    )
      throw createError({
        statusCode: 400,
        statusMessage: "Invalid invite link",
      });
    if (Date.parse(invite.expires_at) <= Date.now())
      throw createError({
        statusCode: 410,
        statusMessage: "This invite link has expired",
      });
    return {
      room: { id: invite.expand.room.id, name: invite.expand.room.name },
      invitedBy: presentPublicProfile(invite.expand.created_by),
      createdAt: invite.created_at,
      expiresAt: invite.expires_at,
    };
  }

  const userId = await requireAuthenticatedUser(event);

  if (!suffix && method === "GET") {
    const rooms = await pb.collection("dspeak_rooms").getFullList({
      filter: `owner = '${userId}' || members ~ '${userId}'`,
      expand: "owner,members",
    });
    return Promise.all(rooms.map((room) => roomDetails(pb, room, userId)));
  }

  const body = method === "GET" ? {} : await parseBody(event);

  if (suffix === "invites" && method === "POST") {
    const room = await pb
      .collection("dspeak_rooms")
      .getOne(requireValue(body.roomId, "Room ID is required"));
    await requireRoomPermission(pb, room, userId, "room.manage_invites");
    const expirySeconds = validateInviteExpiry(body.expirySeconds);
    if (!expirySeconds)
      throw createError({
        statusCode: 400,
        statusMessage: "Invalid invite expiry",
      });
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + expirySeconds * 1000).toISOString();
    const invite = await pb.collection("dspeak_room_invites").create({
      room: room.id,
      created_by: userId,
      created_at: createdAt,
      expires_at: expiresAt,
    });
    const payload = {
      id: invite.id,
      createdBy: String(userId),
      createdAt,
      expiresAt,
      roomId: String(room.id),
    };
    await pb.collection("dspeak_room_audit_log").create({
      room: room.id,
      action: "invite.created",
      actor: userId,
      invite: invite.id,
      occurred_at: createdAt,
      details: { expiresAt },
    });
    setResponseStatus(event, 201);
    return { token: encodeInvitePayload(payload), ...payload };
  }

  if (suffix === "audit" && method === "GET") {
    const room = await pb
      .collection("dspeak_rooms")
      .getOne(requireValue(query.roomId, "Room ID is required"));
    const access = await requireRoomMember(pb, room, userId);
    if (
      !access.isOwner &&
      !access.permissions.some((permission) =>
        ["room.manage_invites", "room.manage_members"].includes(permission),
      )
    )
      throw createError({
        statusCode: 403,
        statusMessage: "Missing permission to view the audit log",
      });
    const records = await pb
      .collection("dspeak_room_audit_log")
      .getList(1, 100, {
        filter: `room = '${room.id}'`,
        sort: "-occurred_at",
        expand: "actor,subject",
      });
    return records.items.map((record) => ({
      id: record.id,
      action: record.action,
      occurredAt: record.occurred_at,
      details: record.details || {},
      actor: presentPublicProfile(record.expand?.actor),
      subject: presentPublicProfile(record.expand?.subject),
    }));
  }

  if (suffix === "kick" && method === "POST") {
    const room = await pb
      .collection("dspeak_rooms")
      .getOne(requireValue(body.roomId, "Room ID is required."));
    const targetUserId = String(
      requireValue(body.targetUserId, "Target user ID is required."),
    );
    if (targetUserId === String(userId))
      throw createError({
        statusCode: 400,
        statusMessage: "You cannot kick yourself.",
      });
    if (targetUserId === String(room.owner))
      throw createError({
        statusCode: 403,
        statusMessage: "The room owner cannot be kicked.",
      });
    const access = await requireRoomPermission(
      pb,
      room,
      userId,
      "room.manage_members",
    );
    let targetMembership;
    try {
      targetMembership = await pb
        .collection("dspeak_room_memberships")
        .getFirstListItem(`room = '${room.id}' && user = '${targetUserId}'`, {
          expand: "roles",
        });
    } catch (error) {
      if (error?.status !== 404) throw error;
    }
    const isLegacyMember = (room.members || [])
      .map(String)
      .includes(targetUserId);
    if (!targetMembership && !isLegacyMember)
      throw createError({
        statusCode: 404,
        statusMessage: "This user is not a room member.",
      });
    if (
      !canManageMember(
        access.roles,
        targetMembership?.expand?.roles || [],
        access.isOwner,
      )
    )
      throw createError({
        statusCode: 403,
        statusMessage: "You cannot kick a member at or above your role.",
      });
    await pb.collection("dspeak_rooms").update(room.id, {
      members: (room.members || [])
        .map(String)
        .filter((memberId) => memberId !== targetUserId),
    });
    const channels = await pb
      .collection("dspeak_rooms_channels")
      .getFullList({ filter: `room = '${room.id}'` });
    await Promise.all(
      channels
        .filter((channel) => channel.isMedia)
        .map((channel) => disconnectVoiceParticipant(channel.id, targetUserId)),
    );
    await Promise.all(
      channels
        .filter((channel) =>
          (channel.inRoom || []).map(String).includes(targetUserId),
        )
        .map((channel) =>
          pb.collection("dspeak_rooms_channels").update(channel.id, {
            inRoom: (channel.inRoom || [])
              .map(String)
              .filter((memberId) => memberId !== targetUserId),
          }),
        ),
    );
    await removeRoomMembership(pb, room.id, targetUserId);
    await broadcastParticipantChange(pb, room.id);
    return { message: "Member kicked successfully." };
  }

  if (!suffix && method === "POST") {
    requireValue(body.name, "Name is required for creating new room.");
    await validateRoomImage(body.picture, 2 * 1024 * 1024, "Room picture");
    await validateRoomImage(body.headerImage, 5 * 1024 * 1024, "Room header");
    const room = await pb.collection("dspeak_rooms").create({
      name: body.name,
      desc: body.desc || "",
      owner: userId,
      members: [userId],
      channels: [],
      accent: normalizeRoomAccent(body.accent),
      attenuation: normalizeAttenuation(structuredValue(body.attenuation)),
      ...(body.picture instanceof File && body.picture.size
        ? { picture: body.picture }
        : {}),
      ...(body.headerImage instanceof File && body.headerImage.size
        ? { header_image: body.headerImage }
        : {}),
    });
    await seedRoomRoles(pb, room, userId);
    const general = await pb.collection("dspeak_rooms_channels").create({
      name: "general",
      desc: "General chat channel",
      isMedia: false,
      audio_bitrate: null,
      inRoom: [],
      owner: userId,
      room: room.id,
    });
    const voice = await pb.collection("dspeak_rooms_channels").create({
      name: "voice",
      desc: "Voice and video channel",
      isMedia: true,
      audio_bitrate: 64,
      inRoom: [],
      owner: userId,
      room: room.id,
    });
    await pb
      .collection("dspeak_rooms")
      .update(room.id, { channels: [general.id, voice.id] });
    setResponseStatus(event, 201);
    return roomDetails(pb, room, userId);
  }

  if (!suffix && method === "PUT") {
    const room = await pb
      .collection("dspeak_rooms")
      .getOne(requireValue(body.roomId, "Room ID is required to edit a room."));
    const identityUpdate = body.name || body.desc !== undefined || body.picture;
    if (identityUpdate)
      await requireRoomPermission(pb, room, userId, "room.update_identity");
    if (body.accent !== undefined || body.attenuation !== undefined)
      await requireRoomPermission(pb, room, userId, "room.update_theme");
    const update = {};
    await validateRoomImage(body.picture, 2 * 1024 * 1024, "Room picture");
    await validateRoomImage(body.headerImage, 5 * 1024 * 1024, "Room header");
    if (body.name) update.name = body.name;
    if (body.desc !== undefined) update.desc = body.desc;
    if (body.picture instanceof File && body.picture.size)
      update.picture = body.picture;
    if (body.headerImage instanceof File && body.headerImage.size)
      update.header_image = body.headerImage;
    if (body.accent !== undefined)
      update.accent = normalizeRoomAccent(body.accent);
    if (body.attenuation !== undefined)
      update.attenuation = normalizeAttenuation(
        structuredValue(body.attenuation),
      );
    const updated = await pb.collection("dspeak_rooms").update(room.id, update);
    if (body.accent !== undefined)
      broadcastGlobally({
        type: "room_updated",
        data: { id: updated.id, accent: normalizeRoomAccent(updated.accent) },
      });
    return roomDetails(pb, updated, userId);
  }

  if (!suffix && method === "DELETE") {
    const room = await pb
      .collection("dspeak_rooms")
      .getOne(
        requireValue(body.roomId, "Room ID is required to delete a room."),
      );
    if (String(room.owner) !== String(userId))
      throw createError({
        statusCode: 403,
        statusMessage: "Only the owner can delete this room.",
      });
    const channels = await pb
      .collection("dspeak_rooms_channels")
      .getFullList({ filter: `room = '${room.id}'` });
    for (const channel of channels) {
      const messages = await pb
        .collection("dspeak_messages")
        .getFullList({ filter: `room_channel = '${channel.id}'` });
      for (const message of messages)
        await pb.collection("dspeak_messages").delete(message.id);
      await pb.collection("dspeak_rooms_channels").delete(channel.id);
    }
    await pb.collection("dspeak_rooms").delete(room.id);
    return { message: "Room deleted successfully." };
  }

  if ((suffix === "join" || suffix === "leave") && method === "POST") {
    const room = await pb
      .collection("dspeak_rooms")
      .getOne(
        requireValue(body.roomId, `Room ID is required to ${suffix} a room.`),
      );
    const members = (room.members || []).map(String);
    if (suffix === "join") {
      let joinedInvite = null;
      const payload = decodeInvitePayload(String(body.inviteToken || ""));
      if (!members.includes(String(userId))) {
        if (!payload || String(payload.roomId) !== String(room.id))
          throw createError({
            statusCode: 403,
            statusMessage: "A valid invite link is required",
          });
        const invite = await pb
          .collection("dspeak_room_invites")
          .getOne(payload.id);
        if (
          String(invite.room) !== String(room.id) ||
          String(invite.created_by) !== String(payload.createdBy) ||
          !sameInstant(invite.created_at, payload.createdAt) ||
          !sameInstant(invite.expires_at, payload.expiresAt)
        )
          throw createError({
            statusCode: 403,
            statusMessage: "Invalid invite link",
          });
        if (Date.parse(invite.expires_at) <= Date.now())
          throw createError({
            statusCode: 410,
            statusMessage: "This invite link has expired",
          });
        joinedInvite = invite;
      }
      if (!members.includes(String(userId)))
        await pb
          .collection("dspeak_rooms")
          .update(room.id, { members: [...members, userId] });
      await ensureRoomMembership(pb, room, userId);
      if (joinedInvite)
        await pb.collection("dspeak_room_audit_log").create({
          room: room.id,
          action: "member.joined_via_invite",
          actor: joinedInvite.created_by,
          subject: userId,
          invite: joinedInvite.id,
          occurred_at: new Date().toISOString(),
          details: {
            inviteCreatedAt: joinedInvite.created_at,
            inviteExpiresAt: joinedInvite.expires_at,
          },
        });
    } else {
      if (String(room.owner) === String(userId) && members.length === 1) {
        throw createError({
          statusCode: 400,
          statusMessage:
            "Unable to leave this room, since you are the only member",
        });
      }
      await pb.collection("dspeak_rooms").update(room.id, {
        members: members.filter((id) => id !== String(userId)),
      });
      await removeRoomMembership(pb, room.id, userId);
    }
    await broadcastParticipantChange(pb, room.id);
    return {
      message: `Successfully ${suffix === "join" ? "joined" : "left"} the room.`,
    };
  }

  throw createError({
    statusCode: 404,
    statusMessage: "Room endpoint not found",
  });
}

async function handleChannels(event, suffix) {
  const pb = await usePocketBaseAdmin();
  const userId = await requireAuthenticatedUser(event);
  const method = event.method;
  const query = getQuery(event);

  if (suffix === "details" && method === "GET") {
    const channel = await pb
      .collection("dspeak_rooms_channels")
      .getOne(requireValue(query.id, "Channel ID is required"), {
        expand: "owner",
      });
    await ensureMember(
      pb,
      await pb.collection("dspeak_rooms").getOne(channel.room),
      userId,
    );
    return presentChannel(channel);
  }

  if (!suffix && method === "GET") {
    const roomId = requireValue(query.roomId, "Room ID is required");
    await ensureMember(
      pb,
      await pb.collection("dspeak_rooms").getOne(roomId),
      userId,
    );
    const channels = await pb.collection("dspeak_rooms_channels").getFullList({
      filter: `room = '${roomId}'`,
      expand: "owner",
      sort: "created",
    });
    return channels.map(presentChannel);
  }

  const body = event.method === "GET" ? {} : await parseBody(event);

  if (suffix === "moderate-voice" && method === "POST") {
    const sourceChannel = await pb
      .collection("dspeak_rooms_channels")
      .getOne(
        requireValue(body.channelId, "Source voice channel ID is required"),
      );
    if (!sourceChannel.isMedia)
      throw createError({
        statusCode: 400,
        statusMessage: "The source channel must be a voice channel",
      });
    const room = await pb.collection("dspeak_rooms").getOne(sourceChannel.room);
    const access = await requireRoomPermission(
      pb,
      room,
      userId,
      "channel.moderate_voice",
    );
    const targetUserId = String(
      requireValue(body.targetUserId, "Target user ID is required"),
    );
    if (targetUserId === String(userId))
      throw createError({
        statusCode: 400,
        statusMessage: "You cannot moderate your own voice connection",
      });
    if (targetUserId === String(room.owner))
      throw createError({
        statusCode: 403,
        statusMessage: "The room owner cannot be voice moderated",
      });
    let targetMembership;
    try {
      targetMembership = await pb
        .collection("dspeak_room_memberships")
        .getFirstListItem(`room = '${room.id}' && user = '${targetUserId}'`, {
          expand: "roles",
        });
    } catch (error) {
      if (error?.status !== 404) throw error;
    }
    if (
      !canModerateVoiceMember(
        access.roles,
        targetMembership?.expand?.roles || [],
        access.isOwner,
      )
    )
      throw createError({
        statusCode: 403,
        statusMessage:
          "You cannot moderate a member at or above your role position",
      });
    if (!(await isActiveVoiceParticipant(sourceChannel.id, targetUserId)))
      throw createError({
        statusCode: 409,
        statusMessage: "The user is no longer connected to this voice channel",
      });
    let targetChannelId = null;
    if (body.targetChannelId) {
      const targetChannel = await pb
        .collection("dspeak_rooms_channels")
        .getOne(String(body.targetChannelId));
      if (
        !targetChannel.isMedia ||
        String(targetChannel.room) !== String(room.id)
      )
        throw createError({
          statusCode: 400,
          statusMessage:
            "The destination must be another voice channel in this room",
        });
      if (String(targetChannel.id) === String(sourceChannel.id))
        throw createError({
          statusCode: 400,
          statusMessage: "The user is already connected to that voice channel",
        });
      targetChannelId = String(targetChannel.id);
    }
    const affected = await moderateVoiceParticipant(
      sourceChannel.id,
      targetUserId,
      targetChannelId,
    );
    if (!affected)
      throw createError({
        statusCode: 409,
        statusMessage: "The user's voice connection already ended",
      });
    return {
      action: targetChannelId ? "move" : "disconnect",
      targetUserId,
      targetChannelId,
    };
  }

  if (!suffix && method === "POST") {
    requireValue(
      body.roomId,
      "Room ID and name are required for creating new channel",
    );
    requireValue(
      body.name,
      "Room ID and name are required for creating new channel",
    );
    const room = await pb.collection("dspeak_rooms").getOne(body.roomId);
    await requireRoomPermission(pb, room, userId, "channel.create");
    setResponseStatus(event, 201);
    return pb.collection("dspeak_rooms_channels").create({
      name: body.name,
      desc: body.desc || "",
      isMedia: Boolean(body.isMedia),
      audio_bitrate: body.isMedia ? body.audio_bitrate || 64 : null,
      media_policy: body.isMedia
        ? normalizeMediaPolicy(body.mediaPolicy, body.audio_bitrate || 64)
        : null,
      inRoom: [],
      owner: userId,
      room: body.roomId,
    });
  }

  if (!suffix && method === "PUT") {
    const channel = await pb
      .collection("dspeak_rooms_channels")
      .getOne(
        requireValue(
          body.channelId,
          "Channel ID is required to edit a channel",
        ),
      );
    const room = await pb.collection("dspeak_rooms").getOne(channel.room);
    if (String(channel.owner) !== String(userId))
      await requireRoomPermission(pb, room, userId, "channel.update");
    const update = {};
    if (body.name) update.name = body.name;
    if (body.desc !== undefined) update.desc = body.desc;
    if (body.mediaPolicy && channel.isMedia) {
      await requireRoomPermission(
        pb,
        room,
        userId,
        "channel.manage_media_policy",
      );
      const validation = validateMediaPolicy(body.mediaPolicy);
      if (!validation.valid)
        throw createError({
          statusCode: 400,
          statusMessage: validation.errors.join("; "),
        });
      update.media_policy = {
        ...validation.value,
        revision:
          normalizeMediaPolicy(channel.media_policy, channel.audio_bitrate)
            .revision + 1,
        updatedAt: new Date().toISOString(),
      };
      update.audio_bitrate = update.media_policy.microphoneKbps;
    }
    const result = await pb
      .collection("dspeak_rooms_channels")
      .update(channel.id, update);
    broadcastToChannel(channel.id, { type: "channel_updated", data: result });
    if (update.media_policy)
      broadcastToChannel(channel.id, {
        type: "channel_policy_updated",
        data: { channelId: channel.id, mediaPolicy: update.media_policy },
      });
    return result;
  }

  if (!suffix && method === "DELETE") {
    const channel = await pb
      .collection("dspeak_rooms_channels")
      .getOne(
        requireValue(
          body.channelId,
          "Channel ID is required to delete a channel",
        ),
      );
    const room = await pb.collection("dspeak_rooms").getOne(channel.room);
    if (String(channel.owner) !== String(userId))
      await requireRoomPermission(pb, room, userId, "channel.delete");
    const channels = await pb
      .collection("dspeak_rooms_channels")
      .getFullList({ filter: `room = '${channel.room}'` });
    if (channels.length === 1)
      throw createError({
        statusCode: 400,
        statusMessage: "Cannot delete the last channel in a room",
      });
    broadcastToChannel(channel.id, {
      type: "channel_deleted",
      data: { channelId: channel.id },
    });
    await pb.collection("dspeak_rooms_channels").delete(channel.id);
    return { message: "Channel deleted successfully" };
  }

  if ((suffix === "join" || suffix === "leave") && method === "POST") {
    const channel = await pb
      .collection("dspeak_rooms_channels")
      .getOne(
        requireValue(
          body.channelId,
          `Channel ID is required to ${suffix} a channel`,
        ),
      );
    await ensureMember(
      pb,
      await pb.collection("dspeak_rooms").getOne(channel.room),
      userId,
    );
    const members = (channel.inRoom || []).map(String);
    const inRoom =
      suffix === "join"
        ? members.includes(String(userId))
          ? members
          : [...members, userId]
        : members.filter((id) => id !== String(userId));
    await pb.collection("dspeak_rooms_channels").update(channel.id, { inRoom });
    broadcastToChannel(channel.id, { type: "currentlyInChannel", inRoom });
    return {
      message: `Successfully ${suffix === "join" ? "joined" : "left"} the channel`,
    };
  }

  throw createError({
    statusCode: 404,
    statusMessage: "Channel endpoint not found",
  });
}

async function handleNotifications(event, pb, userId, suffix) {
  const body = event.method === "GET" ? {} : await parseBody(event);
  if (suffix === "notifications" && event.method === "GET") {
    const items = await pb.collection("dspeak_notifications").getList(1, 100, {
      filter: `recipient = '${userId}'`,
      sort: "-created",
      expand: "actor,room,channel,message",
    });
    return items;
  }
  if (suffix === "notifications/read" && event.method === "POST") {
    const ids = Array.isArray(body.ids) ? body.ids : [];
    const records = ids.length
      ? await pb.collection("dspeak_notifications").getFullList({
          filter: ids.map((id) => `id = '${id}'`).join(" || "),
        })
      : await pb.collection("dspeak_notifications").getFullList({
          filter: `recipient = '${userId}' && read_at = null`,
        });
    const readAt = new Date().toISOString();
    for (const record of records) {
      if (String(record.recipient) !== String(userId)) continue;
      await pb.collection("dspeak_notifications").update(record.id, {
        read_at: readAt,
      });
    }
    broadcastToUser(String(userId), {
      type: "notifications_read",
      data: { ids },
    });
    return { success: true, readAt };
  }
  if (suffix === "notification-preferences") {
    const existing = await pb
      .collection("dspeak_notification_preferences")
      .getFullList({ filter: `user = '${userId}'` });
    if (event.method === "GET")
      return (
        existing[0] || {
          mode: "all",
          push: false,
          sound: true,
          previews: true,
          attenuation_override: { mode: "room", reductionPercent: 65 },
        }
      );
    if (event.method === "PUT") {
      const data = {
        user: userId,
        mode: ["all", "mentions", "muted"].includes(body.mode)
          ? body.mode
          : "all",
        push: Boolean(body.push),
        sound: body.sound !== false,
        previews: body.previews !== false,
        attenuation_override: body.attenuationOverride || {
          mode: "room",
          reductionPercent: 65,
        },
      };
      return existing[0]
        ? pb
            .collection("dspeak_notification_preferences")
            .update(existing[0].id, data)
        : pb.collection("dspeak_notification_preferences").create(data);
    }
  }
  if (suffix === "room-notification-preferences") {
    const roomId = requireValue(
      getQuery(event).roomId || body.roomId,
      "Room ID is required",
    );
    await requireRoomMember(
      pb,
      await pb.collection("dspeak_rooms").getOne(roomId),
      userId,
    );
    const existing = await pb
      .collection("dspeak_room_notification_preferences")
      .getFullList({ filter: `user = '${userId}' && room = '${roomId}'` });
    if (event.method === "GET")
      return (
        existing[0] || { room: roomId, mode: "all", push: null, sound: null }
      );
    if (event.method === "PUT") {
      const data = {
        user: userId,
        room: roomId,
        mode: ["all", "mentions", "muted"].includes(body.mode)
          ? body.mode
          : "all",
        push: body.push === null ? null : Boolean(body.push),
        sound: body.sound === null ? null : Boolean(body.sound),
      };
      return existing[0]
        ? pb
            .collection("dspeak_room_notification_preferences")
            .update(existing[0].id, data)
        : pb.collection("dspeak_room_notification_preferences").create(data);
    }
  }
  throw createError({
    statusCode: 404,
    statusMessage: "Notification endpoint not found",
  });
}

async function handleChat(event, suffix) {
  if (!suffix && event.method === "GET") return "dSpeak Chat";
  if (suffix === "socket" && event.method === "GET")
    throw createError({ statusCode: 426, statusMessage: "Upgrade Required" });
  const pb = await usePocketBaseAdmin();
  const userId = await requireAuthenticatedUser(event);

  if (
    suffix === "notifications" ||
    suffix === "notifications/read" ||
    suffix === "notification-preferences" ||
    suffix === "room-notification-preferences"
  )
    return handleNotifications(event, pb, userId, suffix);

  if (suffix === "unread" && event.method === "GET") {
    const rooms = await pb
      .collection("dspeak_rooms")
      .getFullList({ filter: `members ~ '${userId}'` });
    if (!rooms.length) return [];
    const channels = await pb.collection("dspeak_rooms_channels").getFullList({
      filter: rooms.map((room) => `room = '${room.id}'`).join(" || "),
    });
    if (!channels.length) return [];
    const channelById = new Map(
      channels.map((channel) => [
        String(channel.id),
        {
          channelId: channel.id,
          roomId: channel.room,
          unreadCount: 0,
        },
      ]),
    );
    const messages = await pb.collection("dspeak_messages").getFullList({
      filter: `(${channels
        .map((channel) => `room_channel = '${channel.id}'`)
        .join(" || ")}) && read_by !~ '${userId}'`,
      fields: "room_channel,read_by",
    });
    for (const message of messages) {
      const count = channelById.get(String(message.room_channel));
      if (count) count.unreadCount += 1;
    }
    return [...channelById.values()];
  }

  if (suffix === "messages" && event.method === "GET") {
    const channelId = requireValue(
      getQuery(event).channelId,
      "Channel ID is required",
    );
    const channel = await pb
      .collection("dspeak_rooms_channels")
      .getOne(channelId);
    await ensureMember(
      pb,
      await pb.collection("dspeak_rooms").getOne(channel.room),
      userId,
    );
    const messages = await pb.collection("dspeak_messages").getFullList({
      filter: `room_channel = '${channelId}'`,
      sort: "created",
      expand: "sender,read_by",
    });
    return messages.map((message) => ({
      id: message.id,
      content: message.content,
      room_channel: message.room_channel,
      sender: presentUser(message.expand?.sender, true),
      created: message.created,
      updated: message.updated,
      edited_at: message.edited_at || null,
      client_id: message.client_id || null,
      read_by: (message.expand?.read_by || []).map((user) => presentUser(user)),
    }));
  }

  const body = event.method === "GET" ? {} : await parseBody(event);

  if (suffix === "message" && event.method === "POST") {
    enforceRateLimit(event, "chat-message", userId, 120, 60 * 1000);
    requireValue(body.channelId, "Channel ID and content are required");
    requireValue(body.content, "Channel ID and content are required");
    if (typeof body.content !== "string" || body.content.length > 4000)
      throw createError({
        statusCode: 400,
        statusMessage: "Message content must be at most 4000 characters",
      });
    if (String(body.ownerId || "") !== String(userId))
      throw createError({
        statusCode: 409,
        statusMessage: "Queued message belongs to another account",
      });
    const clientId = String(body.clientMessageId || "");
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(clientId))
      throw createError({
        statusCode: 400,
        statusMessage: "A valid client message ID is required",
      });
    const channel = await pb
      .collection("dspeak_rooms_channels")
      .getOne(body.channelId);
    const room = await pb.collection("dspeak_rooms").getOne(channel.room);
    await ensureMember(pb, room, userId);
    if (channel.isMedia)
      throw createError({
        statusCode: 400,
        statusMessage: "Cannot send text messages to a media channel",
      });
    let created;
    let wasCreated = false;
    try {
      created = await pb.collection("dspeak_messages").getFirstListItem(
        pb.filter("sender = {:sender} && client_id = {:client}", {
          sender: userId,
          client: clientId,
        }),
      );
    } catch (error) {
      if (error?.status !== 404 && error?.response?.status !== 404) throw error;
      try {
        created = await pb.collection("dspeak_messages").create({
          content: body.content,
          room_channel: channel.id,
          sender: userId,
          read_by: [userId],
          client_id: clientId,
        });
        wasCreated = true;
      } catch (createError) {
        if (createError?.status !== 400) throw createError;
        created = await pb.collection("dspeak_messages").getFirstListItem(
          pb.filter("sender = {:sender} && client_id = {:client}", {
            sender: userId,
            client: clientId,
          }),
        );
      }
    }
    const message = await pb
      .collection("dspeak_messages")
      .getOne(created.id, { expand: "sender" });
    const result = {
      id: message.id,
      content: message.content,
      room_channel: message.room_channel,
      sender: presentUser(message.expand?.sender, true),
      created: message.created,
      updated: message.updated,
      edited_at: message.edited_at || null,
      client_id: message.client_id || null,
      read_by: message.read_by || [],
    };
    if (wasCreated)
      broadcastToChannel(channel.id, { type: "new_message", data: result });
    const delivery = await persistMessageNotifications({
      pb,
      room,
      channel,
      message,
      senderId: userId,
    });
    if (delivery.notifications) {
      for (const recipient of (room.members || [])
        .map(String)
        .filter((id) => id !== String(userId))) {
        broadcastToUser(recipient, { type: "notifications_changed" });
      }
    }
    setResponseStatus(event, 201);
    return result;
  }

  if (["message/edit", "message/delete", "message/history"].includes(suffix)) {
    const messageId = requireValue(
      body.messageId || getQuery(event).messageId,
      "Message ID is required",
    );
    const message = await pb
      .collection("dspeak_messages")
      .getOne(messageId, { expand: "sender" });
    const channel = await pb
      .collection("dspeak_rooms_channels")
      .getOne(message.room_channel);
    const room = await pb.collection("dspeak_rooms").getOne(channel.room);
    const access = await requireRoomMember(pb, room, userId);

    if (suffix === "message/history" && event.method === "GET") {
      if (!canViewMessageHistory(access.permissions, access.isOwner))
        throw createError({
          statusCode: 403,
          statusMessage: "Missing permission to view message revision history",
        });
      const revisions = await pb
        .collection("dspeak_message_revisions")
        .getFullList({
          filter: `message = '${message.id}'`,
          sort: "revision",
          expand: "editor",
        });
      return revisions.map((revision) => ({
        id: revision.id,
        revision: revision.revision,
        content: revision.content,
        edited_at: revision.edited_at,
        editor: presentUser(revision.expand?.editor),
      }));
    }

    if (suffix === "message/edit" && event.method === "PATCH") {
      if (!isMessageOwner(message, userId))
        throw createError({
          statusCode: 403,
          statusMessage: "You can only edit your own messages",
        });
      const content = requireValue(body.content, "Message content is required");
      if (typeof content !== "string" || content.length > 4000)
        throw createError({
          statusCode: 400,
          statusMessage: "Message content must be at most 4000 characters",
        });
      const nextContent = content.trim();
      requireValue(nextContent, "Message content is required");
      if (nextContent === message.content)
        throw createError({
          statusCode: 409,
          statusMessage: "The message content has not changed",
        });
      const existing = await pb
        .collection("dspeak_message_revisions")
        .getFullList({
          filter: `message = '${message.id}'`,
          sort: "-revision",
          perPage: 1,
        });
      const nextRevision = existing.length
        ? Number(existing[0].revision) + 1
        : 2;
      const editedAt = new Date().toISOString();
      if (!existing.length)
        await pb.collection("dspeak_message_revisions").create({
          message: message.id,
          editor: message.sender,
          content: message.content,
          revision: 1,
          edited_at: message.created,
        });
      await pb.collection("dspeak_message_revisions").create({
        message: message.id,
        editor: userId,
        content: nextContent,
        revision: nextRevision,
        edited_at: editedAt,
      });
      const updated = await pb
        .collection("dspeak_messages")
        .update(message.id, {
          content: nextContent,
          edited_at: editedAt,
        });
      const result = {
        id: updated.id,
        content: updated.content,
        updated: updated.updated,
        edited_at: updated.edited_at,
      };
      broadcastToChannel(channel.id, { type: "message_updated", data: result });
      return result;
    }

    if (suffix === "message/delete" && event.method === "DELETE") {
      if (
        !canDeleteMessage(message, userId, access.permissions, access.isOwner)
      )
        throw createError({
          statusCode: 403,
          statusMessage: "Missing permission to delete this message",
        });
      await pb.collection("dspeak_messages").delete(message.id);
      broadcastToChannel(channel.id, {
        type: "message_deleted",
        data: { id: message.id },
      });
      return { id: message.id, deleted: true };
    }
  }

  if (suffix === "read" && event.method === "POST") {
    const submittedIds = Array.isArray(body.messageIds)
      ? body.messageIds
      : body.messageId
        ? [body.messageId]
        : [];
    const ids = [
      ...new Set(
        submittedIds
          .filter((messageId) => typeof messageId === "string")
          .map((messageId) => messageId.trim())
          .filter(Boolean),
      ),
    ];
    requireValue(ids.length, "At least one message ID is required");
    if (ids.length > 200)
      throw createError({
        statusCode: 400,
        statusMessage: "A maximum of 200 message IDs is allowed",
      });
    const results = [];
    for (const messageId of ids) {
      try {
        const message = await pb
          .collection("dspeak_messages")
          .getOne(messageId);
        const channel = await pb
          .collection("dspeak_rooms_channels")
          .getOne(message.room_channel);
        await ensureMember(
          pb,
          await pb.collection("dspeak_rooms").getOne(channel.room),
          userId,
        );
        const readers = (message.read_by || []).map(String);
        if (!readers.includes(String(userId))) {
          const readBy = [...readers, userId];
          await pb
            .collection("dspeak_messages")
            .update(message.id, { read_by: readBy });
          broadcastToChannel(channel.id, {
            type: "message_updated",
            data: { id: message.id, read_by: readBy },
          });
          results.push({ messageId, status: "marked_as_read" });
        } else results.push({ messageId, status: "already_read" });
      } catch (error) {
        results.push({
          messageId,
          status: "error",
          error: pocketBaseError(error),
        });
      }
    }
    return { results };
  }

  if (suffix === "subscribe/global") {
    enforceRateLimit(event, "push-subscription", userId, 30, 60 * 60 * 1000);
    const deviceId = requireValue(
      getHeader(event, "x-dspeak-device"),
      "Device ID is required",
    );
    const existing = await pb
      .collection("dspeak_push_subscriptions")
      .getFullList({
        filter: pb.filter("user = {:user} && device_id = {:device}", {
          user: userId,
          device: deviceId,
        }),
      });
    if (event.method === "GET")
      return {
        hasSubscription: existing.length > 0,
        subscription: existing[0]
          ? {
              id: existing[0].id,
              created: existing[0].created,
              updated: existing[0].updated,
            }
          : null,
      };
    if (event.method === "DELETE") {
      const endpoint = requireValue(
        body.subscription?.endpoint,
        "Subscription endpoint is required",
      );
      const matching = existing.filter(
        (subscription) => subscription.endpoint === endpoint,
      );
      for (const subscription of matching)
        await pb
          .collection("dspeak_push_subscriptions")
          .delete(subscription.id);
      return { success: true, message: "Device subscription deleted" };
    }
    if (event.method === "POST") {
      const subscription = requireValue(
        body.subscription,
        "Subscription is required",
      );
      const endpoint = requireValue(
        subscription.endpoint,
        "Subscription endpoint is required",
      );
      if (
        endpoint.length > 4096 ||
        String(subscription.keys?.p256dh || "").length > 512 ||
        String(subscription.keys?.auth || "").length > 512
      )
        throw createError({
          statusCode: 400,
          statusMessage: "Subscription data is too large",
        });
      const endpointUrl = new URL(endpoint);
      if (endpointUrl.protocol !== "https:")
        throw createError({
          statusCode: 400,
          statusMessage: "Subscription endpoint must use HTTPS",
        });
      const data = {
        user: userId,
        device_id: deviceId,
        endpoint,
        p256dh: requireValue(subscription.keys?.p256dh, "p256dh is required"),
        auth: requireValue(subscription.keys?.auth, "auth is required"),
        disabled: false,
        failure_count: 0,
      };
      const byEndpoint = await pb
        .collection("dspeak_push_subscriptions")
        .getFullList({
          filter: pb.filter("endpoint = {:endpoint}", { endpoint }),
        });
      if (byEndpoint[0] && String(byEndpoint[0].user) !== String(userId))
        throw createError({
          statusCode: 409,
          statusMessage: "Subscription belongs to another account",
        });
      const record = byEndpoint[0] || existing[0];
      if (record)
        await pb
          .collection("dspeak_push_subscriptions")
          .update(record.id, data);
      else await pb.collection("dspeak_push_subscriptions").create(data);
      setResponseStatus(event, 201);
      return { success: true, message: "Device subscription updated" };
    }
  }

  if (suffix === "push/test" && event.method === "POST") {
    enforceRateLimit(event, "push-test", userId, 5, 60 * 60 * 1000);
    const deviceId = requireValue(
      getHeader(event, "x-dspeak-device"),
      "Device ID is required",
    );
    return sendPushTest(pb, userId, deviceId);
  }

  if (suffix === "subscribe" && event.method === "POST") {
    requireValue(body.roomId, "Room ID and subscription are required");
    requireValue(body.subscription, "Room ID and subscription are required");
    const existing = await pb.collection("dspeak_webpush").getFullList({
      filter: pb.filter("room = {:room} && user = {:user}", {
        room: body.roomId,
        user: userId,
      }),
    });
    if (!existing.length)
      await pb.collection("dspeak_webpush").create({
        room: body.roomId,
        user: userId,
        keys: {
          endpoint: body.subscription.endpoint,
          p256dh: body.subscription.keys.p256dh,
          auth: body.subscription.keys.auth,
        },
      });
    setResponseStatus(event, 201);
    return { success: true };
  }

  throw createError({
    statusCode: 404,
    statusMessage: "Chat endpoint not found",
  });
}

async function handleProfile(event, suffix) {
  const userId = await requireAuthenticatedUser(event);
  const pb = await usePocketBaseAdmin();

  if (!suffix && event.method === "GET") {
    return presentUser(await pb.collection("users").getOne(userId), true);
  }

  if (!suffix && event.method === "PATCH") {
    const body = await parseBody(event);
    const update = new FormData();
    if (Object.hasOwn(body, "displayName")) {
      try {
        update.set("display_name", normalizeDisplayName(body.displayName));
      } catch (error) {
        throw createError({ statusCode: 400, statusMessage: error.message });
      }
    }
    if (Object.hasOwn(body, "handle")) {
      try {
        update.set("handle", normalizeHandle(body.handle));
      } catch (error) {
        throw createError({ statusCode: 400, statusMessage: error.message });
      }
    }
    if (body.avatar instanceof File && body.avatar.size) {
      await validateRoomImage(body.avatar, 5 * 1024 * 1024, "Profile picture");
      update.set("avatar", body.avatar, body.avatar.name);
    }
    if (body.removeAvatar === "true" || body.removeAvatar === true)
      update.set("avatar", "");
    if (![...update.keys()].length)
      throw createError({
        statusCode: 400,
        statusMessage: "No profile changes provided",
      });
    try {
      const updatedUser = await pb.collection("users").update(userId, update);
      const profile = presentUser(updatedUser, true);
      const publicProfile = presentPublicProfile(updatedUser);
      await updateActiveUserProfile(publicProfile);
      broadcastGlobally({ type: "profile_updated", data: publicProfile });
      return profile;
    } catch (error) {
      const handleError = error?.response?.data?.handle;
      if (handleError?.code === "validation_not_unique")
        throw createError({
          statusCode: 409,
          statusMessage: "Username is already taken",
        });
      throw error;
    }
  }

  if (suffix === "nicknames" && event.method === "GET") {
    const records = await pb.collection("dspeak_user_nicknames").getFullList({
      filter: pb.filter("owner = {:owner}", { owner: userId }),
      fields: "target,nickname",
    });
    return {
      nicknames: Object.fromEntries(
        records.map((record) => [String(record.target), record.nickname]),
      ),
    };
  }

  if (suffix === "nickname" && event.method === "PUT") {
    const body = await parseBody(event);
    const targetUserId = requireValue(
      String(body.targetUserId || "").trim(),
      "Target user is required",
    );
    await pb.collection("users").getOne(targetUserId, { fields: "id" });
    let nickname;
    try {
      nickname = normalizeNickname(body.nickname);
    } catch (error) {
      throw createError({ statusCode: 400, statusMessage: error.message });
    }
    const existing = await pb.collection("dspeak_user_nicknames").getFullList({
      filter: pb.filter("owner = {:owner} && target = {:target}", {
        owner: userId,
        target: targetUserId,
      }),
    });
    if (!nickname) {
      if (existing[0])
        await pb.collection("dspeak_user_nicknames").delete(existing[0].id);
      return { targetUserId, nickname: "" };
    }
    const record = existing[0]
      ? await pb.collection("dspeak_user_nicknames").update(existing[0].id, {
          nickname,
        })
      : await pb.collection("dspeak_user_nicknames").create({
          owner: userId,
          target: targetUserId,
          nickname,
        });
    return { targetUserId, nickname: record.nickname };
  }

  throw createError({
    statusCode: 404,
    statusMessage: "Profile endpoint not found",
  });
}

async function handleAssets(event, suffix) {
  if (suffix !== "avatar" || event.method !== "GET")
    throw createError({
      statusCode: 404,
      statusMessage: "Asset endpoint not found",
    });

  await requireAuthenticatedUser(event);
  const query = getQuery(event);
  const userId = requireValue(query.userId, "User ID is required");
  const requestedFileName = requireValue(
    query.fileName,
    "Avatar filename is required",
  );
  const pb = await usePocketBaseAdmin();
  const user = await pb.collection("users").getOne(userId, {
    fields: "id,avatar",
  });

  if (!user.avatar || user.avatar !== requestedFileName)
    throw createError({
      statusCode: 404,
      statusMessage: "Avatar not found",
    });

  const response = await fetch(pb.files.getURL(user, user.avatar));
  if (!response.ok)
    throw createError({
      statusCode: response.status,
      statusMessage: "Failed to load avatar",
    });

  setHeader(event, "Cache-Control", "private, max-age=604800, immutable");
  setHeader(
    event,
    "Content-Type",
    response.headers.get("content-type") || "image/jpeg",
  );
  return sendWebResponse(event, response);
}

export async function handleDspeakApi(event) {
  const path = String(getRouterParam(event, "path") || "").replace(
    /^\/+|\/+$/g,
    "",
  );
  const [domain = "", ...rest] = path.split("/");
  const suffix = rest.join("/");

  try {
    if (!domain && event.method === "GET") return "dSpeak ready.";
    if (domain === "session" && event.method === "POST") {
      const body = await parseBody(event);
      return await createAuthenticatedSession(
        event,
        body.accessToken,
        getHeader(event, "x-dspeak-device") || body.deviceId,
      );
    }
    if (domain === "session" && event.method === "GET")
      return await restoreAuthenticatedSession(event);
    if (domain === "session" && event.method === "DELETE")
      return await revokeAuthenticatedSession(event);
    if (domain === "config" && event.method === "GET")
      return createIceServers();
    if (domain === "room") return await handleRooms(event, suffix);
    if (domain === "channel") return await handleChannels(event, suffix);
    if (domain === "chat") return await handleChat(event, suffix);
    if (domain === "profile") return await handleProfile(event, suffix);
    if (domain === "assets") return await handleAssets(event, suffix);
    if (domain === "soundboard")
      return await handleSoundboardApi(event, suffix);
    throw createError({
      statusCode: 404,
      statusMessage: "dSpeak endpoint not found",
    });
  } catch (error) {
    if (error?.statusCode) throw error;
    console.error("[dSpeak API]", error);
    throw createError({
      statusCode: error?.status || 500,
      statusMessage: error?.message || "Internal Server Error",
      data: pocketBaseError(error),
    });
  }
}
