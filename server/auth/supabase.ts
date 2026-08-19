import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { JWTPayload } from "jose";
import { getCookie, setCookie } from "h3";
import type { H3Event } from "h3";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "SUPABASE_URL and SUPABASE_ANON_KEY environment variables are required",
  );
}
const requiredSupabaseUrl = new URL(supabaseUrl).origin;
const requiredSupabaseAnonKey = supabaseAnonKey;
const requiredSupabaseIssuer = `${requiredSupabaseUrl}/auth/v1`;

export type SupabaseAccessTokenClaims = JWTPayload & {
  sub: string;
  email?: string;
  role?: string;
};

export class SupabaseTokenIssuerMismatchError extends Error {
  readonly receivedIssuer: string | undefined;

  constructor(expectedIssuer: string, receivedIssuer: string | undefined) {
    super(
      `Supabase access token issuer is invalid: expected ${expectedIssuer}, received ${receivedIssuer ?? "(missing)"}`,
    );
    this.name = "SupabaseTokenIssuerMismatchError";
    this.receivedIssuer = receivedIssuer;
  }
}

export function supabaseProjectRef(url: string): string {
  try {
    return new URL(url).hostname.split(".")[0] || "";
  } catch {
    return "";
  }
}

export const configuredSupabaseProjectRef = supabaseProjectRef(
  process.env.SUPABASE_URL || "",
);

const oauthStorageKey = "dspeak-oauth";
const oauthCookiePrefix = "dspeak_oauth_";
const oauthCookieOptions: Parameters<typeof setCookie>[3] = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/api/auth",
  maxAge: 600,
};

function oauthCookieName(key: string): string {
  return `${oauthCookiePrefix}${Buffer.from(String(key)).toString("base64url")}`;
}

function createOAuthStorage(event: H3Event) {
  const values = new Map<string, string | null>();
  const cookieNames = new Set<string>();

  function rememberCookie(key: string): string {
    const name = oauthCookieName(key);
    cookieNames.add(name);
    return name;
  }

  const storage = {
    isServer: true,
    async getItem(key: string): Promise<string | null> {
      if (values.has(key)) return values.get(key) ?? null;
      const value = getCookie(event, rememberCookie(key)) ?? null;
      values.set(key, value);
      return value;
    },
    async setItem(key: string, value: string): Promise<void> {
      values.set(key, value);
      setCookie(event, rememberCookie(key), value, oauthCookieOptions);
    },
    async removeItem(key: string): Promise<void> {
      values.delete(key);
      setCookie(event, rememberCookie(key), "", {
        ...oauthCookieOptions,
        maxAge: 0,
      });
    },
  };

  return {
    storage,
    async clear() {
      const indexKey = `${oauthStorageKey}-flows-code-verifier`;
      const indexValue = await storage.getItem(indexKey);
      let flowIds: string[] = [];
      try {
        const parsed = JSON.parse(indexValue || "null");
        if (
          Array.isArray(parsed) &&
          parsed.every((id) => typeof id === "string")
        )
          flowIds = parsed;
      } catch {}

      const keys = new Set([
        oauthStorageKey,
        `${oauthStorageKey}-user`,
        `${oauthStorageKey}-code-verifier`,
        indexKey,
        ...flowIds.map(
          (flowId) => `${oauthStorageKey}-flow-${flowId}-code-verifier`,
        ),
      ]);
      for (const key of keys) await storage.removeItem(key);
      for (const name of cookieNames) {
        setCookie(event, String(name), "", {
          ...oauthCookieOptions,
          maxAge: 0,
        });
      }
    },
  };
}

export const supabase = createClient(
  requiredSupabaseUrl,
  requiredSupabaseAnonKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
      flowType: "pkce",
    },
  },
);

export function createOAuthSupabaseClient(event: H3Event): {
  client: SupabaseClient;
  clearStorage: () => Promise<void>;
} {
  const { storage, clear } = createOAuthStorage(event);
  const client = createClient(requiredSupabaseUrl, requiredSupabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: "pkce",
      storageKey: oauthStorageKey,
      storage,
    },
  });
  return { client, clearStorage: clear };
}

export const supabaseAdmin = supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  : null;

export async function getUserFromToken(
  accessToken: string,
): Promise<User | null> {
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error) throw error;
  if (!data.user) return null;
  return data.user;
}

export async function verifySupabaseAccessToken(
  token: string,
  auth: Pick<SupabaseClient["auth"], "getClaims"> = supabase.auth,
): Promise<SupabaseAccessTokenClaims> {
  if (!token) throw new Error("Missing Supabase access token");

  const { data, error } = await auth.getClaims(token);
  if (error) throw error;

  const claims = data?.claims as
    | (Record<string, unknown> & { aud?: string | string[]; sub?: unknown })
    | undefined;
  if (!claims || typeof claims.sub !== "string" || !claims.sub) {
    throw new Error("Supabase access token has no subject");
  }
  if (claims.iss !== requiredSupabaseIssuer) {
    throw new SupabaseTokenIssuerMismatchError(
      requiredSupabaseIssuer,
      typeof claims.iss === "string" ? claims.iss : undefined,
    );
  }
  const audience = claims.aud;
  if (
    audience !== "authenticated" &&
    !(Array.isArray(audience) && audience.includes("authenticated"))
  ) {
    throw new Error("Supabase access token audience is invalid");
  }

  return claims as SupabaseAccessTokenClaims;
}
