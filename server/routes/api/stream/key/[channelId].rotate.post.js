import { requireAuthenticatedUser } from "../../../../utils/authentication.js";
import { usePocketBaseAdmin } from "../../../../utils/pocketbase.js";
import { requireRoomMember } from "../../../../utils/room-authorization.js";
import { generateStreamKey } from "../../../../utils/stream-manager.js";
import { stopStreamRelay } from "../../../../integrations/stream-relay.js";

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
        "Only the channel owner or a moderator can rotate the stream key",
    });
  }

  if (channel.stream_active) {
    await stopStreamRelay(channelId);
  }

  const newKey = generateStreamKey();
  await pb.collection("dspeak_rooms_channels").update(channelId, {
    stream_key: newKey,
    stream_active: false,
  });

  const config = useRuntimeConfig();
  const host = config.public?.baseApiPath
    ? new URL(config.public.baseApiPath).hostname
    : "localhost";

  return {
    streamKey: newKey,
    rtmpUrl: `rtmp://${host}:1935/live/${newKey}`,
  };
});
