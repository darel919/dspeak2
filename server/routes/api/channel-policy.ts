import { requireAuthenticatedUser } from "../../utils/auth.ts";
import {
  requireRoomMember,
  requireRoomPermission,
  getChannelById,
  updateChannel,
  getRoomById,
} from "../../utils/room-authorization.ts";
import { broadcastToChannel } from "../../utils/dspeak-realtime.ts";
import {
  normalizeChannelPolicy,
  normalizeSlowMode,
} from "../../../shared/channel-policy.ts";

export default defineEventHandler(async (event) => {
  const userId = await requireAuthenticatedUser(event);
  const method = getMethod(event);

  if (method === "GET") {
    const channelId = String(getQuery(event).channelId || "");
    if (!channelId) {
      throw createError({
        statusCode: 400,
        statusMessage: "channelId is required",
      });
    }

    const channel = await getChannelById(channelId);
    if (!channel) {
      throw createError({
        statusCode: 404,
        statusMessage: "Channel not found",
      });
    }

    const room = await getRoomById(channel.roomId);
    if (!room) {
      throw createError({ statusCode: 404, statusMessage: "Room not found" });
    }

    await requireRoomMember(room, userId);

    return {
      id: channel.id,
      name: channel.name,
      policy: channel.policy || "free",
      slow_mode: channel.slowMode || 0,
    };
  }

  if (method === "PUT") {
    const body = await readBody(event);
    const { channelId, policy, slowMode } = body;

    if (!channelId) {
      throw createError({
        statusCode: 400,
        statusMessage: "channelId is required",
      });
    }

    const channel = await getChannelById(channelId);
    if (!channel) {
      throw createError({
        statusCode: 404,
        statusMessage: "Channel not found",
      });
    }

    const room = await getRoomById(channel.roomId);
    if (!room) {
      throw createError({ statusCode: 404, statusMessage: "Room not found" });
    }

    await requireRoomPermission(room, userId, "channel.update");

    const updateData: { policy?: string; slowMode?: number } = {};
    if (policy !== undefined) {
      updateData.policy = normalizeChannelPolicy(policy);
    }
    if (slowMode !== undefined) {
      updateData.slowMode = normalizeSlowMode(slowMode);
    }

    if (Object.keys(updateData).length === 0) {
      return {
        id: channelId,
        policy: channel.policy,
        slow_mode: channel.slowMode || 0,
      };
    }

    await updateChannel(channelId, updateData);

    broadcastToChannel(channelId, {
      type: "channel_policy_updated",
      data: {
        channelId,
        ...updateData,
      },
    });

    return {
      id: channelId,
      policy: updateData.policy ?? channel.policy ?? "free",
      slow_mode: updateData.slowMode ?? channel.slowMode ?? 0,
    };
  }

  throw createError({ statusCode: 405, statusMessage: "Method not allowed" });
});
