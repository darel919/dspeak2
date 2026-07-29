import {
  generateStreamKey,
  getStreamManager,
} from "../utils/stream-manager.js";
import { processStreamMetadata } from "./stream-metadata.js";
import { stopStreamRelay } from "./stream-relay.js";
import { broadcastToChannel } from "../utils/dspeak-realtime.js";

export async function handleStreamCommand(
  event,
  pb,
  userId,
  channelId,
  command,
  args,
) {
  const name = (command || "").toLowerCase().trim();

  switch (name) {
    case "/streamkey":
      return handleGetStreamKey(pb, userId, channelId, args);

    case "/streamkey rotate":
      return handleRotateStreamKey(pb, userId, channelId);

    case "/stopstream":
      return handleStopStream(pb, userId, channelId);

    case "/np":
      return handleNowPlaying(pb, userId, channelId, args);

    default:
      return { error: `Unknown stream command: ${command}` };
  }
}

async function handleGetStreamKey(pb, userId, channelId, args) {
  const parts = (args || "").trim().split(/\s+/);
  if (parts[0]?.toLowerCase() === "rotate") {
    return handleRotateStreamKey(pb, userId, channelId);
  }

  await assertChannelModerator(pb, userId, channelId);

  const channel = await pb
    .collection("dspeak_rooms_channels")
    .getOne(channelId);
  let streamKey = channel.stream_key;
  const config = useRuntimeConfig();
  const host = config.stream?.rtmpHost || "localhost";
  const port = config.stream?.rtmpPort || 1935;

  if (!streamKey) {
    streamKey = generateStreamKey();
    await pb.collection("dspeak_rooms_channels").update(channelId, {
      stream_key: streamKey,
    });
  }

  return {
    streamKey,
    rtmpUrl: `rtmp://${host}:${port}/${streamKey}`,
  };
}

async function handleRotateStreamKey(pb, userId, channelId) {
  await assertChannelModerator(pb, userId, channelId);

  const manager = getStreamManager();
  if (manager.hasActiveStream(channelId)) {
    await stopStreamRelay(channelId);
  }

  const newKey = generateStreamKey();
  await pb.collection("dspeak_rooms_channels").update(channelId, {
    stream_key: newKey,
    stream_active: false,
  });

  const config = useRuntimeConfig();
  const host = config.stream?.rtmpHost || "localhost";
  const port = config.stream?.rtmpPort || 1935;
  return {
    streamKey: newKey,
    rtmpUrl: `rtmp://${host}:${port}/${newKey}`,
    rotated: true,
  };
}

async function handleStopStream(pb, userId, channelId) {
  await assertChannelModerator(pb, userId, channelId);

  const manager = getStreamManager();
  if (!manager.hasActiveStream(channelId)) {
    return { error: "No active stream on this channel" };
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
}

async function handleNowPlaying(pb, userId, channelId, args) {
  const isModerator = await isChannelModerator(pb, userId, channelId);
  if (!isModerator) {
    return {
      error: "Only channel moderators can update the now playing",
    };
  }

  const parsed = parseArtistTitle(args);
  if (!parsed) {
    return { error: "Usage: /np Artist - Title" };
  }

  // Validate and sanitize input: max 200 chars each, strip control characters
  const MAX_LENGTH = 200;
  const sanitize = (str) =>
    str
      .replace(/[\x00-\x1F\x7F]/g, "") // Remove control characters
      .trim()
      .slice(0, MAX_LENGTH);

  const artist = sanitize(parsed.artist);
  const title = sanitize(parsed.title);

  if (!artist || !title) {
    return { error: "Artist and title must not be empty after sanitization" };
  }

  const metadata = await processStreamMetadata(pb, title, artist);

  await pb.collection("dspeak_rooms_channels").update(channelId, {
    stream_metadata: {
      title: metadata.title,
      artist: metadata.artist,
      album: metadata.album,
      albumArtUrl: metadata.albumArtUrl,
      lastChanged: new Date().toISOString(),
    },
  });

  broadcastToChannel(channelId, {
    type: "stream:metadata",
    data: metadata,
  });

  return metadata;
}

function parseArtistTitle(args) {
  const raw = (args || "").trim();
  if (!raw) return null;

  const dashIndex = raw.indexOf(" - ");
  if (dashIndex === -1) {
    return { artist: raw, title: raw };
  }

  return {
    artist: raw.slice(0, dashIndex).trim(),
    title: raw.slice(dashIndex + 3).trim(),
  };
}

async function assertChannelModerator(pb, userId, channelId) {
  const isModerator = await isChannelModerator(pb, userId, channelId);
  if (!isModerator) {
    throw createError({
      statusCode: 403,
      statusMessage: "Only channel moderators can perform this action",
    });
  }
}

async function isChannelModerator(pb, userId, channelId) {
  try {
    const channel = await pb
      .collection("dspeak_rooms_channels")
      .getOne(channelId);
    if (String(channel.owner) === String(userId)) return true;

    const room = await pb.collection("dspeak_rooms").getOne(channel.room);
    if (String(room.owner) === String(userId)) return true;

    const membership = await pb
      .collection("dspeak_room_memberships")
      .getFirstListItem(`room = '${channel.room}' && user = '${userId}'`, {
        expand: "roles",
      });

    const roles = membership.expand?.roles || [];
    return roles.some(
      (role) =>
        role.permissions?.includes("manage_channels") ||
        role.permissions?.includes("moderate"),
    );
  } catch (error) {
    if (error?.status === 404 || error?.response?.status === 404) return false;
    console.error("[StreamCommands] permission check failed", error);
    return false;
  }
}
