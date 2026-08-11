import { createRoomsApiHandler } from "./dspeak-rooms-api.ts";
import { createChatApiHandler } from "./dspeak-chat-api.ts";
import { createChannelApiHandler } from "./dspeak-channel-api.ts";
import { createProfileApiHandler } from "./dspeak-profile-api.ts";
import {
  canManageMember,
  canModerateVoiceMember,
  normalizeAttenuation,
  normalizePermissions,
  normalizeRoomAccent,
} from "../../shared/room-policy.ts";
import { normalizeMediaPolicy } from "../../shared/media-policy.ts";
import { publicDisplayName } from "../../shared/user-profile.ts";
import {
  broadcastGlobally,
  broadcastToChannel,
  broadcastToRoom,
  broadcastToUser,
} from "./dspeak-realtime.ts";
import { persistMessageNotifications, sendPushTest } from "./push-delivery.ts";
import { requireAuthenticatedUser } from "./auth.ts";
import {
  disconnectVoiceParticipant,
  isActiveVoiceParticipant,
  moderateVoiceParticipant,
  updateActiveUserProfile,
} from "./media-control-admin.ts";
import {
  presentRoomAccess,
  removeRoomMembership,
  requireRoleManagement,
  requireRoomMember,
  requireRoomPermission,
  seedRoomRoles,
} from "./room-authorization.ts";
import { handleSoundboardApi } from "./soundboard-api.ts";
import { handleAssets } from "./dspeak-assets-api.ts";
import {
  decodeInvitePayload,
  encodeInvitePayload,
  validateInviteExpiry,
} from "../../shared/room-invite.ts";
import { enforceRateLimit } from "./rate-limit.ts";
import { createIceServers } from "../const/ice-servers.ts";
import {
  canDeleteMessage,
  canViewMessageHistory,
  isMessageOwner,
} from "../../shared/message-policy.ts";
import {
  assertSafeOutboundUrl,
  configuredOutboundHosts,
  fetchPublicHtml,
} from "../infrastructure/network/outbound-request.ts";
import { db } from "../db/client.ts";
import { asc, and, eq, inArray } from "drizzle-orm";
import {
  channels,
  membershipRoles,
  profiles,
  roomImages,
  roomMemberships,
  roomRoles,
} from "../db/schema/index.ts";

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

function structuredValue(value, fallback = {} as any) {
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
  const inRoom = (channel.inRoom || []).map(String);
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
    policy: channel.policy || "free",
    slow_mode: channel.slowMode || 0,
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

async function roomDetails(room, userId = null) {
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
        .map((membership) => String(membership.userId))
        .concat(room.ownerId ? [String(room.ownerId)] : []),
    ),
  ];
  const profileRows = userIds.length
    ? await db.select().from(profiles).where(inArray(profiles.id, userIds))
    : [];
  const profileById = new Map(
    profileRows.map((profile) => [String(profile.id), profile]),
  );
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
  const imageByType = new Map(
    imageRows.map((image) => [image.type, image.r2Key]),
  );
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
  for (const channel of channelRows)
    broadcastToChannel(channel.id, { type: "participant_change" });
}

const handleRooms = createRoomsApiHandler({
  broadcastGlobally,
  broadcastParticipantChange,
  canManageMember,
  createError,
  decodeInvitePayload,
  encodeInvitePayload,
  enforceRateLimit,
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
  validateInviteExpiry,
});

const handleChannels = createChannelApiHandler({
  broadcastToChannel,
  broadcastToRoom,
  canModerateVoiceMember,
  createError,
  disconnectVoiceParticipant,
  enforceRateLimit,
  ensureMember: requireRoomMember,
  getQuery,
  isActiveVoiceParticipant,
  moderateVoiceParticipant,
  parseBody,
  presentChannel,
  presentUser,
  requireAuthenticatedUser,
  requireRoomPermission,
  requireValue,
  setResponseStatus,
});

const handleChat = createChatApiHandler({
  broadcastToChannel,
  broadcastToUser,
  assertSafeOutboundUrl,
  canDeleteMessage,
  canViewMessageHistory,
  createError,
  enforceRateLimit,
  ensureMember: requireRoomMember,
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
  pushAllowedHosts: configuredOutboundHosts(
    process.env.DSPEAK_PUSH_ALLOWED_HOSTS,
  ),
});

const handleProfile = createProfileApiHandler({
  broadcastGlobally,
  createError,
  enforceRateLimit,
  parseBody,
  presentPublicProfile,
  presentUser,
  requireAuthenticatedUser,
  requireRoomMember,
  requireValue,
  updateActiveUserProfile,
  updateProfileAvatar,
});

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
      const query = getQuery(event);
      const connectionMode = query.connectionMode || "auto";
      return createIceServers(process.env, Date.now(), { connectionMode });
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
      stack: "",
    });
  }
}
