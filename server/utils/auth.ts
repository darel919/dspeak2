import { createHmac, timingSafeEqual } from "node:crypto";
import { readBody } from "h3";
import { verifySupabaseAccessToken } from "../auth/supabase.ts";
import { profileRepository } from "../db/repositories/profiles.ts";
import { sameOriginAvatarPath } from "../../shared/avatar-path.ts";
import type { H3Event } from "h3";
import type { JWTPayload } from "jose";
import type { ProfileRepository } from "../db/repositories/profiles.ts";

const SESSION_COOKIE =
  process.env.NODE_ENV === "production"
    ? "__Host-dspeak_session"
    : "dspeak_session";
const SESSION_LIFETIME_SECONDS = 7 * 24 * 60 * 60;
const CSRF_SECRET = process.env.DSPEAK_CSRF_SECRET;

if (!CSRF_SECRET) {
  throw new Error("DSPEAK_CSRF_SECRET is not configured");
}
const requiredCsrfSecret = CSRF_SECRET;
type AuthProfile = NonNullable<
  Awaited<ReturnType<ProfileRepository["findById"]>>
>;

function csrfTokenForSession(userId: string): string {
  return createHmac("sha256", requiredCsrfSecret)
    .update(`dspeak-csrf:${userId}`)
    .digest("base64url");
}

export function exposeCsrfToken(event: H3Event, userId: string): void {
  setHeader(event, "X-dSpeak-CSRF-Token", csrfTokenForSession(userId));
}

function sessionCookieOptions(maxAge = SESSION_LIFETIME_SECONDS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge,
  };
}

function publicUserMetadata(user: AuthProfile): Record<string, string> {
  return {
    id: String(user.id),
    name: user.displayName || "",
    username: user.username || "",
    display_name: user.displayName || "",
    handle: user.username || "",
    avatar: sameOriginAvatarPath({ id: user.id, avatar: user.avatarKey }) || "",
  };
}

export async function persistAuthenticatedSession(
  event: H3Event,
  userId: string,
  deviceId: string,
  accessToken: string,
  profileOverride: AuthProfile | null = null,
  options: { persistCookie?: boolean } = {},
): Promise<{ user: { user_metadata: Record<string, string> } }> {
  if (!userId || !deviceId || !accessToken) {
    throw createError({
      statusCode: 400,
      statusMessage: "User identity and device ID are required",
    });
  }
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(String(deviceId))) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid authentication input",
    });
  }

  const profile =
    profileOverride ||
    (event.context.authToken === accessToken
      ? event.context.authProfile
      : null) ||
    (await profileRepository.findById(userId));
  if (!profile) {
    throw createError({
      statusCode: 403,
      statusMessage: "User profile not found",
    });
  }

  event.context.sessionToken = accessToken;
  event.context.userId = userId;
  event.context.deviceId = deviceId;

  if (options.persistCookie !== false) {
    setCookie(event, SESSION_COOKIE, accessToken, sessionCookieOptions());
    exposeCsrfToken(event, userId);
  }

  return {
    user: { user_metadata: publicUserMetadata(profile) },
  };
}

export async function validateCsrfRequest(event: H3Event): Promise<boolean> {
  if (event.context.authToken) return true;

  const token = getCookie(event, SESSION_COOKIE);
  if (!token) return true;

  try {
    const payload = await verifiedPayloadForEvent(event, token);
    if (!payload) return true;
    const supplied = getHeader(event, "x-dspeak-csrf-token") || "";
    if (!payload.sub) return true;
    const expected = csrfTokenForSession(payload.sub);
    return (
      supplied.length === expected.length &&
      timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
    );
  } catch {
    return true;
  }
}

function verifiedPayloadForEvent(
  event: H3Event,
  token: string,
): Promise<JWTPayload | null> {
  if (event.context.authToken === token && event.context.authPayload)
    return Promise.resolve(event.context.authPayload as JWTPayload);
  if (
    event.context.authVerification?.token === token &&
    event.context.authVerification.promise
  )
    return event.context.authVerification.promise;
  const promise = verifySupabaseAccessToken(token).catch(() => null);
  event.context.authVerification = { token, promise };
  return promise;
}

export async function getAuthenticatedSession(
  event: H3Event,
): Promise<{ user: string; profile: AuthProfile } | null> {
  const token = event.context.token || getCookie(event, SESSION_COOKIE);
  if (!token) return null;

  if (event.context.authSessionToken === token && event.context.authSession)
    return event.context.authSession;
  if (
    event.context.authSessionToken === token &&
    event.context.authSessionPromise
  )
    return event.context.authSessionPromise;

  event.context.authSessionToken = token;
  event.context.authSessionPromise = (async () => {
    const payload = await verifiedPayloadForEvent(event, token);
    if (!payload?.sub) return null;
    const profile =
      event.context.authToken === token && event.context.authProfile
        ? event.context.authProfile
        : await profileRepository.findById(payload.sub);
    if (!profile) return null;
    const session = { user: profile.id, profile };
    event.context.authSession = session;
    return session;
  })().catch(() => null);
  return event.context.authSessionPromise;
}

export async function requireAuthenticatedUser(
  event: H3Event,
): Promise<string> {
  const session = await getAuthenticatedSession(event);
  if (!session) {
    throw createError({
      statusCode: 401,
      statusMessage: "Authentication required",
    });
  }
  return String(session.user);
}

export async function revokeAuthenticatedSession(
  event: H3Event,
): Promise<{ success: boolean }> {
  deleteCookie(event, SESSION_COOKIE, sessionCookieOptions(0));
  return { success: true };
}
