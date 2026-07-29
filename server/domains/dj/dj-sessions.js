import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { createDjBroadcastProducer } from "../../utils/mediasoup-sfu.js";
import { registerDjParticipantDisconnectedHandler } from "./dj-lifecycle.js";

const SESSION_TTL_MS = 15 * 60 * 1000;
const ACTIVE_SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const PUBLISHER_RECOVERY_MS = 20 * 1000;
const stateKey = Symbol.for("dspeak.dj.sessions");

function state() {
  if (!globalThis[stateKey])
    globalThis[stateKey] = {
      sessions: new Map(),
      userSessions: new Map(),
      channelSessions: new Map(),
    };
  return globalThis[stateKey];
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function publicSession(session) {
  return {
    id: session.id,
    channelId: session.channelId,
    status: session.status,
    expiresAt: new Date(session.expiresAt).toISOString(),
    directUrl: session.directUrl,
    fallbackUrl: session.fallbackUrl,
    error: session.error,
  };
}

function publisherUrl(host, port, path, token) {
  const streamId = `publish:${path}:dj:${token}`;
  return `srt://${host}:${port}?streamid=${streamId}&pkt_size=1316`;
}

function closeBridge(session) {
  if (session.recoveryTimer) clearTimeout(session.recoveryTimer);
  session.recoveryTimer = null;
  if (session.process && !session.process.killed)
    session.process.kill("SIGTERM");
  session.process = null;
  session.bridge?.close();
  session.bridge = null;
}

export function closeDjSession(sessionId, userId = null) {
  const current = state();
  const session = current.sessions.get(String(sessionId));
  if (!session) return false;
  if (userId && String(session.userId) !== String(userId)) return false;
  closeBridge(session);
  clearTimeout(session.expiryTimer);
  current.sessions.delete(session.id);
  if (current.userSessions.get(session.userId) === session.id)
    current.userSessions.delete(session.userId);
  if (current.channelSessions.get(session.channelId) === session.id)
    current.channelSessions.delete(session.channelId);
  session.status = "stopped";
  return true;
}

registerDjParticipantDisconnectedHandler((channelId, userId) => {
  for (const session of [...state().sessions.values()]) {
    if (
      session.channelId === String(channelId) &&
      session.userId === String(userId)
    )
      closeDjSession(session.id);
  }
});

export function createDjSession({ channelId, userId }) {
  const current = state();
  const channelSessionId = current.channelSessions.get(String(channelId));
  const channelSession = current.sessions.get(channelSessionId);
  if (channelSession && channelSession.userId !== String(userId))
    throw createError({
      statusCode: 409,
      statusMessage: "Another DJ is already assigned to this channel",
    });
  const previousId = current.userSessions.get(String(userId));
  if (previousId) closeDjSession(previousId, userId);
  const id = randomBytes(12).toString("base64url");
  const token = randomBytes(32).toString("base64url");
  const path = `dj-${id}`;
  const directHost =
    process.env.DSPEAK_LIVE_DOMAIN || "live.dspeak.example.com";
  const directPort = Number(process.env.DSPEAK_INGEST_LISTEN_PORT || 9999);
  const fallbackHost =
    process.env.DSPEAK_INGEST_FALLBACK_DOMAIN || "live4.dspeak.example.com";
  const fallbackPort = Number(
    process.env.DSPEAK_INGEST_FALLBACK_PORT || directPort,
  );
  const session = {
    id,
    token,
    path,
    userId: String(userId),
    channelId: String(channelId),
    status: "waiting",
    error: null,
    bridge: null,
    process: null,
    recoveryTimer: null,
    expiresAt: Date.now() + SESSION_TTL_MS,
    directUrl: publisherUrl(directHost, directPort, path, token),
    fallbackUrl: publisherUrl(fallbackHost, fallbackPort, path, token),
  };
  session.expiryTimer = setTimeout(() => closeDjSession(id), SESSION_TTL_MS);
  session.expiryTimer.unref?.();
  current.sessions.set(id, session);
  current.userSessions.set(session.userId, id);
  current.channelSessions.set(session.channelId, id);
  return publicSession(session);
}

export function getDjSession(sessionId, userId) {
  const session = state().sessions.get(String(sessionId));
  if (!session || String(session.userId) !== String(userId)) return null;
  return publicSession(session);
}

function findAuthorizedSession(payload) {
  if (!["publish", "read"].includes(payload?.action)) return null;
  if (!["srt", "rtsp"].includes(payload?.protocol)) return null;
  const session = [...state().sessions.values()].find(
    (candidate) => candidate.path === String(payload.path || ""),
  );
  if (!session || session.expiresAt <= Date.now()) return null;
  if (String(payload.user || "") !== "dj") return null;
  if (!safeEqual(payload.password || payload.token, session.token)) return null;
  if (payload.action === "read" && String(payload.ip) !== "127.0.0.1")
    return null;
  return session;
}

function scheduleRecovery(session, message) {
  if (session.status === "stopped") return;
  closeBridge(session);
  session.status = "recovering";
  session.error = message;
  session.recoveryTimer = setTimeout(
    () => closeDjSession(session.id),
    PUBLISHER_RECOVERY_MS,
  );
  session.recoveryTimer.unref?.();
}

async function startBridge(session) {
  if (session.bridge || session.status === "stopped") return;
  session.status = "connecting";
  session.error = null;
  const ssrc = randomInt(1, 0xffffffff);
  try {
    session.bridge = await createDjBroadcastProducer(
      session.channelId,
      session.userId,
      ssrc,
    );
    const input = `rtsp://dj:${session.token}@127.0.0.1:8554/${session.path}`;
    const output = `rtp://127.0.0.1:${session.bridge.rtpPort}?pkt_size=1200`;
    session.process = spawn(
      process.env.FFMPEG_PATH || "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "warning",
        "-rtsp_transport",
        "tcp",
        "-i",
        input,
        "-map",
        "0:a:0",
        "-vn",
        "-c:a",
        "libopus",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-b:a",
        "128k",
        "-payload_type",
        "111",
        "-ssrc",
        String(ssrc),
        "-f",
        "rtp",
        output,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    session.process.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-2048);
    });
    const process = session.process;
    session.process.once("spawn", () => {
      session.bridge
        ?.waitForRtp()
        .then(() => {
          if (session.process !== process || session.status === "stopped")
            return;
          session.status = "live";
          session.error = null;
          clearTimeout(session.expiryTimer);
          session.expiresAt = Date.now() + ACTIVE_SESSION_TTL_MS;
          session.expiryTimer = setTimeout(
            () => closeDjSession(session.id),
            ACTIVE_SESSION_TTL_MS,
          );
          session.expiryTimer.unref?.();
        })
        .catch((error) => {
          if (session.process !== process || session.status === "stopped")
            return;
          scheduleRecovery(session, error.message);
        });
    });
    session.process.once("error", (error) => {
      scheduleRecovery(session, error.message || "FFmpeg failed to start");
    });
    session.process.once("exit", (code, signal) => {
      if (session.status === "stopped" || signal === "SIGTERM") return;
      scheduleRecovery(
        session,
        stderr.trim() || `Publisher bridge exited with code ${code}`,
      );
    });
  } catch (error) {
    scheduleRecovery(session, error.message || "DJ bridge failed");
  }
}

export function authorizeDjIngest(payload) {
  const session = findAuthorizedSession(payload);
  if (!session) return false;
  if (payload.action === "publish")
    setTimeout(() => startBridge(session), 350).unref?.();
  return true;
}
