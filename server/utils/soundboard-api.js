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
import { db } from "../db/client.js";
import {
  rooms,
  channels,
  roomSoundboards,
  roomMemberships,
  roomRoles,
  membershipRoles,
} from "../db/schema/index.js";
import { eq, and, desc, asc, inArray } from "drizzle-orm";
import {
  convertSoundboardIcon,
  convertSoundboardSource,
} from "./soundboard-conversion.js";
import { requireAuthenticatedUser } from "./auth.js";
import { enforceRateLimit } from "./rate-limit.js";

const uploadLocks = new Map();

function withRoomUploadLock(roomId, operation) {
  const previous = uploadLocks.get(roomId) || Promise.resolve();
  const result = previous.catch(() => {}).then(operation);
  uploadLocks.set(roomId, result);
  return result.finally(() => {
    if (uploadLocks.get(roomId) === result) uploadLocks.delete(roomId);
  });
}

async function getRoomAccess(roomId, userId) {
  const room = await db
    .select()
    .from(rooms)
    .where(eq(rooms.id, roomId))
    .limit(1);
  if (!room[0]) {
    throw createError({
      statusCode: 404,
      statusMessage: "Room not found",
    });
  }

  const isOwner = String(room[0].ownerId) === String(userId);

  const membership = await db
    .select({
      id: roomMemberships.id,
      userId: roomMemberships.userId,
      roomId: roomMemberships.roomId,
      roleId: membershipRoles.roleId,
      roleName: roomRoles.name,
      roleColor: roomRoles.color,
      rolePosition: roomRoles.position,
      rolePermissions: roomRoles.permissions,
      roleSystem: roomRoles.system,
      roleIsDefault: roomRoles.isDefault,
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

  const roles = membership
    .filter((m) => m.roleId)
    .map((m) => ({
      id: m.roleId,
      name: m.roleName,
      color: m.roleColor,
      position: m.rolePosition,
      permissions: m.rolePermissions,
      system: m.roleSystem,
      isDefault: m.roleIsDefault,
    }));

  const { getEffectivePermissions } =
    await import("../../shared/room-policy.js");
  const permissions = getEffectivePermissions(roles, isOwner);

  return { room: room[0], permissions, isOwner };
}

async function context(roomId, userId, permission = null) {
  if (!roomId)
    throw createError({
      statusCode: 400,
      statusMessage: "Room ID is required",
    });
  const { room, permissions } = await getRoomAccess(roomId, userId);
  if (permission && !permissions.includes(permission))
    throw createError({
      statusCode: 403,
      statusMessage: `Missing room permission: ${permission}`,
    });
  return room;
}

async function clipContext(clipId, userId, permission = null) {
  if (!clipId)
    throw createError({
      statusCode: 400,
      statusMessage: "Soundboard clip ID is required",
    });
  const clip = await db
    .select()
    .from(roomSoundboards)
    .where(eq(roomSoundboards.id, clipId))
    .limit(1);
  if (!clip[0])
    throw createError({
      statusCode: 404,
      statusMessage: "Soundboard clip not found",
    });
  const room = await context(clip[0].roomId, userId, permission);
  return { clip: clip[0], room };
}

async function requireClipManager(clip, userId) {
  const { permissions } = await getRoomAccess(clip.roomId, userId);
  if (!canManageSoundboardClip(clip, userId, permissions))
    throw createError({
      statusCode: 403,
      statusMessage:
        "Only the uploader or a room soundboard manager can manage this clip",
    });
}

async function listClips(roomId, userId) {
  const room = await context(roomId, userId);
  const { permissions } = await getRoomAccess(roomId, userId);
  const canManageRoom = permissions.includes("room.manage_soundboard");
  const records = await db
    .select()
    .from(roomSoundboards)
    .where(eq(roomSoundboards.roomId, roomId))
    .orderBy(asc(roomSoundboards.displayOrder), asc(roomSoundboards.createdAt));

  return {
    canManageRoom,
    clips: records.map((record) => ({
      ...presentSoundboardClip(record),
      canManage: canManageSoundboardClip(record, userId, permissions),
    })),
  };
}

async function uploadClip(event, userId) {
  const form = await readFormData(event);
  const roomId = String(form.get("roomId") || "");
  await context(roomId, userId);
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
    const existing = await db
      .select({
        id: roomSoundboards.id,
        displayOrder: roomSoundboards.displayOrder,
      })
      .from(roomSoundboards)
      .where(eq(roomSoundboards.roomId, roomId))
      .limit(SOUNDBOARD_MAX_CLIPS_PER_ROOM);
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

    const result = await db
      .insert(roomSoundboards)
      .values({
        roomId,
        uploaderId: userId,
        title: metadata.title,
        category: metadata.category,
        icon: metadata.icon,
        iconImageKey: convertedIcon
          ? `soundboards/${roomId}/icons/${crypto.randomUUID()}.ico`
          : null,
        duration: converted.duration,
        displayOrder: existing.length,
        enabled: true,
      })
      .returning();

    const created = result[0];

    await broadcastLibraryUpdate(roomId);
    setResponseStatus(event, 201);
    return presentSoundboardClip(created);
  });
}

