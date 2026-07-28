import { requireAuthenticatedUser } from "../../utils/authentication.js";
import {
  requireRoomMember,
  requireRoomPermission,
} from "../../utils/room-authorization.js";
import { usePocketBaseAdmin } from "../../utils/pocketbase.js";
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

    const pb = await usePocketBaseAdmin();
    const channel = await pb
      .collection("dspeak_rooms_channels")
      .getOne(channelId, {
        fields: "id,name,room,policy,slow_mode",
      });
    await requireRoomMember(pb, { id: channel.room }, userId);

    return {
      id: channel.id,
      name: channel.name,
      policy: channel.policy || "free",
      slow_mode: channel.slow_mode || 0,
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

    const pb = await usePocketBaseAdmin();
    const channel = await pb
      .collection("dspeak_rooms_channels")
      .getOne(channelId, {
        fields: "id,room,policy,slow_mode",
      });

    await requireRoomPermission(
      pb,
      { id: channel.room },
      userId,
      "channel.update",
    );

    const updateData = {};
    if (policy !== undefined) {
      updateData.policy = normalizeChannelPolicy(policy);
    }
    if (slowMode !== undefined) {
      updateData.slow_mode = normalizeSlowMode(slowMode);
    }

    if (Object.keys(updateData).length === 0) {
      return {
        id: channelId,
        policy: channel.policy,
        slow_mode: channel.slow_mode,
      };
    }

    await pb.collection("dspeak_rooms_channels").update(channelId, updateData);

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
      slow_mode: updateData.slow_mode || channel.slow_mode || 0,
    };
  }

  throw createError({ statusCode: 405, statusMessage: "Method not allowed" });
});
