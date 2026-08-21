import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseAccessTokenClaims } from "../server/auth/supabase.ts";
import type { ExternalError } from "../shared/types/external.ts";

const previousSupabaseUrl = process.env.SUPABASE_URL;
const previousSupabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const testSupabaseUrl = previousSupabaseUrl || "https://project.supabase.co";
if (!previousSupabaseUrl) process.env.SUPABASE_URL = testSupabaseUrl;
if (!previousSupabaseAnonKey) process.env.SUPABASE_ANON_KEY = "test-anon-key";

const { verifySupabaseAccessToken, SupabaseTokenIssuerMismatchError } =
  await import("../server/auth/supabase.ts");
const { ensureVerifiedBearer, hasVerifiedBearerContext } =
  await import("../server/auth/middleware.ts");

if (previousSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
if (previousSupabaseAnonKey === undefined) delete process.env.SUPABASE_ANON_KEY;

const validClaims: SupabaseAccessTokenClaims = {
  sub: "user-id",
  iss: `${testSupabaseUrl}/auth/v1`,
  aud: "authenticated",
  role: "authenticated",
};

test("getClaims verifies a Supabase access token and returns claims", async () => {
  let receivedToken = "";
  const auth: Parameters<typeof verifySupabaseAccessToken>[1] = {
    getClaims: async (token: string) => {
      receivedToken = token;
      return { data: { claims: validClaims }, error: null };
    },
  };

  const claims = await verifySupabaseAccessToken("test-token", auth);

  assert.equal(receivedToken, "test-token");
  assert.equal(claims.sub, "user-id");
  assert.equal(claims.aud, "authenticated");
});

test("invalid Supabase access tokens are rejected by the shared verifier", async () => {
  const auth: Parameters<typeof verifySupabaseAccessToken>[1] = {
    getClaims: async () => ({
      data: null,
      error: new Error("invalid token"),
    }),
  };

  await assert.rejects(
    () => verifySupabaseAccessToken("invalid-token", auth),
    /invalid token/,
  );
});

test("a verified token from another Supabase project maps to issuer mismatch", async () => {
  const auth: Parameters<typeof verifySupabaseAccessToken>[1] = {
    getClaims: async () => ({
      data: {
        claims: {
          ...validClaims,
          iss: "https://other-project.supabase.co/auth/v1",
        },
      },
      error: null,
    }),
  };

  await assert.rejects(
    () => verifySupabaseAccessToken("cross-project-token", auth),
    (error: ExternalError) => {
      assert.ok(error instanceof SupabaseTokenIssuerMismatchError);
      assert.equal(
        error.receivedIssuer,
        "https://other-project.supabase.co/auth/v1",
      );
      return true;
    },
  );
});

test("valid bearer authentication populates the request context", async () => {
  const event: Parameters<typeof ensureVerifiedBearer>[0] = {
    headers: new Headers({ Authorization: "Bearer test-token" }),
    context: {},
  };
  const verifier = async () => validClaims;

  const payload = await ensureVerifiedBearer(event, verifier);

  assert.equal(payload.sub, "user-id");
  assert.equal(event.context.authToken, "test-token");
  assert.equal(event.context.authPayload.sub, "user-id");
  assert.equal(event.context.token, "test-token");
  assert.equal(hasVerifiedBearerContext(event), true);
});

test("concurrent bearer checks share one verification", async () => {
  const event: Parameters<typeof ensureVerifiedBearer>[0] = {
    headers: new Headers({ Authorization: "Bearer test-token" }),
    context: {},
  };
  let verificationCount = 0;
  const verifier = async () => {
    verificationCount += 1;
    await Promise.resolve();
    return validClaims;
  };

  const results = await Promise.all([
    ensureVerifiedBearer(event, verifier),
    ensureVerifiedBearer(event, verifier),
  ]);

  assert.equal(verificationCount, 1);
  assert.equal(results[0]?.sub, "user-id");
  assert.equal(results[1]?.sub, "user-id");
});

test("unverified native context cannot satisfy the bearer security check", () => {
  assert.equal(
    hasVerifiedBearerContext({
      context: { headers: { origin: "tauri://localhost" } },
    }),
    false,
  );
  assert.equal(
    hasVerifiedBearerContext({
      context: { authToken: "test-token" },
    }),
    false,
  );
});
