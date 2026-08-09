import { createLocalJWKSet, jwtVerify } from "jose";

let cachedJWKS = null;
let cachedKeySet = null;
let jwksFetchedAt = 0;
let jwksRequest = null;
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
      cachedJWKS = await response.json();
      cachedKeySet = createLocalJWKSet(cachedJWKS);
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

export async function verifyAccessToken(token) {
  const keySet = await getJWKS();
  const { payload } = await jwtVerify(token, keySet, {
    issuer: `${process.env.SUPABASE_URL}/auth/v1`,
    audience: "authenticated",
  });
  return payload;
}

export function extractBearerToken(event) {
  const authHeader =
    event.headers.get("authorization") || event.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
}

export async function requireAuth(event) {
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

export async function optionalAuth(event) {
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
