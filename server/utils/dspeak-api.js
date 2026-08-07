import { createRoomsApiHandler } from "./dspeak-rooms-api.js";
import { createChatApiHandler } from "./dspeak-chat-api.js";
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
import { requireAuthenticatedUser } from "./auth";
import {
  disconnectVoiceParticipant,
  isActiveVoiceParticipant,
  moderateVoiceParticipant,
  updateActiveUserProfile,
} from "./mediasoup-sfu";
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
import {
  assertSafeOutboundUrl,
  configuredOutboundHosts,
  fetchPublicHtml,
} from "../infrastructure/network/outbound-request.js";
import { db } from "../db/client.js";
import {
  channels,
  roomMemberships,
  roomRoles,
  membershipRoles,
  profiles,
  userNicknames,
  avatars,
  roomImages,
  chatFiles,
} from "../db/schema/index.js";
import { getVoicePresenceSnapshots } from "./voice-presence.js";
import { getRoomById, getChannelById } from "./room-authorization.js";
import { eq, and, inArray, asc, desc } from "drizzle-orm";

function noop() {}

function profileAvatar(user) {
  const userId = String(user?.id || "");
  const key = user?.avatarKey || "";
  if (!userId || !key) return null;
  return `/api/assets/avatar?userId=${encodeURIComponent(userId)}&fileName=${encodeURIComponent(key)}`;
}

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

async function validateRoomImage(file, limit, label, allowGif = false) {
  if (!(file instanceof File) || !file.size) return;
  if (file.size > limit)
    throw createError({
      statusCode: 413,
      statusMessage: `${label} exceeds the upload limit`,
    });
  const allowed = [
    "image/jpeg",
    "image/png",
    "image/webp",
    ...(allowGif ? ["image/gif"] : []),
  ];
  if (!allowed.includes(file.type))
    throw createError({
      statusCode: 415,
      statusMessage: `${label} must be JPEG, PNG, WebP${allowGif ? ", or GIF" : ""}`,
    });
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const png = bytes.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10";
  const webp =
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  const gif = String.fromCharCode(...bytes.slice(0, 4)) === "GIF8";
  const validSignature = {
    "image/jpeg": jpeg,
    "image/png": png,
    "image/webp": webp,
    "image/gif": gif,
  }[file.type];
  if (!validSignature)
    throw createError({
      statusCode: 415,
      statusMessage: `${label} is invalid`,
    });
}

async function ensureMember(pb, room, userId) {
  return requireRoomMember(room, userId);
}

function presentUser(user) {
  if (!user) return null;
  return {
    id: String(user.id),
    name: publicDisplayName(user),
    display_name: user.displayName || "",
    username: user.username || "",
    handle: user.username || "",
    online: false,
    avatar: profileAvatar(user),
  };
}

function presentPublicProfile(user) {
  if (!user) return null;
  const publicName = publicDisplayName(user);
  return {
    id: String(user.id),
    name: publicName,
    display_name: user.displayName || "",
    provider_name: user.displayName || "",
    username: user.username || "",
    handle: user.username || "",
    avatar: profileAvatar(user),
  };
}

