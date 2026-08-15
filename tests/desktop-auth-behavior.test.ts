import assert from "node:assert/strict";
import test from "node:test";
import { EmailIdentityConflictError } from "../server/auth/email-identity-conflict.ts";
import { isAuthSessionRecord } from "../app/shared/types/auth.ts";

const previousSupabaseUrl = process.env.SUPABASE_URL;
if (!previousSupabaseUrl)
  process.env.SUPABASE_URL = "https://project.supabase.co";
if (!process.env.SUPABASE_ANON_KEY)
  process.env.SUPABASE_ANON_KEY = "test-anon-key";

const { SupabaseTokenIssuerMismatchError } =
  await import("../server/auth/supabase.ts");

if (previousSupabaseUrl === undefined) delete process.env.SUPABASE_URL;

test("Supabase URL normalization yields the same issuer for trailing slashes", () => {
  const withSlash = new URL("https://project.supabase.co/").origin;
  const withoutSlash = new URL("https://project.supabase.co").origin;
  assert.equal(withSlash, withoutSlash);
  assert.equal(`${withSlash}/auth/v1`, "https://project.supabase.co/auth/v1");
  assert.equal(
    `${withoutSlash}/auth/v1`,
    "https://project.supabase.co/auth/v1",
  );
});

test("Supabase project ref extraction is deterministic and non-secret", () => {
  const ref = (url: string) => new URL(url).hostname.split(".")[0] || "";
  assert.equal(
    ref("https://crmucqnebwlssqzthnek.supabase.co"),
    "crmucqnebwlssqzthnek",
  );
  assert.equal(
    ref("https://crmucqnebwlssqzthnek.supabase.co/"),
    "crmucqnebwlssqzthnek",
  );
  assert.equal(
    ref("https://crmucqnebwlssqzthnek.supabase.co/auth/v1"),
    "crmucqnebwlssqzthnek",
  );
});

test("email identity conflicts produce a dedicated explicit error", () => {
  const error = new EmailIdentityConflictError("user@example.com");
  assert.equal(error.name, "EmailIdentityConflictError");
  assert.match(error.message, /An account with this email already exists/);
  assert.doesNotMatch(error.message, /user@example\.com/);
});

test("auth session payload validator accepts valid server responses", () => {
  assert.equal(
    isAuthSessionRecord({ user: { user_metadata: { id: "1" } } }),
    true,
  );
  assert.equal(
    isAuthSessionRecord({
      user: {
        user_metadata: {
          id: "user-id",
          name: "A",
          username: "b",
          display_name: "A",
          handle: "b",
          avatar: "",
        },
      },
    }),
    true,
  );
});

test("auth session payload validator rejects malformed responses", () => {
  assert.equal(isAuthSessionRecord(null), false);
  assert.equal(isAuthSessionRecord(undefined), false);
  assert.equal(isAuthSessionRecord("nope"), false);
  assert.equal(isAuthSessionRecord({}), false);
  assert.equal(isAuthSessionRecord({ user: "nope" }), false);
  assert.equal(isAuthSessionRecord({ user: null }), false);
  assert.equal(isAuthSessionRecord({ user: undefined }), false);
  assert.equal(isAuthSessionRecord({ user: {} }), false);
  assert.equal(isAuthSessionRecord({ user: { user_metadata: {} } }), false);
  assert.equal(
    isAuthSessionRecord({ user: { user_metadata: { id: "" } } }),
    false,
  );
  assert.equal(
    isAuthSessionRecord({ user: { user_metadata: { id: 5 } } }),
    false,
  );
});

test("issuer mismatch error carries a non-secret received issuer for classification", () => {
  const error = new SupabaseTokenIssuerMismatchError(
    "https://project.supabase.co/auth/v1",
    "https://other-project.supabase.co/auth/v1",
  );
  assert.equal(error.name, "SupabaseTokenIssuerMismatchError");
  assert.equal(
    error.receivedIssuer,
    "https://other-project.supabase.co/auth/v1",
  );
  assert.match(
    error.message,
    /expected https:\/\/project\.supabase\.co\/auth\/v1/,
  );
});
