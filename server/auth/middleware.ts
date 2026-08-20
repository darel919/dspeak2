import type { H3Event } from "h3";
import {
  verifySupabaseAccessToken,
  type SupabaseAccessTokenClaims,
} from "./supabase.ts";
import type { AuthEvent } from "../types/auth.ts";

type BearerEvent = Pick<H3Event, "headers" | "context">;

export function hasVerifiedBearerContext(
  event: Pick<H3Event, "context">,
): boolean {
  return Boolean(event.context.authToken && event.context.authPayload);
}

function setBearerAuthContext(
  event: BearerEvent,
  token: string,
  payload: SupabaseAccessTokenClaims,
) {
  event.context.authToken = token;
  event.context.authPayload = payload;
  event.context.token = token;
  event.context.user = {
    id: payload.sub,
    email: payload.email || "",
    role: payload.role,
  };
  return payload;
}

function requireBearerClaims(payload: unknown): SupabaseAccessTokenClaims {
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    !("sub" in payload) ||
    typeof payload.sub !== "string" ||
    !payload.sub
  ) {
    throw new Error("Supabase access token has no subject");
  }
  return { ...payload, sub: payload.sub };
}

export async function ensureVerifiedBearer(
  event: BearerEvent,
  verifier: (
    token: string,
  ) => Promise<SupabaseAccessTokenClaims> = verifySupabaseAccessToken,
) {
  if (hasVerifiedBearerContext(event))
    return requireBearerClaims(event.context.authPayload);

  const token = extractBearerToken(event);
  if (!token) return null;

  const pending = event.context.authVerification;
  const verificationPromise =
    pending?.token === token && pending.promise
      ? pending.promise
      : verifier(token);
  event.context.authVerification = {
    token,
    promise: verificationPromise,
  };
  const payload = requireBearerClaims(await verificationPromise);
  return setBearerAuthContext(event, token, payload);
}

export function extractBearerToken(event: Pick<H3Event, "headers">) {
  const authHeader =
    event.headers.get("authorization") || event.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
}

export async function requireAuth(event: AuthEvent) {
  const token = extractBearerToken(event);
  if (!token) {
    throw createError({
      statusCode: 401,
      statusMessage: "Missing authorization token",
    });
  }
  try {
    const payload = await verifySupabaseAccessToken(token);
    event.context.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    };
    return event.context.user;
  } catch (error) {
    throw createError({
      statusCode: 401,
      statusMessage: "Invalid or expired token",
    });
  }
}

export async function optionalAuth(event: AuthEvent) {
  const token = extractBearerToken(event);
  if (!token) return null;
  try {
    const payload = await verifySupabaseAccessToken(token);
    event.context.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    };
    return event.context.user;
  } catch {
    return null;
  }
}
