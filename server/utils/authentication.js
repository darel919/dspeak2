import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { usePocketBaseAdmin } from "./pocketbase.js";
import { enforceRateLimit } from "./rate-limit.js";

const SESSION_COOKIE = "dspeak_session";
const SESSION_LIFETIME_SECONDS = 7 * 24 * 60 * 60;
const SESSION_REFRESH_SECONDS = 24 * 60 * 60;
const AUTH_HANDOFF_COOKIE = "dspeak_auth_handoff";
const AUTH_HANDOFF_LIFETIME_SECONDS = 10 * 60;
const ACCOUNT_URL = "https://account.darelisme.my.id";

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

function authHandoffCookieOptions(maxAge = AUTH_HANDOFF_LIFETIME_SECONDS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  };
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

async function persistAuthenticatedSession(event, metadata, userId, deviceId) {
  if (!metadata?.id || !deviceId)
    throw createError({
      statusCode: 400,
      statusMessage: "User identity and device ID are required",
    });
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(String(deviceId)))
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid authentication input",
    });
  const pb = await usePocketBaseAdmin();
  await pb.collection("users").getOne(userId, { fields: "id" });
  const existingSessions = await pb
    .collection("dspeak_sessions")
    .getList(1, 10, {
      filter: pb.filter("user = {:user} && device_id = {:device}", {
        user: userId,
        device: String(deviceId),
      }),
      fields: "id",
    });
  await Promise.all(
    existingSessions.items.map((session) =>
      pb.collection("dspeak_sessions").delete(session.id),
    ),
  );
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

export function createAuthenticationHandoff(event) {
  enforceRateLimit(event, "session-handoff-start", null, 20, 10 * 60 * 1000);
  const state = randomBytes(32).toString("base64url");
  const publicOrigin =
    process.env.DSPEAK_PUBLIC_ORIGIN || getRequestURL(event).origin;
  const redirectUri = new URL("/auth", publicOrigin).toString();
  setCookie(event, AUTH_HANDOFF_COOKIE, state, authHandoffCookieOptions());
  const loginUrl = new URL("/start", ACCOUNT_URL);
  loginUrl.searchParams.set("rUrl", redirectUri);
  loginUrl.searchParams.set("state", state);
  return { loginUrl: loginUrl.toString() };
}

export async function exchangeAuthenticationHandoff(
  event,
  code,
  state,
  deviceId,
) {
  enforceRateLimit(event, "session-handoff-exchange", null, 20, 10 * 60 * 1000);
  const expectedState = getCookie(event, AUTH_HANDOFF_COOKIE) || "";
  deleteCookie(event, AUTH_HANDOFF_COOKIE, authHandoffCookieOptions(0));
  if (
    typeof code !== "string" ||
    !/^[a-zA-Z0-9_-]{32,128}$/.test(code) ||
    typeof state !== "string" ||
    state.length !== expectedState.length ||
    !expectedState ||
    !timingSafeEqual(Buffer.from(state), Buffer.from(expectedState))
  )
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid authentication handoff",
    });

  const authPath = process.env.AUTH_PATH || useRuntimeConfig().public.authPath;
  if (!authPath) throw new Error("AUTH_PATH is not configured");
  const redirectUri = new URL(
    "/auth",
    process.env.DSPEAK_PUBLIC_ORIGIN || getRequestURL(event).origin,
  ).toString();
  const response = await fetch(
    `${String(authPath).replace(/\/$/, "")}/handoff/exchange`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code, redirectUri }),
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    },
  );
  if (!response.ok)
    throw createError({
      statusCode: 401,
      statusMessage: "Authentication handoff was rejected",
    });
  const result = await response.json();
  const metadata = result?.user?.user_metadata || null;
  if (!metadata?.id)
    throw createError({
      statusCode: 401,
      statusMessage: "Authentication response has no user identity",
    });
  return persistAuthenticatedSession(
    event,
    metadata,
    String(metadata.id),
    deviceId,
  );
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
  let deleted = 0;
  while (true) {
    const page = await pb.collection("dspeak_sessions").getList(1, 100, {
      filter: pb.filter("expires_at <= {:now}", {
        now: new Date().toISOString(),
      }),
      fields: "id",
    });
    if (!page.items.length) return deleted;
    await Promise.all(
      page.items.map((session) =>
        pb.collection("dspeak_sessions").delete(session.id),
      ),
    );
    deleted += page.items.length;
  }
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
  if (!isAllowedWebSocketOrigin(request)) return null;
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

function requestHeader(request, name) {
  return (
    request.headers?.get?.(name) ||
    request.headers?.[name] ||
    request.headers?.getHeader?.(name) ||
    ""
  );
}

function isAllowedWebSocketOrigin(request) {
  const origin = requestHeader(request, "origin");
  if (!origin) return process.env.DSPEAK_ALLOW_ORIGINLESS_WEBSOCKETS === "true";
  try {
    const requestUrl = new URL(request.url);
    const forwardedHost = requestHeader(request, "x-forwarded-host");
    const forwardedProto = requestHeader(request, "x-forwarded-proto");
    const host =
      forwardedHost || requestHeader(request, "host") || requestUrl.host;
    const protocol =
      forwardedProto ||
      (requestUrl.protocol === "wss:" ? "https:" : requestUrl.protocol);
    const expectedOrigin =
      process.env.DSPEAK_PUBLIC_ORIGIN ||
      `${protocol.replace(/:$/, "")}://${host}`;
    return new URL(origin).origin === new URL(expectedOrigin).origin;
  } catch {
    return false;
  }
}
