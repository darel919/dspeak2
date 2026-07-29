import { requireAuthenticatedUser } from "../../../../utils/authentication.js";
import { usePocketBaseAdmin } from "../../../../utils/pocketbase.js";
import { requireRoomMember } from "../../../../utils/room-authorization.js";
import {
  generateStreamKey,
  getStreamManager,
} from "../../../../utils/stream-manager.js";

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
        "Only the channel owner or a moderator can view the stream key",
    });
  }

  let streamKey = channel.stream_key;
  if (!streamKey) {
    streamKey = generateStreamKey();
    await pb.collection("dspeak_rooms_channels").update(channelId, {
      stream_key: streamKey,
    });
  }

  getStreamManager().registerStreamKey(channelId, streamKey);

  const config = useRuntimeConfig();
  const host = config.stream?.rtmpHost || "localhost";
  const port = config.stream?.rtmpPort || 1935;

  return {
    streamKey,
    streamActive: Boolean(channel.stream_active),
    rtmpUrl: `rtmp://${host}:${port}/${streamKey}`,
  };
});
