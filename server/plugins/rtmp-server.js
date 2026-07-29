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
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname } from "path";

// UUID validation for stream keys
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateStreamKey(streamKey) {
  if (!UUID_REGEX.test(streamKey)) {
    return false;
  }
  return true;
}

// Rate limiting for prePublish: 5 attempts per minute per IP
const prePublishAttempts = new Map();
const PREPUBLISH_MAX_ATTEMPTS = 5;
const PREPUBLISH_WINDOW_MS = 60 * 1000;

function checkPrePublishRateLimit(ip) {
  const now = Date.now();
  const attempts = prePublishAttempts.get(ip) || [];
  // Remove expired attempts
  const recent = attempts.filter((t) => now - t < PREPUBLISH_WINDOW_MS);
  if (recent.length >= PREPUBLISH_MAX_ATTEMPTS) {
    return false;
  }
  recent.push(now);
  prePublishAttempts.set(ip, recent);
  // Cleanup old entries periodically
  if (prePublishAttempts.size > 1000) {
    for (const [key, value] of prePublishAttempts.entries()) {
      const filtered = value.filter((t) => now - t < PREPUBLISH_WINDOW_MS);
      if (filtered.length === 0) prePublishAttempts.delete(key);
      else prePublishAttempts.set(key, filtered);
    }
  }
  return true;
}

const _require = createRequire(fileURLToPath(import.meta.url));
const nmsMain = _require.resolve("node-media-server");
const amfRequire = createRequire(nmsMain);
const AMF = amfRequire("./node_core_amf.js");

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
    const clientIp = args?.ip || args?.remoteAddress || "unknown";

    // CRITICAL: Rate limit prePublish attempts per IP
    if (!checkPrePublishRateLimit(clientIp)) {
      console.log(
        "[RTMP] Rejecting publish: rate limit exceeded for IP:",
        clientIp,
      );
      return false;
    }

    // CRITICAL: Validate streamKey format before any processing
    if (!validateStreamKey(streamKey)) {
      console.log(
        "[RTMP] Rejecting publish for invalid stream key format:",
        streamKey,
        "from IP:",
        clientIp,
      );
      return false;
    }

    const manager = getStreamManager();
    const channelId = manager.getStreamByKey(streamKey);
    if (!channelId) {
      console.log(
        "[RTMP] Rejecting publish for unknown stream key:",
        streamKey,
        "from IP:",
        clientIp,
      );
      return false;
    }
    if (manager.hasActiveStream(channelId)) {
      console.log(
        "[RTMP] Rejecting duplicate stream for channel:",
        channelId,
        "from IP:",
        clientIp,
      );
      return false;
    }
    console.log("[RTMP] Accepting publish for channel:", channelId, "from IP:", clientIp);
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
        relayStarting: true,
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
      manager.unregisterStream(channelId);
      const cleanupPb = await usePocketBaseAdmin();
      await cleanupPb
        .collection("dspeak_rooms_channels")
        .update(channelId, {
          stream_active: false,
        })
        .catch(() => {});
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

  // Reconcile stream state with PocketBase on startup (async, non-blocking)
  (async () => {
    try {
      const pb = await usePocketBaseAdmin();
      const { reconcileStreamState } = await import("../utils/stream-manager.js");
      await reconcileStreamState(pb);
    } catch (error) {
      console.error("[RTMP] Failed to reconcile stream state on startup:", error);
    }
  })();
});

const pollingTimers = new Map();

function startMetadataPolling(session, channelId, pb) {
  if (pollingTimers.has(session.id)) return;

  let lastTitle = "";
  let lastArtist = "";
  let lastChangedAt = Date.now();

  const timer = setInterval(async () => {
    try {
      const dataObj = decodeSessionMetaData(session);
      if (!dataObj) return;

      const rawTitle = String(dataObj.title || "").trim();
      const rawArtist = String(dataObj.artist || "").trim();
      if (!rawTitle || !rawArtist) return;
      if (rawTitle === lastTitle && rawArtist === lastArtist) return;

      const previousChangedAt = lastChangedAt;
      lastTitle = rawTitle;
      lastArtist = rawArtist;
      lastChangedAt = Date.now();

      const metadata = await processStreamMetadata(pb, rawTitle, rawArtist);

      if (metadata.songId) {
        const logEntry = await logPlayToHistory(
          pb,
          metadata.songId,
          channelId,
          null,
          new Date(previousChangedAt).toISOString(),
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
