import webpush from "web-push";
import { createIceServers } from "../const/ice-servers";
import {
  normalizeMediaPolicy,
  validateMediaPolicy,
} from "../../shared/media-policy.js";
import {
  normalizeAttenuation,
  normalizePermissions,
  normalizeRoomAccent,
} from "../../shared/room-policy.js";
import {
  normalizeDisplayName,
  normalizeHandle,
  normalizeNickname,
} from "../../shared/user-profile.js";
import {
  broadcastGlobally,
  broadcastToChannel,
  broadcastToUser,
} from "./dspeak-realtime";
import { updateActiveUserProfile } from "./mediasoup-sfu";
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

function requireUser(event) {
  const userId = getHeader(event, "authorization");
  if (!userId)
    throw createError({ statusCode: 403, statusMessage: "Not Authorized" });
  return userId;
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
  return `${authPrefix ? "auth/" : ""}assets/avatar?userId=${user.id}&fileName=${user.avatar}`;
}

function presentUser(user, authPrefix = false) {
  if (!user) return null;
  return { ...user, avatar: avatarPath(user, authPrefix) };
}

function presentPublicProfile(user) {
  return {
    id: String(user.id),
    name: user.display_name || user.name || user.username || "",
    display_name: user.display_name || user.name || user.username || "",
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
  const channels = await pb.collection("dspeak_rooms_channels").getFullList({
    filter: `room = '${room.id}'`,
    expand: "owner",
    sort: "created",
  });
  const access = userId ? await presentRoomAccess(pb, room, userId) : null;
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
    members: (room.expand?.members || []).map((member) => presentUser(member)),
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
    for (const role of membership.expand?.roles || [])
      await requireRoleManagement(pb, room, userId, role);
    const roleIds = Array.isArray(body.roleIds) ? body.roleIds : [];
    for (const roleId of roleIds) {
      const role = await pb.collection("dspeak_room_roles").getOne(roleId);
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

  if (suffix === "roles") return handleRoomRoles(event, pb, requireUser(event));

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
    await requireRoomMember(pb, room, requireUser(event));
    return roomDetails(pb, room, requireUser(event));
  }

  const userId = requireUser(event);

  if (!suffix && method === "GET") {
    const rooms = await pb.collection("dspeak_rooms").getFullList({
      filter: `owner = '${userId}' || members ~ '${userId}'`,
      expand: "owner,members",
    });
    return Promise.all(rooms.map((room) => roomDetails(pb, room, userId)));
  }

  const body = await parseBody(event);

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
      if (!members.includes(String(userId)))
        await pb
          .collection("dspeak_rooms")
          .update(room.id, { members: [...members, userId] });
      await ensureRoomMembership(pb, room, userId);
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
  const userId = requireUser(event);
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

  const body = await parseBody(event);

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

function configureWebPush() {
  const publicKey =
    process.env.VAPID_PUBKEY || useRuntimeConfig().pocketbase.vapidPublicKey;
  const privateKey =
    process.env.VAPID_PRIVKEY || useRuntimeConfig().pocketbase.vapidPrivateKey;
  if (publicKey && privateKey)
    webpush.setVapidDetails(
      "mailto:darrell.cristanto@gmail.com",
      publicKey,
      privateKey,
    );
  return Boolean(publicKey && privateKey);
}

async function sendPush(pb, room, channel, message, userId) {
  if (!configureWebPush()) return;
  const members = (room.members || []).map(String);
  if (!members.length) return;
  const subscriptions = await pb
    .collection("dspeak_webpush_global")
    .getFullList({
      filter: members.map((id) => `user = '${id}'`).join(" || "),
    });
  const payload = JSON.stringify({
    title: `New message in ${room.name} - ${channel.name}`,
    body: `${message.expand?.sender?.name || message.expand?.sender?.id || "Someone"}: ${message.content}`,
    data: { roomId: room.id, channelId: channel.id, senderId: userId },
  });
  await Promise.allSettled(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.keys.endpoint,
            keys: {
              p256dh: subscription.keys.p256dh,
              auth: subscription.keys.auth,
            },
          },
          payload,
        );
      } catch (error) {
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          await pb.collection("dspeak_webpush_global").delete(subscription.id);
        }
      }
    }),
  );
}

