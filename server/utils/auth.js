import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { readBody } from "h3";
import { verifyAccessToken } from "../auth/middleware.js";
import { profileRepository } from "../db/repositories/profiles.js";
import { sameOriginAvatarPath } from "../../shared/avatar-path.js";

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

function exposeCsrfToken(event, userId) {
  setHeader(event, "X-dSpeak-CSRF-Token", csrfTokenForSession(userId));
}

function sessionCookieOptions(maxAge = SESSION_LIFETIME_SECONDS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
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
    handle: user.handle || "",
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

export async function persistAuthenticatedSession(event, userId, deviceId) {
  if (!userId || !deviceId) {
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

  const profile = await profileRepository.findById(userId);
  if (!profile) {
    throw createError({
      statusCode: 403,
      statusMessage: "User profile not found",
    });
  }

  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");

  event.context.sessionToken = rawToken;
  event.context.sessionTokenHash = tokenHash;
  event.context.userId = userId;
  event.context.deviceId = deviceId;

  setCookie(event, SESSION_COOKIE, rawToken, sessionCookieOptions());
  exposeCsrfToken(event, userId);

  return {
    user: { user_metadata: publicUserMetadata(profile) },
    desktopToken: rawToken,
  };
}

export async function validateCsrfRequest(event) {
  const token = getCookie(event, SESSION_COOKIE);
  if (!token) return true;

  try {
    const payload = await verifyAccessToken(token);
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

export async function getAuthenticatedSession(event) {
  const token = event.context.token || getCookie(event, SESSION_COOKIE);
  if (!token) return null;

  try {
    const payload = await verifyAccessToken(token);
    const profile = await profileRepository.findById(payload.sub);
    if (!profile) return null;
    return {
      user: profile.id,
      profile,
    };
  } catch {
    return null;
  }
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

export async function authenticateWebSocketRequest(request) {
  const cookieHeader =
    request.headers?.get?.("cookie") ||
    request.headers?.cookie ||
    request.headers?.getHeader?.("cookie") ||
    "";
  let token = "";
  for (const part of cookieHeader.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === SESSION_COOKIE) {
      try {
        token = decodeURIComponent(value.join("="));
        break;
      } catch {
        token = "";
        break;
      }
    }
  }

  if (!token) {
    const requestUrl = new URL(request.url);
    token = requestUrl.searchParams.get("accessToken") || "";
  }

  if (!token) return null;

  try {
    const payload = await verifyAccessToken(token);
    const profile = await profileRepository.findById(payload.sub);
    if (!profile) return null;
    return {
      userId: String(profile.id),
      deviceId: request.headers?.get?.("x-device-id") || "unknown",
    };
  } catch {
    return null;
  }
}
