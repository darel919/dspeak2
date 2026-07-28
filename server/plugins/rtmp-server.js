import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import NodeMediaServer from "node-media-server";
import { getStreamManager } from "../utils/stream-manager.js";
import { usePocketBaseAdmin } from "../utils/pocketbase.js";
import {
  startStreamRelay,
  stopStreamRelay,
  getChannelBitrate,
} from "../integrations/stream-relay.js";
import {
  processStreamMetadata,
  logPlayToHistory,
} from "../integrations/stream-metadata.js";
import { getSfuRouter } from "../utils/mediasoup-sfu.js";
import { broadcastToChannel } from "../utils/dspeak-realtime.js";

const _require = createRequire(import.meta.url);
const amfPath = resolve(
  dirname(fileURLToPath(_require.resolve("node-media-server"))),
  "src/node_core_amf",
);
const AMF = _require(amfPath);

const METADATA_POLL_INTERVAL_MS = 3000;

function decodeSessionMetaData(session) {
  if (!session?.metaData) return null;
  try {
    const decoded = AMF.decodeAmf0Data(session.metaData);
    if (decoded?.cmd === "onMetaData" && decoded?.dataObj) {
      return decoded.dataObj;
    }
    return null;
  } catch {
    return null;
  }
}

export default defineNitroPlugin(() => {
  const config = useRuntimeConfig();
  const rtmpPort = config.stream?.rtmpPort || 1935;

  const nms = new NodeMediaServer({
    rtmp: {
      port: rtmpPort,
      chunk_size: 60000,
      gop_cache: true,
      ping: 30,
      ping_timeout: 60,
    },
  });

  nms.on("preConnect", (id, args) => {
    console.debug("[RTMP] preConnect", id);
  });

  nms.on("postConnect", (id, args) => {
    console.log("[RTMP] Client connected:", id);
  });

  nms.on("doneConnect", (id, args) => {
    console.log("[RTMP] Client disconnected:", id);
  });

  nms.on("prePublish", (id, StreamPath, args) => {
    const streamKey = StreamPath.split("/").pop();
    const manager = getStreamManager();
    const channelId = manager.getStreamByKey(streamKey);
    if (!channelId) {
      console.log(
        "[RTMP] Rejecting publish for unknown stream key:",
        streamKey,
      );
      return false;
    }
    if (manager.hasActiveStream(channelId)) {
      console.log("[RTMP] Rejecting duplicate stream for channel:", channelId);
      return false;
    }
    console.log("[RTMP] Accepting publish for channel:", channelId);
  });

  nms.on("postPublish", async (id, StreamPath, args) => {
    const streamKey = StreamPath.split("/").pop();
    const manager = getStreamManager();
    const channelId = manager.getStreamByKey(streamKey);
    if (!channelId) return;

    try {
      const pb = await usePocketBaseAdmin();
      const channel = await pb
        .collection("dspeak_rooms_channels")
        .getOne(channelId);
      const bitrate = getChannelBitrate(channel);

      manager.registerStream(channelId, {
        channelId,
        streamKey,
        bitrate,
        startedAt: new Date().toISOString(),
      });

      await pb.collection("dspeak_rooms_channels").update(channelId, {
        stream_active: true,
      });

      const router = await getSfuRouter(channelId);
      if (router) {
        await startStreamRelay(router, channelId, streamKey, bitrate);
      } else {
        console.warn(
          "[RTMP] No SFU router found for channel:",
          channelId,
          "- audio will not be relayed until a participant joins",
        );
      }

      console.log("[RTMP] Stream started for channel:", channelId);

      broadcastToChannel(channelId, {
        type: "stream:start",
        data: { channelId },
      });

      const session = nms.getSession(id);
      if (session) {
        startMetadataPolling(session, channelId, pb);
      }
    } catch (error) {
      console.error("[RTMP] Error starting stream relay:", error);
    }
  });

  nms.on("donePublish", async (id, StreamPath, args) => {
    const streamKey = StreamPath.split("/").pop();
    const manager = getStreamManager();
    const channelId = manager.getStreamByKey(streamKey);
    if (!channelId) return;

    try {
      const session = nms.getSession(id);
      if (session) {
        stopMetadataPolling(session.id);
      }

      await stopStreamRelay(channelId);

      const pb = await usePocketBaseAdmin();
      await pb.collection("dspeak_rooms_channels").update(channelId, {
        stream_active: false,
        stream_metadata: null,
      });

      console.log("[RTMP] Stream ended for channel:", channelId);

      broadcastToChannel(channelId, {
        type: "stream:stop",
        data: { channelId },
      });
    } catch (error) {
      console.error("[RTMP] Error cleaning up stream:", error);
    }
  });

  nms.run();
  console.log(`[RTMP] Server listening on port ${rtmpPort}`);
});

const pollingTimers = new Map();

function startMetadataPolling(session, channelId, pb) {
  if (pollingTimers.has(session.id)) return;

  let lastTitle = "";
  let lastArtist = "";

  const timer = setInterval(async () => {
    try {
      const dataObj = decodeSessionMetaData(session);
      if (!dataObj) return;

      const rawTitle = String(dataObj.title || "").trim();
      const rawArtist = String(dataObj.artist || "").trim();
      if (!rawTitle || !rawArtist) return;
      if (rawTitle === lastTitle && rawArtist === lastArtist) return;

      lastTitle = rawTitle;
      lastArtist = rawArtist;

      const metadata = await processStreamMetadata(pb, rawTitle, rawArtist);

      if (metadata.songId) {
        const manager = getStreamManager();
        const stream = manager.getStream(channelId);
        const logEntry = await logPlayToHistory(
          pb,
          metadata.songId,
          channelId,
          null,
          stream?.startedAt,
          null,
        );
        if (logEntry) {
          broadcastToChannel(channelId, {
            type: "stream:playlog",
            data: {
              history: [
                {
                  title: metadata.title,
                  artist: metadata.artist,
                  albumArtUrl: metadata.albumArtUrl,
                  playedAt: logEntry.played_at,
                },
              ],
            },
          });
        }
      }

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
    } catch (error) {
      console.error("[RTMP] Metadata polling error:", error);
    }
  }, METADATA_POLL_INTERVAL_MS);

  pollingTimers.set(session.id, timer);
}

function stopMetadataPolling(sessionId) {
  const timer = pollingTimers.get(sessionId);
  if (timer) {
    clearInterval(timer);
    pollingTimers.delete(sessionId);
  }
}