function presentChannel(channel) {
  const mediaPolicy = normalizeMediaPolicy(channel.mediaPolicy);
  const isMedia = ["voice", "stage"].includes(channel.type);
  const inRoom = getVoicePresenceSnapshots(channel.roomId)
    .filter((snapshot) => String(snapshot.channelId) === String(channel.id))
    .flatMap((snapshot) => snapshot.inRoom || [])
    .map(String);
  return {
    id: channel.id,
    name: channel.name,
    desc: channel.description || "",
    isMedia,
    mediaPolicy,
    inRoom,
    created: channel.createdAt,
    updated: channel.updatedAt,
    owner: null,
    room: channel.roomId,
    policy: "free",
    slow_mode: 0,
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

async function roomDetails(db, room, userId = null) {
  const [channelRows, membershipRows] = await Promise.all([
    db
      .select()
      .from(channels)
      .where(eq(channels.roomId, room.id))
      .orderBy(asc(channels.createdAt)),
    db
      .select({
        id: roomMemberships.id,
        userId: roomMemberships.userId,
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
  ]);
  const access = userId ? await presentRoomAccess(room, userId) : null;
  const userIds = [
    ...new Set(
      membershipRows
        .map((m) => String(m.userId))
        .concat(room.ownerId ? [String(room.ownerId)] : []),
    ),
  ];
  const profileRows = userIds.length
    ? await db.select().from(profiles).where(inArray(profiles.id, userIds))
    : [];
  const profileById = new Map(profileRows.map((p) => [String(p.id), p]));
  const rolesByUserId = new Map();
  for (const row of membershipRows) {
    if (!row.roleId) continue;
    const list = rolesByUserId.get(String(row.userId)) || [];
    list.push({
      id: row.roleId,
      name: row.roleName,
      color: row.roleColor,
      position: row.rolePosition,
      system: Boolean(row.roleSystem),
      isDefault: Boolean(row.roleIsDefault),
    });
    rolesByUserId.set(String(row.userId), list);
  }
  const imageRows = await db
    .select()
    .from(roomImages)
    .where(
      and(
        eq(roomImages.roomId, room.id),
        inArray(roomImages.type, ["profile", "header"]),
      ),
    );
  const imageByType = new Map(imageRows.map((img) => [img.type, img.r2Key]));
  return {
    id: room.id,
    name: room.name,
    desc: room.description || "",
    created: room.createdAt,
    updated: room.updatedAt,
    picture: imageByType.has("profile") ? `room/profile?id=${room.id}` : null,
    headerImage: imageByType.has("header") ? `room/header?id=${room.id}` : null,
    owner: presentUser(profileById.get(String(room.ownerId))),
    members: userIds.map((id) => ({
      ...presentUser(profileById.get(id)),
      roles: rolesByUserId.get(id) || [],
    })),
    channels: channelRows.map(presentChannel),
    roles: access?.roles || [],
    permissions: access?.permissions || [],
    isOwner: access?.isOwner || false,
  };
}

async function broadcastParticipantChange(roomId) {
  const channelRows = await db
    .select()
    .from(channels)
    .where(eq(channels.roomId, roomId));
  for (const channel of channelRows) {
    broadcastToChannel(channel.id, { type: "participant_change" });
  }
}

const handleRooms = createRoomsApiHandler({
  broadcastGlobally,
  broadcastParticipantChange,
  canManageMember,
  createError,
  decodeInvitePayload,
  deleteMatchingRecords,
  disconnectVoiceParticipant,
  encodeInvitePayload,
  ensureRoomMembership,
  enforceRateLimit,
  getBoundedList,
  getQuery,
  normalizeAttenuation,
  normalizeMediaPolicy,
  normalizePermissions,
  normalizeRoomAccent,
  parseBody,
  presentPublicProfile,
  removeRoomMembership,
  requireAuthenticatedUser,
  requireRoleManagement,
  requireRoomMember,
  requireRoomPermission,
  requireValue,
  roomDetails,
  sameInstant,
  seedRoomRoles,
  sendWebResponse,
  setHeader,
  setResponseStatus,
  structuredValue,
  usePocketBaseAdmin: noop,
  validateInviteExpiry,
  validateRoomImage,
});

async function handleChannels(event, suffix) {
  const userId = await requireAuthenticatedUser(event);
  const method = event.method;
  const query = getQuery(event);
  if (!["GET", "HEAD"].includes(method))
    enforceRateLimit(event, "channel-mutation", userId, 60, 60 * 1000);

  if (suffix === "details" && method === "GET") {
    const channel = await getChannelById(
      requireValue(query.id, "Channel ID is required"),
    );
    if (!channel)
      throw createError({
        statusCode: 404,
        statusMessage: "Channel not found",
      });
    const room = await getRoomById(channel.roomId);
    if (!room)
      throw createError({ statusCode: 404, statusMessage: "Room not found" });
    await ensureMember(null, room, userId);
    return presentChannel(channel);
  }

  if (!suffix && method === "GET") {
    const roomId = requireValue(query.roomId, "Room ID is required");
    const room = await getRoomById(roomId);
    if (!room)
      throw createError({ statusCode: 404, statusMessage: "Room not found" });
    await ensureMember(null, room, userId);
    const channelRows = await db
      .select()
      .from(channels)
      .where(eq(channels.roomId, roomId))
      .orderBy(asc(channels.createdAt));
    return channelRows.map(presentChannel);
  }

  const body = event.method === "GET" ? {} : await parseBody(event);

  if (suffix === "moderate-voice" && method === "POST") {
    const sourceChannelRow = await db
      .select()
      .from(channels)
      .where(
        eq(
          channels.id,
          requireValue(body.channelId, "Source voice channel ID is required"),
        ),
      )
      .limit(1);
    const sourceChannel = sourceChannelRow[0];
    if (!sourceChannel)
      throw createError({
        statusCode: 404,
        statusMessage: "Channel not found",
      });
    if (!["voice", "stage"].includes(sourceChannel.type))
      throw createError({
        statusCode: 400,
        statusMessage: "The source channel must be a voice channel",
      });
    const room = await getRoomById(sourceChannel.roomId);
    if (!room)
      throw createError({ statusCode: 404, statusMessage: "Room not found" });
    const access = await requireRoomPermission(
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
    if (targetUserId === String(room.ownerId))
      throw createError({
        statusCode: 403,
        statusMessage: "The room owner cannot be voice moderated",
      });
    const targetRoles = await roomRolesForUser(db, room.id, targetUserId);
    if (!canModerateVoiceMember(access.roles, targetRoles, access.isOwner))
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
      const targetRow = await db
        .select()
        .from(channels)
        .where(eq(channels.id, String(body.targetChannelId)))
        .limit(1);
      const targetChannel = targetRow[0];
      if (
        !targetChannel ||
        !["voice", "stage"].includes(targetChannel.type) ||
        String(targetChannel.roomId) !== String(room.id)
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
    const room = await getRoomById(String(body.roomId));
    if (!room)
      throw createError({ statusCode: 404, statusMessage: "Room not found" });
    await requireRoomPermission(room, userId, "channel.create");
    setResponseStatus(event, 201);
    const existing = await db
      .select({ position: channels.position })
      .from(channels)
      .where(eq(channels.roomId, room.id))
      .orderBy(desc(channels.position))
      .limit(1);
    const position = existing[0] ? existing[0].position + 1 : 0;
    const result = await db
      .insert(channels)
      .values({
        roomId: room.id,
        name: String(body.name).trim(),
        type: body.isMedia ? "voice" : "text",
        position,
      })
      .returning();
    return presentChannel(result[0]);
  }

  if (!suffix && method === "PUT") {
    const channelRow = await db
      .select()
      .from(channels)
      .where(
        eq(
          channels.id,
          requireValue(
            body.channelId,
            "Channel ID is required to edit a channel",
          ),
        ),
      )
      .limit(1);
    const channel = channelRow[0];
    if (!channel)
      throw createError({
        statusCode: 404,
        statusMessage: "Channel not found",
      });
    const room = await getRoomById(channel.roomId);
    if (!room)
      throw createError({ statusCode: 404, statusMessage: "Room not found" });
    await requireRoomPermission(room, userId, "channel.update");
    const update = { updatedAt: new Date() };
    if (body.name) update.name = String(body.name).trim();
    if (body.desc !== undefined) update.description = String(body.desc);
    if (body.mediaPolicy && ["voice", "stage"].includes(channel.type)) {
      await requireRoomPermission(room, userId, "channel.manage_media_policy");
      const validation = validateMediaPolicy(body.mediaPolicy);
      if (!validation.valid)
        throw createError({
          statusCode: 400,
          statusMessage: validation.errors.join("; "),
        });
      update.mediaPolicy = validation.value;
    }
    const result = await db
      .update(channels)
      .set(update)
      .where(eq(channels.id, channel.id))
      .returning();
    const updated = result[0];
    const presented = presentChannel(updated);
    broadcastToChannel(channel.id, {
      type: "channel_updated",
      data: presented,
    });
    if (update.mediaPolicy)
      broadcastToChannel(channel.id, {
        type: "channel_policy_updated",
        data: { channelId: channel.id, mediaPolicy: update.mediaPolicy },
      });
    return presented;
  }

  if (!suffix && method === "DELETE") {
    const channelRow = await db
      .select()
      .from(channels)
      .where(
        eq(
          channels.id,
          requireValue(
            body.channelId,
            "Channel ID is required to delete a channel",
          ),
        ),
      )
      .limit(1);
    const channel = channelRow[0];
    if (!channel)
      throw createError({
        statusCode: 404,
        statusMessage: "Channel not found",
      });
    const room = await getRoomById(channel.roomId);
    if (!room)
      throw createError({ statusCode: 404, statusMessage: "Room not found" });
    await requireRoomPermission(room, userId, "channel.delete");
    const countResult = await db
      .select({ id: channels.id })
      .from(channels)
      .where(eq(channels.roomId, channel.roomId));
    if (countResult.length === 1)
      throw createError({
        statusCode: 400,
        statusMessage: "Cannot delete the last channel in a room",
      });
    await db.delete(channels).where(eq(channels.id, channel.id));
    broadcastToChannel(channel.id, {
      type: "channel_deleted",
      data: { channelId: channel.id },
    });
    return { message: "Channel deleted successfully" };
  }

  if ((suffix === "join" || suffix === "leave") && method === "POST") {
    const channelRow = await db
      .select()
      .from(channels)
      .where(
        eq(
          channels.id,
          requireValue(
            body.channelId,
            `Channel ID is required to ${suffix} a channel`,
          ),
        ),
      )
      .limit(1);
    const channel = channelRow[0];
    if (!channel)
      throw createError({
        statusCode: 404,
        statusMessage: "Channel not found",
      });
    const room = await getRoomById(channel.roomId);
    if (!room)
      throw createError({ statusCode: 404, statusMessage: "Room not found" });
    await ensureMember(null, room, userId);
    const members = new Set(
      getVoicePresenceSnapshots(channel.roomId)
        .filter((snapshot) => String(snapshot.channelId) === String(channel.id))
        .flatMap((snapshot) => snapshot.inRoom || [])
        .map(String),
    );
    if (suffix === "join") members.add(String(userId));
    else {
      members.delete(String(userId));
      await disconnectVoiceParticipant(channel.id, String(userId));
    }
    const inRoom = [...members];
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

async function roomRolesForUser(db, roomId, userId) {
  const rows = await db
    .select({
      id: roomRoles.id,
      name: roomRoles.name,
      color: roomRoles.color,
      position: roomRoles.position,
      system: roomRoles.system,
      isDefault: roomRoles.isDefault,
    })
    .from(roomMemberships)
    .leftJoin(
      membershipRoles,
      eq(membershipRoles.membershipId, roomMemberships.id),
    )
    .leftJoin(roomRoles, eq(roomRoles.id, membershipRoles.roleId))
    .where(
      and(
        eq(roomMemberships.roomId, roomId),
        eq(roomMemberships.userId, userId),
      ),
    );
  return rows.filter((row) => row.id);
}

const handleChat = createChatApiHandler({
  broadcastToChannel,
  broadcastToUser,
  assertSafeOutboundUrl,
  canDeleteMessage,
  canViewMessageHistory,
  createError,
  enforceRateLimit,
  ensureMember,
  fetchPublicHtml,
  getBoundedList: noop,
  getHeader,
  getQuery,
  isMessageOwner,
  parseBody,
  persistMessageNotifications,
  presentUser,
  requireAuthenticatedUser,
  requireRoomMember,
  requireValue,
  sendPushTest,
  setResponseStatus,
  usePocketBaseAdmin: noop,
  pushAllowedHosts: configuredOutboundHosts(
    process.env.DSPEAK_PUSH_ALLOWED_HOSTS,
  ),
});

async function handleProfile(event, suffix) {
  const userId = await requireAuthenticatedUser(event);
  if (!["GET", "HEAD"].includes(event.method))
    enforceRateLimit(event, "profile-mutation", userId, 30, 60 * 60 * 1000);

  if (!suffix && event.method === "GET") {
    const profile = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);
    return presentUser(profile[0]);
  }

  if (!suffix && event.method === "PATCH") {
    const body = await parseBody(event);
    const update = {};
    if (Object.hasOwn(body, "displayName")) {
      try {
        update.displayName = normalizeDisplayName(body.displayName);
      } catch (error) {
        throw createError({ statusCode: 400, statusMessage: error.message });
      }
    }
    if (Object.hasOwn(body, "handle")) {
      try {
        update.username = normalizeHandle(body.handle);
      } catch (error) {
        throw createError({ statusCode: 400, statusMessage: error.message });
      }
    }
    if (body.avatar instanceof File && body.avatar.size) {
      await validateRoomImage(
        body.avatar,
        5 * 1024 * 1024,
        "Profile picture",
        true,
      );
    }
    if (
      !Object.keys(update).length &&
      !(body.avatar instanceof File && body.avatar.size) &&
      body.removeAvatar !== true &&
      body.removeAvatar !== "true"
    )
      throw createError({
        statusCode: 400,
        statusMessage: "No profile changes provided",
      });
    try {
      const result = await db
        .update(profiles)
        .set({ ...update, updatedAt: new Date() })
        .where(eq(profiles.id, userId))
        .returning();
      const updated = result[0];
      const publicProfile = presentPublicProfile(updated);
      await updateActiveUserProfile(publicProfile);
      broadcastGlobally({ type: "profile_updated", data: publicProfile });
      return presentUser(updated);
    } catch (error) {
      if (error?.message?.includes("unique"))
        throw createError({
          statusCode: 409,
          statusMessage: "Username is already taken",
        });
      throw error;
    }
  }

  if (suffix === "nicknames" && event.method === "GET") {
    const rows = await db
      .select()
      .from(userNicknames)
      .where(eq(userNicknames.setById, userId));
    return {
      nicknames: Object.fromEntries(
        rows.map((row) => [String(row.userId), row.nickname]),
      ),
    };
  }

  if (suffix === "nickname" && event.method === "PUT") {
    const body = await parseBody(event);
    const targetUserId = requireValue(
      String(body.targetUserId || "").trim(),
      "Target user is required",
    );
    const roomId = requireValue(
      String(body.roomId || "").trim(),
      "Room ID is required",
    );
    const target = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.id, targetUserId))
      .limit(1);
    if (!target[0])
      throw createError({ statusCode: 404, statusMessage: "User not found" });
    let nickname;
    try {
      nickname = normalizeNickname(body.nickname);
    } catch (error) {
      throw createError({ statusCode: 400, statusMessage: error.message });
    }
    const existing = await db
      .select({ id: userNicknames.id })
      .from(userNicknames)
      .where(
        and(
          eq(userNicknames.roomId, roomId),
          eq(userNicknames.userId, targetUserId),
        ),
      )
      .limit(1);
    if (!nickname) {
      if (existing[0])
        await db
          .delete(userNicknames)
          .where(eq(userNicknames.id, existing[0].id));
      return { targetUserId, nickname: "" };
    }
    const result = existing[0]
      ? await db
          .update(userNicknames)
          .set({ nickname, setById: userId })
          .where(eq(userNicknames.id, existing[0].id))
          .returning()
      : await db
          .insert(userNicknames)
          .values({ roomId, userId: targetUserId, nickname, setById: userId })
          .returning();
    return { targetUserId, nickname: result[0].nickname };
  }

  throw createError({
    statusCode: 404,
    statusMessage: "Profile endpoint not found",
  });
}

async function handleAssets(event, suffix) {
  if (event.method !== "GET")
    throw createError({
      statusCode: 404,
      statusMessage: "Asset endpoint not found",
    });

  const authenticatedUserId = await requireAuthenticatedUser(event);
  const query = getQuery(event);

  if (suffix === "chat-file") {
    const fileId = requireValue(query.id, "Chat file ID is required");
    const fileRows = await db
      .select()
      .from(chatFiles)
      .where(eq(chatFiles.id, fileId))
      .limit(1);
    const file = fileRows[0];
    if (!file)
      throw createError({
        statusCode: 404,
        statusMessage: "Chat file not found",
      });
    const channel = await getChannelById(file.channelId);
    if (!channel)
      throw createError({
        statusCode: 404,
        statusMessage: "Channel not found",
      });
    const room = await getRoomById(channel.roomId);
    if (!room)
      throw createError({ statusCode: 404, statusMessage: "Room not found" });
    await requireRoomMember(room, authenticatedUserId);
    const url = await createDownloadUrl(file.r2Key);
    setHeader(event, "Cache-Control", "private, max-age=604800, immutable");
    setHeader(
      event,
      "Content-Type",
      file.mimeType || "application/octet-stream",
    );
    setHeader(event, "X-Content-Type-Options", "nosniff");
    return sendRedirect(event, url, 302);
  }

  if (suffix === "avatar") {
    const targetUserId = requireValue(query.userId, "User ID is required");
    const requestedFileName = requireValue(
      query.fileName,
      "Avatar filename is required",
    );
    const avatarRows = await db
      .select()
      .from(avatars)
      .where(eq(avatars.userId, targetUserId))
      .orderBy(desc(avatars.createdAt))
      .limit(1);
    const avatar = avatarRows[0];
    if (!avatar || avatar.r2Key !== requestedFileName)
      throw createError({
        statusCode: 404,
        statusMessage: "Avatar not found",
      });
    const url = await createDownloadUrl(avatar.r2Key);
    setHeader(event, "Cache-Control", "private, max-age=604800, immutable");
    setHeader(event, "Content-Type", avatar.mimeType || "image/jpeg");
    setHeader(event, "X-Content-Type-Options", "nosniff");
    return sendRedirect(event, url, 302);
  }

  throw createError({
    statusCode: 404,
    statusMessage: "Asset endpoint not found",
  });
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
    if (domain === "config" && event.method === "GET") {
      const userId = await requireAuthenticatedUser(event);
      enforceRateLimit(event, "turn-credentials", userId, 12, 10 * 60 * 1000);
      const profile = await db
        .select()
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1);
      if (!profile[0])
        throw createError({
          statusCode: 403,
          statusMessage: "User profile not found",
        });
      return createIceServers();
    }
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
    if (Number(error?.status) >= 400 && Number(error?.status) < 500) {
      console.error("[dSpeak API] client error caught in catch-all handler", {
        domain,
        suffix,
        method: event.method,
        path: getRequestURL(event).pathname,
        status: Number(error.status),
        statusMessage: error.message || error.statusMessage,
        responseData: error.response?.data || error.response,
        errorUrl: error.url,
        url: error?.response?.url,
      });
      throw createError({
        statusCode: Number(error.status),
        statusMessage:
          Number(error.status) === 404
            ? "Resource not found"
            : Number(error.status) === 409
              ? "Resource conflict"
              : "Invalid request",
      });
    }
    const requestId = crypto.randomUUID();
    console.error(`[dSpeak API] request ${requestId}`, error);
    throw createError({
      statusCode: 500,
      statusMessage: "Internal Server Error",
      data: { code: "INTERNAL_ERROR", requestId },
    });
  }
}
