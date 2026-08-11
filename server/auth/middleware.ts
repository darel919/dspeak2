import { createLocalJWKSet, jwtVerify } from "jose";
import type { H3Event } from "h3";
import type { AuthEvent } from "../types/auth.ts";

type LocalKeySet = ReturnType<typeof createLocalJWKSet>;
let cachedJWKS: Record<string, unknown> | null = null;
let cachedKeySet: LocalKeySet | null = null;
let jwksFetchedAt = 0;
let jwksRequest: Promise<LocalKeySet> | null = null;
const JWKS_CACHE_TTL = 3600000;

async function getJWKS() {
  const now = Date.now();
  if (cachedKeySet && now - jwksFetchedAt < JWKS_CACHE_TTL) return cachedKeySet;
  if (jwksRequest) return jwksRequest;
  jwksRequest = (async () => {
    try {
      const response = await fetch(
        `${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
      );
      if (!response.ok) throw new Error("Failed to fetch JWKS");
      cachedJWKS = (await response.json()) as Record<string, unknown>;
      cachedKeySet = createLocalJWKSet(cachedJWKS as never);
      jwksFetchedAt = Date.now();
      return cachedKeySet;
    } catch (error) {
      if (cachedKeySet) return cachedKeySet;
      throw error;
    } finally {
      jwksRequest = null;
    }
  })();
  return jwksRequest;
}

export async function verifyAccessToken(token: string) {
  const keySet = await getJWKS();
  const { payload } = await jwtVerify(token, keySet, {
    issuer: `${process.env.SUPABASE_URL}/auth/v1`,
    audience: "authenticated",
  });
  return payload;
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
    const payload = await verifyAccessToken(token);
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
    const payload = await verifyAccessToken(token);
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
