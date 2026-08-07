import { supabase, verifyAccessToken } from "../../../auth/supabase.js";
import { membershipRepository } from "../../../db/repositories/rooms.js";
import { requireAuth } from "../../../auth/middleware.js";

export default defineEventHandler(async (event) => {
  await requireAuth(event);
  const user = event.context.user;

  const body = await readBody(event);
  const { channelId, roomId, connectionMode } = body;

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

  const mediaControlUrl =
    process.env.MEDIA_CONTROL_URL || "https://media-control.example.com";
  const ticket = await generateMediaTicket(
    user.id,
    channelId,
    roomId,
    connectionMode || "auto",
  );

  return {
    mediaControlUrl,
    protocolVersion: 2,
    ticket,
    expiresIn: 120,
  };
});

async function generateMediaTicket(userId, channelId, roomId, connectionMode) {
  const jose = await import("jose");
  const secret = new TextEncoder().encode(process.env.MEDIA_TICKET_SECRET);
  const token = await new jose.SignJWT({
    sub: userId,
    channelId,
    roomId,
    connectionMode,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("2m")
    .sign(secret);
  return token;
}
