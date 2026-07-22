import {
  canManageSoundboardClip,
  normalizeSoundboardMetadata,
  normalizeSoundboardText,
  presentSoundboardClip,
  SOUNDBOARD_MAX_CLIPS_PER_ROOM,
} from "../../shared/soundboard.js";
import {
  broadcastVoiceChannelEvent,
  isActiveVoiceParticipant,
} from "./mediasoup-sfu.js";
import { usePocketBaseAdmin } from "./pocketbase.js";
import {
  requireRoomMember,
  requireRoomPermission,
} from "./room-authorization.js";
import {
  convertSoundboardIcon,
  convertSoundboardSource,
} from "./soundboard-conversion.js";

const uploadLocks = new Map();

function withRoomUploadLock(roomId, operation) {
  const previous = uploadLocks.get(roomId) || Promise.resolve();
  const result = previous.catch(() => {}).then(operation);
  uploadLocks.set(roomId, result);
  return result.finally(() => {
    if (uploadLocks.get(roomId) === result) uploadLocks.delete(roomId);
  });
}

function requireUser(event) {
  const userId = getHeader(event, "authorization");
  if (!userId)
    throw createError({ statusCode: 403, statusMessage: "Not Authorized" });
  return userId;
}

async function context(pb, roomId, userId, permission = null) {
  if (!roomId)
    throw createError({
      statusCode: 400,
      statusMessage: "Room ID is required",
    });
  const room = await pb.collection("dspeak_rooms").getOne(roomId);
  if (permission) await requireRoomPermission(pb, room, userId, permission);
  else await requireRoomMember(pb, room, userId);
  return room;
}

async function clipContext(pb, clipId, userId, permission = null) {
  if (!clipId)
    throw createError({
      statusCode: 400,
      statusMessage: "Soundboard clip ID is required",
    });
  const clip = await pb.collection("dspeak_room_soundboards").getOne(clipId, {
    expand: "uploader",
  });
  const room = await context(pb, clip.room, userId, permission);
  return { clip, room };
}

async function requireClipManager(pb, clip, userId) {
  const room = await pb.collection("dspeak_rooms").getOne(clip.room);
  const access = await requireRoomMember(pb, room, userId);
  if (!canManageSoundboardClip(clip, userId, access.permissions))
    throw createError({
      statusCode: 403,
      statusMessage:
        "Only the uploader or a room soundboard manager can manage this clip",
    });
  return access;
}

async function listClips(pb, roomId, userId) {
  const room = await context(pb, roomId, userId);
  const access = await requireRoomMember(pb, room, userId);
  const canManageRoom = access.permissions.includes("room.manage_soundboard");
  const records = await pb.collection("dspeak_room_soundboards").getFullList({
    filter: pb.filter("room = {:room}", { room: roomId }),
    sort: "display_order,created",
    expand: "uploader",
  });
  return {
    canManageRoom,
    clips: records.map((record) => ({
      ...presentSoundboardClip(record),
      canManage: canManageSoundboardClip(record, userId, access.permissions),
    })),
  };
}

async function uploadClip(event, pb, userId) {
  const form = await readFormData(event);
  const roomId = String(form.get("roomId") || "");
  await context(pb, roomId, userId);
  const source = form.get("media");
  const iconImage = form.get("iconImage");
  const metadata = normalizeSoundboardMetadata(
    Object.fromEntries(form.entries()),
  );
  if (!metadata.title)
    throw createError({
      statusCode: 400,
      statusMessage: "Clip title is required",
    });
  return withRoomUploadLock(roomId, async () => {
    const existing = await pb
      .collection("dspeak_room_soundboards")
      .getFullList({
        filter: pb.filter("room = {:room}", { room: roomId }),
        fields: "id,display_order",
      });
    if (!metadata.icon && !(iconImage instanceof File && iconImage.size))
      throw createError({
        statusCode: 400,
        statusMessage: "Choose an emoji or upload an icon image",
      });
    if (existing.length >= SOUNDBOARD_MAX_CLIPS_PER_ROOM)
      throw createError({
        statusCode: 409,
        statusMessage: "This room already has 50 soundboard clips",
      });
    const converted = await convertSoundboardSource(source);
    const convertedIcon =
      iconImage instanceof File && iconImage.size
        ? await convertSoundboardIcon(iconImage)
        : null;
    const payload = new FormData();
    payload.set("room", roomId);
    payload.set("uploader", userId);
    payload.set("title", metadata.title);
    payload.set("category", metadata.category);
    payload.set("icon", metadata.icon);
    payload.set("duration", String(converted.duration));
    payload.set("display_order", String(existing.length));
    payload.set("enabled", "true");
    payload.set(
      "media",
      new File([converted.bytes], "soundboard.ogg", { type: "audio/ogg" }),
    );
    if (convertedIcon)
      payload.set(
        "icon_image",
        new File([convertedIcon], "soundboard.ico", {
          type: "image/x-icon",
        }),
      );
    const created = await pb
      .collection("dspeak_room_soundboards")
      .create(payload, { expand: "uploader" });
    await broadcastLibraryUpdate(pb, roomId);
    setResponseStatus(event, 201);
    return presentSoundboardClip(created);
  });
}

async function broadcastLibraryUpdate(pb, roomId) {
  const channels = await pb.collection("dspeak_rooms_channels").getFullList({
    filter: pb.filter("room = {:room} && isMedia = true", { room: roomId }),
    fields: "id",
  });
  await Promise.all(
    channels.map((channel) =>
      broadcastVoiceChannelEvent(channel.id, "soundboard-library-updated", {
        roomId: String(roomId),
      }),
    ),
  );
}