async function broadcastLibraryUpdate(roomId) {
  const mediaChannels = await db
    .select({ id: channels.id })
    .from(channels)
    .where(and(eq(channels.roomId, roomId), eq(channels.isMedia, true)));

  await Promise.all(
    mediaChannels.map((channel) =>
      broadcastVoiceChannelEvent(channel.id, "soundboard-library-updated", {
        roomId: String(roomId),
      }),
    ),
  );
}

async function updateClip(event, userId) {
  const contentType = getHeader(event, "content-type") || "";
  const body = contentType.includes("multipart/form-data")
    ? Object.fromEntries((await readFormData(event)).entries())
    : (await readBody(event)) || {};
  const { clip } = await clipContext(body.id, userId);
  await requireClipManager(clip, userId);
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
    !clip.iconImageKey &&
    !convertedIcon
  )
    throw createError({
      statusCode: 400,
      statusMessage: "A clip must retain an emoji or icon image",
    });
  if (body.enabled !== undefined)
    update.enabled = body.enabled === true || body.enabled === "true";
  if (body.order !== undefined)
    update.displayOrder = Math.max(0, Math.floor(Number(body.order) || 0));

  if (convertedIcon) {
    update.iconImageKey = `soundboards/${clip.roomId}/icons/${crypto.randomUUID()}.ico`;
  }

  const result = await db
    .update(roomSoundboards)
    .set({ ...update, updatedAt: new Date() })
    .where(eq(roomSoundboards.id, clip.id))
    .returning();

  const updated = result[0];

  await broadcastLibraryUpdate(clip.roomId);
  return presentSoundboardClip(updated);
}

async function deleteClip(userId, clipId) {
  const { clip } = await clipContext(clipId, userId);
  await requireClipManager(clip, userId);
  await db.delete(roomSoundboards).where(eq(roomSoundboards.id, clip.id));
  await broadcastLibraryUpdate(clip.roomId);
  return { success: true };
}

async function media(event, userId, clipId) {
  const { clip } = await clipContext(clipId, userId);
  if (!clip.mediaKey)
    throw createError({
      statusCode: 404,
      statusMessage: "Soundboard media not found",
    });
  const { createDownloadUrl } = await import("../storage/r2.js");
  const url = await createDownloadUrl(clip.mediaKey);
  return sendRedirect(event, url, 302);
}

async function iconMedia(event, userId, clipId) {
  const { clip } = await clipContext(clipId, userId);
  if (!clip.iconImageKey)
    throw createError({
      statusCode: 404,
      statusMessage: "Soundboard icon not found",
    });
  const { createDownloadUrl } = await import("../storage/r2.js");
  const url = await createDownloadUrl(clip.iconImageKey);
  return sendRedirect(event, url, 302);
}

async function trigger(userId, body) {
  const { clip } = await clipContext(body.id, userId);
  if (!clip.enabled)
    throw createError({
      statusCode: 409,
      statusMessage: "This soundboard clip is disabled",
    });
  const channelId = String(body.channelId || "");
  const channel = await db
    .select()
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);
  if (!channel[0])
    throw createError({
      statusCode: 404,
      statusMessage: "Channel not found",
    });
  if (!channel[0].isMedia || String(channel[0].roomId) !== String(clip.roomId))
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
    roomId: String(clip.roomId),
    channelId,
    triggeredBy: String(userId),
  });
  return { success: true };
}

export async function handleSoundboardApi(event, suffix = "") {
  const userId = await requireAuthenticatedUser(event);
  const method = event.method;
  const query = getQuery(event);
  if (!["GET", "HEAD"].includes(method))
    enforceRateLimit(event, "soundboard-mutation", userId, 30, 60 * 60 * 1000);
  if (!suffix && method === "POST")
    enforceRateLimit(
      event,
      "soundboard-conversion",
      userId,
      10,
      60 * 60 * 1000,
    );
  if (!suffix && method === "GET")
    return listClips(String(query.roomId || ""), userId);
  if (!suffix && method === "POST") return uploadClip(event, userId);
  if (!suffix && method === "PUT") return updateClip(event, userId);
  if (!suffix && method === "DELETE")
    return deleteClip(userId, String(query.id || ""));
  if (suffix === "media" && method === "GET")
    return media(event, userId, String(query.id || ""));
  if (suffix === "icon" && method === "GET")
    return iconMedia(event, userId, String(query.id || ""));
  if (suffix === "trigger" && method === "POST")
    return trigger(userId, (await readBody(event)) || {});
  throw createError({
    statusCode: 405,
    statusMessage: "Soundboard method not allowed",
  });
}
