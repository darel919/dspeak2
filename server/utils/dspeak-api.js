import { createRoomsApiHandler } from "./dspeak-rooms-api.js";
import { createChatApiHandler } from "./dspeak-chat-api.js";
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
  createAuthenticationHandoff,
  exchangeAuthenticationHandoff,
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
import { usePocketBaseAdmin } from "./pocketbase";
import { deleteMatchingRecords, getBoundedList } from "./pocketbase-query";
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
import { sameOriginAvatarPath } from "../../shared/avatar-path.js";
import {
  assertSafeOutboundUrl,
  configuredOutboundHosts,
  fetchPublicHtml,
} from "../infrastructure/network/outbound-request.js";

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
  return requireRoomMember(pb, room, userId);
}

function presentUser(user) {
  if (!user) return null;
  return {
    id: String(user.id),
    name: publicDisplayName(user),
    display_name: user.display_name || "",
    username: user.username || "",
    handle: user.handle || "",
    online: Boolean(user.online),
    avatar: sameOriginAvatarPath(user),
  };
}

function presentPublicProfile(user) {
  if (!user) return null;
  const publicName = publicDisplayName(user);
  return {
    id: String(user.id),
    name: publicName,
    display_name: user.display_name || "",
    provider_name: user.name || "",
    username: user.username || "",
    handle: user.handle || "",
    avatar: sameOriginAvatarPath(user),
  };
}

function presentChannel(channel) {
  const mediaPolicy = normalizeMediaPolicy(channel.media_policy);
  return {
    id: channel.id,
    name: channel.name,
    desc: channel.desc,
    isMedia: channel.isMedia,
    mediaPolicy,
    inRoom: channel.inRoom || [],
    created: channel.created,
    updated: channel.updated,
    owner: presentUser(channel.expand?.owner),
    room: channel.room,
    policy: channel.policy || "free",
    slow_mode: channel.slow_mode || 0,
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
    getBoundedList(pb, "dspeak_rooms_channels", {
      filter: `room = '${room.id}'`,
      expand: "owner",
      sort: "created",
    }),
    getBoundedList(pb, "dspeak_room_memberships", {
      filter: `room = '${room.id}'`,
      expand: "roles,user",
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
    members: memberships
      .map((membership) => membership.expand?.user)
      .filter(Boolean)
      .map((member) => ({
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
  const channels = await getBoundedList(pb, "dspeak_rooms_channels", {
    filter: `room = '${roomId}'`,
  });
  for (const channel of channels)
    broadcastToChannel(channel.id, { type: "participant_change" });
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
  usePocketBaseAdmin,
  validateInviteExpiry,
  validateRoomImage,
});

async function handleChannels(event, suffix) {
  const pb = await usePocketBaseAdmin();
  const userId = await requireAuthenticatedUser(event);
  const method = event.method;
  const query = getQuery(event);
  if (!["GET", "HEAD"].includes(method))
    enforceRateLimit(event, "channel-mutation", userId, 60, 60 * 1000);

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
    const channels = await getBoundedList(pb, "dspeak_rooms_channels", {
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
      media_policy: body.isMedia
        ? normalizeMediaPolicy(body.mediaPolicy)
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
        revision: normalizeMediaPolicy(channel.media_policy).revision + 1,
        updatedAt: new Date().toISOString(),
      };
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
    const channels = await getBoundedList(pb, "dspeak_rooms_channels", {
      filter: `room = '${channel.room}'`,
    });
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
  getBoundedList,
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
  usePocketBaseAdmin,
  pushAllowedHosts: configuredOutboundHosts(
    process.env.DSPEAK_PUSH_ALLOWED_HOSTS,
  ),
});

async function handleProfile(event, suffix) {
  const userId = await requireAuthenticatedUser(event);
  const pb = await usePocketBaseAdmin();
  if (!["GET", "HEAD"].includes(event.method))
    enforceRateLimit(event, "profile-mutation", userId, 30, 60 * 60 * 1000);

  if (!suffix && event.method === "GET") {
    return presentUser(await pb.collection("users").getOne(userId));
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
      await validateRoomImage(
        body.avatar,
        5 * 1024 * 1024,
        "Profile picture",
        true,
      );
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
      const profile = presentUser(updatedUser);
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
    const records = await getBoundedList(pb, "dspeak_user_nicknames", {
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
    const existing = await getBoundedList(pb, "dspeak_user_nicknames", {
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
  if (event.method !== "GET")
    throw createError({
      statusCode: 404,
      statusMessage: "Asset endpoint not found",
    });

  const authenticatedUserId = await requireAuthenticatedUser(event);
  const query = getQuery(event);
  const pb = await usePocketBaseAdmin();
  if (suffix === "chat-file") {
    const fileId = requireValue(query.id, "Chat file ID is required");
    const record = await pb.collection("dspeak_chat_files").getOne(fileId);
    const channel = await pb
      .collection("dspeak_rooms_channels")
      .getOne(record.room_channel);
    await requireRoomMember(
      pb,
      await pb.collection("dspeak_rooms").getOne(channel.room),
      authenticatedUserId,
    );
    const response = await fetch(pb.files.getURL(record, record.file));
    if (!response.ok)
      throw createError({
        statusCode: response.status,
        statusMessage: "Failed to load chat image",
      });
    setHeader(event, "Cache-Control", "private, max-age=604800, immutable");
    setHeader(
      event,
      "Content-Type",
      response.headers.get("content-type") || record.mime_type,
    );
    setHeader(event, "X-Content-Type-Options", "nosniff");
    return sendWebResponse(event, response);
  }
  if (suffix !== "avatar")
    throw createError({
      statusCode: 404,
      statusMessage: "Asset endpoint not found",
    });
  const userId = requireValue(query.userId, "User ID is required");
  const requestedFileName = requireValue(
    query.fileName,
    "Avatar filename is required",
  );
  const user = await pb.collection("users").getOne(userId, {
    fields: "id,avatar,collectionId,collectionName",
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
  setHeader(event, "X-Content-Type-Options", "nosniff");
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
    if (
      domain === "session" &&
      suffix === "handoff/start" &&
      event.method === "POST"
    )
      return createAuthenticationHandoff(event);
    if (
      domain === "session" &&
      suffix === "handoff/exchange" &&
      event.method === "POST"
    ) {
      const body = await parseBody(event);
      return await exchangeAuthenticationHandoff(
        event,
        body.code,
        body.state,
        getHeader(event, "x-dspeak-device") || body.deviceId,
      );
    }
    if (domain === "session" && !suffix && event.method === "GET")
      return await restoreAuthenticatedSession(event);
    if (domain === "session" && !suffix && event.method === "DELETE")
      return await revokeAuthenticatedSession(event);
    if (domain === "config" && event.method === "GET") {
      const userId = await requireAuthenticatedUser(event);
      enforceRateLimit(event, "turn-credentials", userId, 12, 10 * 60 * 1000);
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
    if (Number(error?.status) >= 400 && Number(error?.status) < 500)
      throw createError({
        statusCode: Number(error.status),
        statusMessage:
          Number(error.status) === 404
            ? "Resource not found"
            : Number(error.status) === 409
              ? "Resource conflict"
              : "Invalid request",
      });
    const requestId = crypto.randomUUID();
    console.error(`[dSpeak API] request ${requestId}`, error);
    throw createError({
      statusCode: 500,
      statusMessage: "Internal Server Error",
      data: { code: "INTERNAL_ERROR", requestId },
    });
  }
}