async function updateClip(event, pb, userId) {
  const contentType = getHeader(event, "content-type") || "";
  const body = contentType.includes("multipart/form-data")
    ? Object.fromEntries((await readFormData(event)).entries())
    : (await readBody(event)) || {};
  const { clip } = await clipContext(pb, body.id, userId);
  await requireClipManager(pb, clip, userId);
  const update = {};
  if (body.title !== undefined) {
    update.title = normalizeSoundboardText(body.title, 48);
    if (!update.title)
      throw createError({
        statusCode: 400,
        statusMessage: "Clip title is required",
      });
  }
  if (body.category !== undefined)
    update.category = normalizeSoundboardText(body.category, 32, "General");
  if (body.icon !== undefined)
    update.icon = normalizeSoundboardText(body.icon, 16);
  const iconImage = body.iconImage;
  const convertedIcon =
    iconImage instanceof File && iconImage.size
      ? await convertSoundboardIcon(iconImage)
      : null;
  if (
    body.icon !== undefined &&
    !update.icon &&
    !clip.icon_image &&
    !convertedIcon
  )
    throw createError({
      statusCode: 400,
      statusMessage: "A clip must retain an emoji or icon image",
    });
  if (body.enabled !== undefined)
    update.enabled = body.enabled === true || body.enabled === "true";
  if (body.order !== undefined)
    update.display_order = Math.max(0, Math.floor(Number(body.order) || 0));
  let updatePayload = update;
  if (convertedIcon) {
    updatePayload = new FormData();
    for (const [key, value] of Object.entries(update))
      updatePayload.set(key, String(value));
    updatePayload.set(
      "icon_image",
      new File([convertedIcon], "soundboard.ico", { type: "image/x-icon" }),
    );
  }
  const updated = await pb
    .collection("dspeak_room_soundboards")
    .update(clip.id, updatePayload, {
      expand: "uploader",
    });
  await broadcastLibraryUpdate(pb, clip.room);
  return presentSoundboardClip(updated);
}

async function deleteClip(pb, userId, clipId) {
  const { clip } = await clipContext(pb, clipId, userId);
  await requireClipManager(pb, clip, userId);
  await pb.collection("dspeak_room_soundboards").delete(clip.id);
  await broadcastLibraryUpdate(pb, clip.room);
  return { success: true };
}

async function media(event, pb, userId, clipId) {
  const { clip } = await clipContext(pb, clipId, userId);
  if (!clip.media)
    throw createError({
      statusCode: 404,
      statusMessage: "Soundboard media not found",
    });
  const response = await fetch(pb.files.getURL(clip, clip.media));
  if (!response.ok)
    throw createError({
      statusCode: response.status,
      statusMessage: "Failed to load soundboard media",
    });
  setHeader(event, "Cache-Control", "private, no-store");
  setHeader(event, "Content-Type", "audio/ogg");
  setHeader(event, "Content-Disposition", "inline");
  return sendWebResponse(event, response);
}

async function iconMedia(event, pb, userId, clipId) {
  const { clip } = await clipContext(pb, clipId, userId);
  if (!clip.icon_image)
    throw createError({
      statusCode: 404,
      statusMessage: "Soundboard icon not found",
    });
  const response = await fetch(pb.files.getURL(clip, clip.icon_image));
  if (!response.ok)
    throw createError({
      statusCode: response.status,
      statusMessage: "Failed to load soundboard icon",
    });
  setHeader(event, "Cache-Control", "private, no-store");
  setHeader(event, "Content-Type", "image/x-icon");
  return sendWebResponse(event, response);
}

async function trigger(pb, userId, body) {
  const { clip } = await clipContext(pb, body.id, userId);
  if (!clip.enabled)
    throw createError({
      statusCode: 409,
      statusMessage: "This soundboard clip is disabled",
    });
  const channelId = String(body.channelId || "");
  const channel = await pb
    .collection("dspeak_rooms_channels")
    .getOne(channelId);
  if (!channel.isMedia || String(channel.room) !== String(clip.room))
    throw createError({
      statusCode: 403,
      statusMessage:
        "Soundboard clip and voice channel must belong to the same room",
    });
  if (!(await isActiveVoiceParticipant(channelId, userId)))
    throw createError({
      statusCode: 403,
      statusMessage: "Join this voice channel before using its soundboard",
    });
  await broadcastVoiceChannelEvent(channelId, "soundboard-triggered", {
    activityId: crypto.randomUUID(),
    clipId: clip.id,
    clipTitle: clip.title,
    clipIcon: clip.icon || "🔊",
    duration: Number(clip.duration) || 0,
    roomId: String(clip.room),
    channelId,
    triggeredBy: String(userId),
  });
  return { success: true };
}

export async function handleSoundboardApi(event, suffix = "") {
  const pb = await usePocketBaseAdmin();
  const userId = requireUser(event);
  const method = event.method;
  const query = getQuery(event);
  if (!suffix && method === "GET")
    return listClips(pb, String(query.roomId || ""), userId);
  if (!suffix && method === "POST") return uploadClip(event, pb, userId);
  if (!suffix && method === "PUT") return updateClip(event, pb, userId);
  if (!suffix && method === "DELETE")
    return deleteClip(pb, userId, String(query.id || ""));
  if (suffix === "media" && method === "GET")
    return media(event, pb, userId, String(query.id || ""));
  if (suffix === "icon" && method === "GET")
    return iconMedia(event, pb, userId, String(query.id || ""));
  if (suffix === "trigger" && method === "POST")
    return trigger(pb, userId, (await readBody(event)) || {});
  throw createError({
    statusCode: 405,
    statusMessage: "Soundboard method not allowed",
  });
}
