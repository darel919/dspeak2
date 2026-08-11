import {
  channelRepository,
  membershipRepository,
} from "../../../db/repositories/rooms.ts";
import { requireAuth } from "../../../auth/middleware.ts";
import { SignJWT, importPKCS8 } from "jose";
import { randomUUID } from "node:crypto";

let privateKeyCache = null;

async function getSigningKey() {
  if (privateKeyCache) return privateKeyCache;
  const privateKeyB64 = process.env.CF_MEDIA_TICKET_PRIVATE_KEY;
  if (!privateKeyB64) throw new Error("CF_MEDIA_TICKET_PRIVATE_KEY not set");
  const privateKey = await importPKCS8(atob(privateKeyB64), "Ed25519");
  privateKeyCache = privateKey;
  return privateKey;
}

export default defineEventHandler(async (event) => {
  await requireAuth(event);
  const user = event.context.user;

  const body = await readBody(event);
  const { channelId, roomId } = body;

  if (!channelId || !roomId) {
    throw createError({
      statusCode: 400,
      statusMessage: "channelId and roomId are required",
    });
  }

  const membership = await membershipRepository.findByRoomAndUser(
    roomId,
    user.id,
  );
  if (!membership) {
    throw createError({
      statusCode: 403,
      statusMessage: "Not a member of this room",
    });
  }

  const channel = await channelRepository.findById(channelId);
  if (
    !channel ||
    String(channel.roomId) !== String(roomId) ||
    !["voice", "stage"].includes(channel.type)
  ) {
    throw createError({
      statusCode: 404,
      statusMessage: "Voice channel not found in room",
    });
  }

  const connectionMode = body.connectionMode || "auto";
  if (!new Set(["auto", "direct"]).has(connectionMode)) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid connection mode",
    });
  }

  const mediaControlUrl =
    process.env.CF_MEDIA_CONTROL_URL || "https://media-control.example.com";
  const websocketUrl = new URL(mediaControlUrl);
  websocketUrl.searchParams.set("channelId", channelId);
  if (websocketUrl.protocol === "http:") websocketUrl.protocol = "ws:";
  if (websocketUrl.protocol === "https:") websocketUrl.protocol = "wss:";
  const requestedDeviceId = String(body.deviceId || "").trim();
  const deviceId = requestedDeviceId || randomUUID();
  if (deviceId.length > 160 || !/^[A-Za-z0-9._:-]+$/.test(deviceId)) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid device ID",
    });
  }
  const ticket = await generateMediaTicket(
    user.id,
    channelId,
    roomId,
    connectionMode,
    deviceId,
  );

  return {
    mediaControlUrl,
    websocketUrl: websocketUrl.toString(),
    controlWebsocketUrl: websocketUrl.toString(),
    protocolVersion: 919,
    ticket,
    deviceId,
    expiresIn: 120,
  };
});

async function generateMediaTicket(
  userId,
  channelId,
  roomId,
  connectionMode,
  deviceId,
) {
  const key = await getSigningKey();
  const issuer = process.env.CF_MEDIA_CONTROL_ISSUER || "dspeak-media-control";
  const token = await new SignJWT({
    sub: userId,
    deviceId,
    channelId,
    roomId,
    connectionMode,
    routeEpoch: 0,
  })
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
    .setIssuer(issuer)
    .setAudience("dspeak-media-control")
    .setIssuedAt()
    .setExpirationTime("2m")
    .setJti(randomUUID())
    .sign(key);
  return token;
}