async function createMessageNotifications(
  pb,
  room,
  channel,
  message,
  senderId,
) {
  const recipients = (room.members || [])
    .map(String)
    .filter((id) => id !== String(senderId));
  for (const recipient of recipients) {
    try {
      const notification = await pb.collection("dspeak_notifications").create({
        recipient,
        type: "message",
        actor: senderId,
        room: room.id,
        channel: channel.id,
        message: message.id,
        title: `#${channel.name} · ${room.name}`,
        body: message.content,
        read_at: null,
      });
      broadcastToUser(recipient, {
        type: "notification_created",
        data: notification,
      });
    } catch (error) {
      if (error?.status !== 404 && error?.response?.status !== 404) throw error;
    }
  }
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
  if (!suffix && event.method === "GET") return "DSpeak Chat";
  if (suffix === "socket" && event.method === "GET")
    throw createError({ statusCode: 426, statusMessage: "Upgrade Required" });
  const pb = await usePocketBaseAdmin();
  const userId = requireUser(event);

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
    return Promise.all(
      channels.map(async (channel) => {
        const messages = await pb.collection("dspeak_messages").getFullList({
          filter: `room_channel = '${channel.id}'`,
          fields: "id,read_by",
        });
        return {
          channelId: channel.id,
          roomId: channel.room,
          unreadCount: messages.filter(
            (message) =>
              !(message.read_by || []).map(String).includes(String(userId)),
          ).length,
        };
      }),
    );
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
      read_by: (message.expand?.read_by || []).map((user) => presentUser(user)),
    }));
  }

  const body = await parseBody(event);

  if (suffix === "message" && event.method === "POST") {
    requireValue(body.channelId, "Channel ID and content are required");
    requireValue(body.content, "Channel ID and content are required");
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
    const created = await pb.collection("dspeak_messages").create({
      content: body.content,
      room_channel: channel.id,
      sender: userId,
      read_by: [userId],
    });
    const message = await pb
      .collection("dspeak_messages")
      .getOne(created.id, { expand: "sender" });
    const result = {
      id: message.id,
      content: message.content,
      room_channel: message.room_channel,
      sender: presentUser(message.expand?.sender, true),
      created: message.created,
      read_by: message.read_by || [],
    };
    broadcastToChannel(channel.id, { type: "new_message", data: result });
    createMessageNotifications(pb, room, channel, message, userId).catch(
      (error) => console.error("[Notifications]", error),
    );
    sendPush(pb, room, channel, message, userId).catch((error) =>
      console.error("[Push]", error),
    );
    setResponseStatus(event, 201);
    return result;
  }

  if (suffix === "read" && event.method === "POST") {
    const ids = Array.isArray(body.messageIds)
      ? body.messageIds
      : body.messageId
        ? [body.messageId]
        : [];
    requireValue(ids.length, "At least one message ID is required");
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
    const existing = await pb
      .collection("dspeak_webpush_global")
      .getFullList({ filter: `user = '${userId}'` });
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
      for (const subscription of existing)
        await pb.collection("dspeak_webpush_global").delete(subscription.id);
      return { success: true, message: "Global subscription deleted" };
    }
    if (event.method === "POST") {
      const subscription = requireValue(
        body.subscription,
        "Subscription is required",
      );
      const data = {
        keys: {
          endpoint: subscription.endpoint,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
        },
      };
      if (existing[0])
        await pb
          .collection("dspeak_webpush_global")
          .update(existing[0].id, data);
      else
        await pb
          .collection("dspeak_webpush_global")
          .create({ user: userId, ...data });
      setResponseStatus(event, 201);
      return { success: true, message: "Global subscription updated" };
    }
  }

  if (suffix === "subscribe" && event.method === "POST") {
    requireValue(body.roomId, "Room ID and subscription are required");
    requireValue(body.subscription, "Room ID and subscription are required");
    const existing = await pb
      .collection("dspeak_webpush")
      .getFullList({ filter: `room = '${body.roomId}' && user = '${userId}'` });
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
  const userId = requireUser(event);
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

export async function handleDspeakApi(event) {
  const path = String(getRouterParam(event, "path") || "").replace(
    /^\/+|\/+$/g,
    "",
  );
  const [domain = "", ...rest] = path.split("/");
  const suffix = rest.join("/");

  try {
    if (!domain && event.method === "GET") return "DSpeak ready.";
    if (domain === "config" && event.method === "GET")
      return createIceServers();
    if (domain === "room") return await handleRooms(event, suffix);
    if (domain === "channel") return await handleChannels(event, suffix);
    if (domain === "chat") return await handleChat(event, suffix);
    if (domain === "profile") return await handleProfile(event, suffix);
    if (domain === "soundboard")
      return await handleSoundboardApi(event, suffix);
    throw createError({
      statusCode: 404,
      statusMessage: "DSpeak endpoint not found",
    });
  } catch (error) {
    if (error?.statusCode) throw error;
    console.error("[DSpeak API]", error);
    throw createError({
      statusCode: error?.status || 500,
      statusMessage: error?.message || "Internal Server Error",
      data: pocketBaseError(error),
    });
  }
}
