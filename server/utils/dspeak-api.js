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
    getBoundedList(pb, "dspeak_rooms_channels", {
      filter: `room = '${room.id}'`,
      expand: "owner",
      sort: "created",
    }),
    getBoundedList(pb, "dspeak_room_memberships", {
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
  getBoundedList,
  getQuery,
  normalizeAttenuation,
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
  canDeleteMessage,
  canViewMessageHistory,
  createError,
  enforceRateLimit,
  ensureMember,
  getBoundedList,
  getHeader,
  getQuery,
  isMessageOwner,
  parseBody,
  persistMessageNotifications,
  pocketBaseError,
  presentUser,
  requireAuthenticatedUser,
  requireRoomMember,
  requireValue,
  sendPushTest,
  setResponseStatus,
  usePocketBaseAdmin,
});

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
