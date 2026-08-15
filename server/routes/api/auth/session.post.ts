import { persistAuthenticatedSession } from "../../../utils/auth.ts";
import { verifySupabaseAccessToken } from "../../../auth/supabase.ts";
import { profileRepository } from "../../../db/repositories/profiles.ts";

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
    const payload =
      event.context.authToken === token && event.context.authPayload
        ? event.context.authPayload
        : await verifySupabaseAccessToken(token);
    const profile =
      event.context.authToken === token && event.context.authProfile
        ? event.context.authProfile
        : await profileRepository.findById(payload.sub);
    if (!profile) {
      throw createError({ statusCode: 401, statusMessage: "User not found" });
    }

    const deviceId =
      getHeader(event, "x-device-id") ||
      getHeader(event, "x-dspeak-device") ||
      "unknown";
    return persistAuthenticatedSession(
      event,
      profile.id,
      deviceId,
      token,
      profile,
    );
  } catch (error) {
    throw createError({
      statusCode: 401,
      statusMessage: "Invalid or expired token",
    });
  }
});
