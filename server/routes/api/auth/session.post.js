import { persistAuthenticatedSession } from "../../../utils/auth.js";
import { verifyAccessToken } from "../../../auth/middleware.js";
import { profileRepository } from "../../../db/repositories/profiles.js";

export default defineEventHandler(async (event) => {
  const authHeader = getHeader(event, "authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw createError({
      statusCode: 401,
      statusMessage: "Missing authorization token",
    });
  }

  const token = authHeader.slice(7);
  if (!token) {
    throw createError({
      statusCode: 401,
      statusMessage: "Missing authorization token",
    });
  }

  try {
    const payload = await verifyAccessToken(token);
    const profile = await profileRepository.findById(payload.sub);
    if (!profile) {
      throw createError({ statusCode: 401, statusMessage: "User not found" });
    }

    const deviceId =
      getHeader(event, "x-device-id") ||
      getHeader(event, "x-dspeak-device") ||
      "unknown";
    return persistAuthenticatedSession(event, profile.id, deviceId, token);
  } catch (error) {
    throw createError({
      statusCode: 401,
      statusMessage: "Invalid or expired token",
    });
  }
});
