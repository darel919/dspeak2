import { requireAuthenticatedUser } from "../../../../utils/authentication.js";
import { usePocketBaseAdmin } from "../../../../utils/pocketbase.js";
import { requireRoomMember } from "../../../../utils/room-authorization.js";
import { getStreamManager } from "../../../../utils/stream-manager.js";
import { stopStreamRelay } from "../../../../integrations/stream-relay.js";
import { broadcastToChannel } from "../../../../utils/dspeak-realtime.js";

export default defineEventHandler(async (event) => {
  const userId = await requireAuthenticatedUser(event);
  const channelId = getRouterParam(event, "channelId");
  if (!channelId) {
    throw createError({
      statusCode: 400,
      statusMessage: "channelId is required",
    });
  }

  const pb = await usePocketBaseAdmin();

  let channel;
  try {
    channel = await pb.collection("dspeak_rooms_channels").getOne(channelId);
  } catch (error) {
    if (error?.status === 404 || error?.response?.status === 404) {
      throw createError({
        statusCode: 404,
        statusMessage: "Channel not found",
      });
    }
    throw error;
  }

  const room = await pb.collection("dspeak_rooms").getOne(channel.room);
  const access = await requireRoomMember(pb, room, userId);

  const isChannelOwner = String(channel.owner) === String(userId);
  const hasModerationPermission = access.permissions.includes(
    "channel.moderate_voice",
  );

  if (!isChannelOwner && !hasModerationPermission) {
    throw createError({
      statusCode: 403,
      statusMessage:
        "Only the channel owner or a moderator can stop the stream",
    });
  }

  const manager = getStreamManager();
  if (!manager.hasActiveStream(channelId)) {
    throw createError({
      statusCode: 409,
      statusMessage: "No active stream on this channel",
    });
  }

  await stopStreamRelay(channelId);

  await pb.collection("dspeak_rooms_channels").update(channelId, {
    stream_active: false,
    stream_metadata: null,
  });

  broadcastToChannel(channelId, {
    type: "stream:stop",
    data: { channelId },
  });

  return { success: true };
});
