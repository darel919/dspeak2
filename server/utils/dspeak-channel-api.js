import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  channels,
  membershipRoles,
  profiles,
  roomMemberships,
  roomRoles,
} from "../db/schema/index.js";
import { getChannelById, getRoomById } from "./room-authorization.js";
import { canModerateVoiceMember } from "../../shared/room-policy.js";
import {
  normalizeChannelPolicy,
  normalizeSlowMode,
} from "../../shared/channel-policy.js";
import { validateMediaPolicy } from "../../shared/media-policy.js";

export function createChannelApiHandler(dependencies) {
  const {
    broadcastToChannel,
    broadcastToRoom,
    canModerateVoiceMember:
      canModerateVoiceMemberOverride = canModerateVoiceMember,
    createError,
    disconnectVoiceParticipant,
    enforceRateLimit,
    ensureMember,
    getQuery,
    isActiveVoiceParticipant,
    parseBody,
    presentChannel,
    presentUser,
    requireAuthenticatedUser,
    requireRoomPermission,
    requireValue,
    setResponseStatus,
    moderateVoiceParticipant,
  } = dependencies;

  async function roomRolesForUser(roomId, userId) {
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
      await ensureMember(room, userId);
      return presentChannel(channel);
    }

    if (!suffix && method === "GET") {
      const roomId = requireValue(query.roomId, "Room ID is required");
      const room = await getRoomById(roomId);
      if (!room)
        throw createError({ statusCode: 404, statusMessage: "Room not found" });
      await ensureMember(room, userId);
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
      const targetRoles = await roomRolesForUser(room.id, targetUserId);
      if (
        !canModerateVoiceMemberOverride(
          access.roles,
          targetRoles,
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
          statusMessage:
            "The user is no longer connected to this voice channel",
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
            statusMessage:
              "The user is already connected to that voice channel",
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
          description: body.desc ? String(body.desc) : "",
          type:
            body.isMedia === true || body.isMedia === "true" ? "voice" : "text",
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
      if (body.policy !== undefined)
        update.policy = normalizeChannelPolicy(body.policy);
      if (body.slowMode !== undefined)
        update.slowMode = normalizeSlowMode(body.slowMode);
      if (body.mediaPolicy && ["voice", "stage"].includes(channel.type)) {
        await requireRoomPermission(
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
      await ensureMember(room, userId);
      const current = (channel.inRoom || []).map(String);
      const normalizedUserId = String(userId);
      const joined = current.includes(normalizedUserId);
      const nextInRoom =
        suffix === "join"
          ? joined
            ? current
            : [...current, normalizedUserId]
          : current.filter((id) => id !== normalizedUserId);
      await db
        .update(channels)
        .set({ inRoom: nextInRoom })
        .where(eq(channels.id, channel.id));
      const inRoom = nextInRoom;
      const isMediaChannel = ["voice", "stage"].includes(channel.type);
      if (suffix === "leave" && isMediaChannel) {
        try {
          await disconnectVoiceParticipant(channel.id, String(userId));
        } catch (providerError) {
          console.error(
            "[ChannelJoin] Media provider disconnect failed",
            providerError,
          );
        }
      }
      let voiceProfiles = [];
      if (inRoom.length) {
        try {
          const profileRows = await db
            .select()
            .from(profiles)
            .where(inArray(profiles.id, inRoom));
          voiceProfiles = profileRows.map(presentUser).filter(Boolean);
        } catch (profileError) {
          console.error(
            "[ChannelJoin] Unable to load voice presence profiles",
            profileError,
          );
        }
      }
      await Promise.all([
        broadcastToChannel(channel.id, { type: "currentlyInChannel", inRoom }),
        broadcastToRoom(room.id, {
          type: "voice-presence",
          data: {
            channelId: String(channel.id),
            inRoom,
            profiles: voiceProfiles,
            participantStates: [],
          },
        }),
      ]);
      return {
        message: `Successfully ${suffix === "join" ? "joined" : "left"} the channel`,
      };
    }

    throw createError({
      statusCode: 404,
      statusMessage: "Channel endpoint not found",
    });
  }

  return handleChannels;
}
