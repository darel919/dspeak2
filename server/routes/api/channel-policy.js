import { requireAuthenticatedUser } from "../../utils/auth.js";
import {
  requireRoomMember,
  requireRoomPermission,
  getChannelById,
  updateChannel,
  getRoomById,
} from "../../utils/room-authorization.js";
import { getChannelSubscribers } from "../../utils/dspeak-realtime.js";
import {
  normalizeChannelPolicy,
  normalizeSlowMode,
} from "../../../shared/channel-policy.js";

export default defineEventHandler(async (event) => {
  const userId = await requireAuthenticatedUser(event);
  const method = getMethod(event);

  if (method === "GET") {
    const channelId = getQuery(event).channelId;
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

    const updateData = {};
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

    const subscribers = getChannelSubscribers(channelId);
    const message = JSON.stringify({
      type: "channel_policy_updated",
      data: {
        channelId,
        ...updateData,
      },
    });
    for (const peer of subscribers) {
      try {
        peer.send(message);
      } catch {}
    }

    return {
      id: channelId,
      policy: updateData.policy || channel.policy,
      slow_mode: updateData.slowMode || channel.slowMode || 0,
    };
  }

  throw createError({ statusCode: 405, statusMessage: "Method not allowed" });
});
