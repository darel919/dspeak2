import { createHmac, timingSafeEqual } from "node:crypto";
import { readBody } from "h3";
import { verifyAccessToken } from "../auth/middleware.ts";
import { profileRepository } from "../db/repositories/profiles.ts";
import { sameOriginAvatarPath } from "../../shared/avatar-path.ts";

const SESSION_COOKIE =
  process.env.NODE_ENV === "production"
    ? "__Host-dspeak_session"
    : "dspeak_session";
const SESSION_LIFETIME_SECONDS = 7 * 24 * 60 * 60;
const CSRF_SECRET = process.env.DSPEAK_CSRF_SECRET;

if (!CSRF_SECRET) {
  throw new Error("DSPEAK_CSRF_SECRET is not configured");
}

function csrfTokenForSession(userId) {
  return createHmac("sha256", CSRF_SECRET)
    .update(`dspeak-csrf:${userId}`)
    .digest("base64url");
}

export function exposeCsrfToken(event, userId) {
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

function publicUserMetadata(user) {
  return {
    id: String(user.id),
    name: user.name || "",
    username: user.username || "",
    display_name: user.displayName || "",
    handle: user.username || user.handle || "",
    avatar: sameOriginAvatarPath(user),
  };
}

function isDesktopClientRequest(event) {
  if (getHeader(event, "x-desktop-app") !== "true") return false;
  const origin = getHeader(event, "origin") || "";
  return (
    origin === "tauri://localhost" ||
    /^https?:\/\/tauri\.localhost(?::\d+)?$/.test(origin)
  );
}

export async function persistAuthenticatedSession(
  event,
  userId,
  deviceId,
  accessToken,
  profileOverride = null,
) {
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

  setCookie(event, SESSION_COOKIE, accessToken, sessionCookieOptions());
  exposeCsrfToken(event, userId);

  return {
    user: { user_metadata: publicUserMetadata(profile) },
  };
}

export async function validateCsrfRequest(event) {
  if (event.context.authToken) return true;

  const token = getCookie(event, SESSION_COOKIE);
  if (!token) return true;

  try {
    const payload = await verifiedPayloadForEvent(event, token);
    if (!payload) return true;
    const supplied = getHeader(event, "x-dspeak-csrf-token") || "";
    const expected = csrfTokenForSession(payload.sub);
    return (
      supplied.length === expected.length &&
      timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
    );
  } catch {
    return true;
  }
}

function verifiedPayloadForEvent(event, token) {
  if (event.context.authToken === token && event.context.authPayload)
    return Promise.resolve(event.context.authPayload);
  if (
    event.context.authVerification?.token === token &&
    event.context.authVerification.promise
  )
    return event.context.authVerification.promise;
  const promise = verifyAccessToken(token).catch(() => null);
  event.context.authVerification = { token, promise };
  return promise;
}

export async function getAuthenticatedSession(event) {
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
    if (!payload) return null;
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

export async function requireAuthenticatedUser(event) {
  const session = await getAuthenticatedSession(event);
  if (!session) {
    throw createError({
      statusCode: 401,
      statusMessage: "Authentication required",
    });
  }
  return String(session.user);
}

export async function revokeAuthenticatedSession(event) {
  deleteCookie(event, SESSION_COOKIE, sessionCookieOptions(0));
  return { success: true };
}
