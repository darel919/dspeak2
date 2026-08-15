import { getUserFromToken } from "../../../auth/supabase.ts";
import {
  extractBearerToken,
  verifyAccessToken,
} from "../../../auth/middleware.ts";
import { provisionOAuthProfile } from "../../../auth/oauth-profile.ts";
import { profileRepository } from "../../../db/repositories/profiles.ts";
import { persistAuthenticatedSession } from "../../../utils/auth.ts";

function desktopAuthFailure(
  code: string,
  statusCode: number,
  error?: unknown,
): never {
  console.error(
    `[DesktopAuth] ${code}`,
    error instanceof Error ? error.message : error || "",
  );
  throw createError({ statusCode, statusMessage: code });
}

export default defineEventHandler(async (event) => {
  const token = extractBearerToken(event);
  if (!token)
    return desktopAuthFailure("DESKTOP_API_SESSION_BRIDGE_FAILED", 401);

  let payload: Awaited<ReturnType<typeof verifyAccessToken>>;
  try {
    payload =
      event.context.authToken === token && event.context.authPayload
        ? event.context.authPayload
        : await verifyAccessToken(token);
  } catch (error) {
    return desktopAuthFailure("DESKTOP_API_SESSION_BRIDGE_FAILED", 401, error);
  }
  if (!payload.sub)
    return desktopAuthFailure("DESKTOP_API_SESSION_BRIDGE_FAILED", 401);

  let supabaseUser;
  try {
    supabaseUser = await getUserFromToken(token);
  } catch (error) {
    return desktopAuthFailure("DESKTOP_API_SESSION_BRIDGE_FAILED", 502, error);
  }
  if (!supabaseUser || supabaseUser.id !== payload.sub)
    return desktopAuthFailure("DESKTOP_API_SESSION_BRIDGE_FAILED", 401);

  try {
    await provisionOAuthProfile(supabaseUser);
  } catch (error) {
    return desktopAuthFailure("DESKTOP_PROFILE_PROVISION_FAILED", 500, error);
  }

  let profile;
  try {
    profile = await profileRepository.findById(supabaseUser.id);
  } catch (error) {
    return desktopAuthFailure("DESKTOP_PROFILE_PROVISION_FAILED", 500, error);
  }
  if (!profile)
    return desktopAuthFailure("DESKTOP_PROFILE_PROVISION_FAILED", 500);

  try {
    const deviceId =
      getHeader(event, "x-device-id") ||
      getHeader(event, "x-dspeak-device") ||
      "unknown";
    return await persistAuthenticatedSession(
      event,
      supabaseUser.id,
      deviceId,
      token,
      profile,
      { persistCookie: false },
    );
  } catch (error) {
    return desktopAuthFailure("DESKTOP_API_SESSION_BRIDGE_FAILED", 500, error);
  }
});
