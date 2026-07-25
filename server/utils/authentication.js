import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { usePocketBaseAdmin } from "./pocketbase.js";
import { enforceRateLimit } from "./rate-limit.js";
import { sameOriginAvatarPath } from "../../shared/avatar-path.js";

const SESSION_COOKIE =
  process.env.NODE_ENV === "production"
    ? "__Host-dspeak_session"
    : "dspeak_session";
const SESSION_LIFETIME_SECONDS = 7 * 24 * 60 * 60;
const SESSION_REFRESH_SECONDS = 24 * 60 * 60;
const AUTH_HANDOFF_COOKIE =
  process.env.NODE_ENV === "production"
    ? "__Host-dspeak_auth_handoff"
    : "dspeak_auth_handoff";
const AUTH_HANDOFF_LIFETIME_SECONDS = 10 * 60;
const ACCOUNT_URL = "https://account.darelisme.my.id";
const SESSION_ROTATION_GRACE_MS = 30 * 1000;
const rotationStateKey = Symbol.for("dspeak.session-rotation");

function rotationState() {
  if (!globalThis[rotationStateKey])
    globalThis[rotationStateKey] = {
      previousTokens: new Map(),
      locks: new Map(),
      nextPruneAt: 0,
    };
  const state = globalThis[rotationStateKey];
  if (state.nextPruneAt <= Date.now()) {
    for (const [hash, value] of state.previousTokens)
      if (value.expiresAt <= Date.now()) state.previousTokens.delete(hash);
    state.nextPruneAt = Date.now() + 60 * 1000;
  }
  return state;
}

function hashSessionToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function csrfTokenForSession(session) {
  const secret = process.env.DSPEAK_CSRF_SECRET;
  if (!secret) throw new Error("DSPEAK_CSRF_SECRET is not configured");
  return createHmac("sha256", secret)
    .update(`dspeak-csrf:${session.id}`)
    .digest("base64url");
}

function exposeCsrfToken(event, session) {
  setHeader(event, "X-dSpeak-CSRF-Token", csrfTokenForSession(session));
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
  const tokenHash = hashSessionToken(token);
  try {
    return await pb
      .collection("dspeak_sessions")
      .getFirstListItem(pb.filter("token_hash = {:hash}", { hash: tokenHash }));
  } catch (error) {
    if (error?.status !== 404 && error?.response?.status !== 404) throw error;
    const previous = rotationState().previousTokens.get(tokenHash);
    if (!previous || previous.expiresAt <= Date.now()) {
      rotationState().previousTokens.delete(tokenHash);
      return null;
    }
    try {
      return await pb.collection("dspeak_sessions").getOne(previous.sessionId);
    } catch (lookupError) {
      if (lookupError?.status === 404 || lookupError?.response?.status === 404)
        return null;
      throw lookupError;
    }
  }
}

function publicUserMetadata(user) {
  return {
    id: String(user.id),
    name: user.name || "",
    username: user.username || "",
    display_name: user.display_name || "",
    handle: user.handle || "",
    avatar: sameOriginAvatarPath(user),
  };
}

async function validateSession(pb, token, event = null) {
  const session = await findSessionByToken(pb, token);
  if (!session) return null;
  const suppliedHash = hashSessionToken(token);
  if (event && session.token_hash !== suppliedHash) {
    const previous = rotationState().previousTokens.get(suppliedHash);
    if (previous?.expiresAt > Date.now())
      setCookie(
        event,
        SESSION_COOKIE,
        previous.currentToken,
        sessionCookieOptions(),
      );
  }
  if (Date.parse(session.expires_at) <= Date.now()) {
    await pb.collection("dspeak_sessions").delete(session.id);
    return null;
  }
  if (
    (event && !session.last_seen_at) ||
    (event &&
      Date.now() - Date.parse(session.last_seen_at) >= SESSION_REFRESH_SECONDS)
  ) {
    const state = rotationState();
    const previousLock = state.locks.get(session.id) || Promise.resolve();
    const refresh = previousLock
      .catch(() => {})
      .then(async () => {
        const current = await pb
          .collection("dspeak_sessions")
          .getOne(session.id);
        if (current.token_hash !== suppliedHash) {
          const previous = state.previousTokens.get(suppliedHash);
          if (previous?.expiresAt > Date.now())
            setCookie(
              event,
              SESSION_COOKIE,
              previous.currentToken,
              sessionCookieOptions(),
            );
          return;
        }
        const rawToken = randomBytes(32).toString("base64url");
        await pb.collection("dspeak_sessions").update(session.id, {
          token_hash: hashSessionToken(rawToken),
          last_seen_at: new Date().toISOString(),
        });
        state.previousTokens.set(suppliedHash, {
          sessionId: session.id,
          currentToken: rawToken,
          expiresAt: Date.now() + SESSION_ROTATION_GRACE_MS,
        });
        setCookie(event, SESSION_COOKIE, rawToken, sessionCookieOptions());
      });
    state.locks.set(session.id, refresh);
    try {
      await refresh;
    } finally {
      if (state.locks.get(session.id) === refresh)
        state.locks.delete(session.id);
    }
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
  const session = await pb.collection("dspeak_sessions").create({
    token_hash: hashSessionToken(rawToken),
    user: userId,
    device_id: String(deviceId),
    expires_at: new Date(
      now.getTime() + SESSION_LIFETIME_SECONDS * 1000,
    ).toISOString(),
    last_seen_at: now.toISOString(),
  });
  setCookie(event, SESSION_COOKIE, rawToken, sessionCookieOptions());
  exposeCsrfToken(event, session);
  return { user: { user_metadata: publicUserMetadata(metadata) } };
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
  const session = await validateSession(
    await usePocketBaseAdmin(),
    token,
    event,
  );
  if (session) exposeCsrfToken(event, session);
  return session;
}

export async function validateCsrfRequest(event) {
  const token = getCookie(event, SESSION_COOKIE);
  if (!token) return true;
  const session = await findSessionByToken(await usePocketBaseAdmin(), token);
  if (!session) return true;
  const supplied = getHeader(event, "x-dspeak-csrf-token") || "";
  const expected = csrfTokenForSession(session);
  return (
    supplied.length === expected.length &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  );
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
        ...publicUserMetadata(user),
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
  if (!origin) return false;
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
