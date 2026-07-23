import { createHash, randomBytes } from "node:crypto";
import { usePocketBaseAdmin } from "./pocketbase.js";
import { enforceRateLimit } from "./rate-limit.js";

const SESSION_COOKIE = "dspeak_session";
const SESSION_LIFETIME_SECONDS = 7 * 24 * 60 * 60;
const SESSION_REFRESH_SECONDS = 24 * 60 * 60;

function hashSessionToken(token) {
  return createHash("sha256").update(token).digest("hex");
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

function metadataFromVerification(result) {
  return result?.user?.user_metadata || null;
}

async function verifyExternalAccessToken(accessToken) {
  const authPath = process.env.AUTH_PATH || useRuntimeConfig().public.authPath;
  if (!authPath) throw new Error("AUTH_PATH is not configured");
  const response = await fetch(
    `${authPath}/verify?at=${encodeURIComponent(accessToken)}`,
    {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    },
  );
  if (!response.ok)
    throw createError({
      statusCode: 401,
      statusMessage: "Invalid authentication token",
    });
  const verification = await response.json();
  const metadata = metadataFromVerification(verification);
  if (!metadata?.id)
    throw createError({
      statusCode: 401,
      statusMessage: "Authentication response has no user identity",
    });
  return { metadata, userId: String(metadata.id) };
}

async function findSessionByToken(pb, token) {
  if (!token) return null;
  try {
    return await pb
      .collection("dspeak_sessions")
      .getFirstListItem(
        pb.filter("token_hash = {:hash}", { hash: hashSessionToken(token) }),
      );
  } catch (error) {
    if (error?.status === 404 || error?.response?.status === 404) return null;
    throw error;
  }
}

async function validateSession(pb, token) {
  const session = await findSessionByToken(pb, token);
  if (!session) return null;
  if (Date.parse(session.expires_at) <= Date.now()) {
    await pb.collection("dspeak_sessions").delete(session.id);
    return null;
  }
  if (
    !session.last_seen_at ||
    Date.now() - Date.parse(session.last_seen_at) >= SESSION_REFRESH_SECONDS
  ) {
    await pb.collection("dspeak_sessions").update(session.id, {
      last_seen_at: new Date().toISOString(),
    });
  }
  return session;
}

export async function createAuthenticatedSession(event, accessToken, deviceId) {
  enforceRateLimit(event, "session-create", null, 20, 10 * 60 * 1000);
  if (!accessToken || !deviceId)
    throw createError({
      statusCode: 400,
      statusMessage: "Access token and device ID are required",
    });
  if (
    String(accessToken).length > 8192 ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(String(deviceId))
  )
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid authentication input",
    });
  const { metadata, userId } = await verifyExternalAccessToken(accessToken);
  const pb = await usePocketBaseAdmin();
  await pb.collection("users").getOne(userId, { fields: "id" });
  const existingSessions = await pb.collection("dspeak_sessions").getFullList({
    filter: pb.filter("user = {:user} && device_id = {:device}", {
      user: userId,
      device: String(deviceId),
    }),
    fields: "id",
  });
  for (const session of existingSessions)
    await pb.collection("dspeak_sessions").delete(session.id);
  const rawToken = randomBytes(32).toString("base64url");
  const now = new Date();
  await pb.collection("dspeak_sessions").create({
    token_hash: hashSessionToken(rawToken),
    user: userId,
    device_id: String(deviceId),
    expires_at: new Date(
      now.getTime() + SESSION_LIFETIME_SECONDS * 1000,
    ).toISOString(),
    last_seen_at: now.toISOString(),
  });
  setCookie(event, SESSION_COOKIE, rawToken, sessionCookieOptions());
  return { user: { user_metadata: metadata } };
}

export async function getAuthenticatedSession(event) {
  const token = getCookie(event, SESSION_COOKIE);
  return validateSession(await usePocketBaseAdmin(), token);
}

export async function requireAuthenticatedUser(event) {
  const session = await getAuthenticatedSession(event);
  if (!session)
    throw createError({
      statusCode: 401,
      statusMessage: "Authentication required",
    });
  return String(session.user);
}

export async function restoreAuthenticatedSession(event) {
  const session = await getAuthenticatedSession(event);
  if (!session)
    throw createError({
      statusCode: 401,
      statusMessage: "Authentication required",
    });
  const pb = await usePocketBaseAdmin();
  const user = await pb.collection("users").getOne(session.user, {
    fields: "id,name,username,display_name,handle,email,avatar",
  });
  return {
    user: {
      user_metadata: {
        ...user,
        id: user.id,
      },
    },
  };
}

export async function revokeAuthenticatedSession(event) {
  const pb = await usePocketBaseAdmin();
  const token = getCookie(event, SESSION_COOKIE);
  const session = await findSessionByToken(pb, token);
  if (session) await pb.collection("dspeak_sessions").delete(session.id);
  deleteCookie(event, SESSION_COOKIE, sessionCookieOptions(0));
  return { success: true };
}

export async function pruneExpiredSessions() {
  const pb = await usePocketBaseAdmin();
  const sessions = await pb.collection("dspeak_sessions").getFullList({
    filter: pb.filter("expires_at <= {:now}", {
      now: new Date().toISOString(),
    }),
    fields: "id",
  });
  for (const session of sessions)
    await pb.collection("dspeak_sessions").delete(session.id);
  return sessions.length;
}

function cookieValue(request, name) {
  const cookie =
    request.headers?.get?.("cookie") ||
    request.headers?.cookie ||
    request.headers?.getHeader?.("cookie") ||
    "";
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(value.join("="));
      } catch {
        return "";
      }
    }
  }
  return "";
}

export async function authenticateWebSocketRequest(request) {
  const session = await validateSession(
    await usePocketBaseAdmin(),
    cookieValue(request, SESSION_COOKIE),
  );
  if (!session) return null;
  return {
    userId: String(session.user),
    deviceId: String(session.device_id),
  };
}
