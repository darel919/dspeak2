import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { validateRuntimeEnvironment } from "../server/utils/env-validation.ts";

const originalEnvironment = { ...process.env };
const originalFetch = globalThis.fetch;

beforeEach(() => {
  process.env = {
    ...originalEnvironment,
    DATABASE_URL: "postgresql://postgres:password@db.example.com/postgres",
    SUPABASE_URL: "https://project-ref.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    CF_MEDIA_CONTROL_URL: "https://media-control.example.com",
    CF_MEDIA_CONTROL_ADMIN_TOKEN: "admin-token",
    CF_MEDIA_TICKET_PRIVATE_KEY: "private-key",
    CF_R2_ACCOUNT_ID: "account-id",
    CF_R2_ACCESS_KEY_ID: "access-key",
    CF_R2_SECRET_ACCESS_KEY: "secret-key",
    CF_R2_BUCKET_NAME: "bucket",
    DSPEAK_CSRF_SECRET: "test-secret-with-at-least-32-characters",

    VAPID_PUBLIC_KEY: "public",
    VAPID_PUBKEY: "public",
    VAPID_PRIVKEY: "private",
    VAPID_SUBJECT: "mailto:operator@example.com",
    DSPEAK_PUBLIC_ORIGIN: "https://app.example.com",
  };
});

afterEach(() => {
  process.env = { ...originalEnvironment };
  globalThis.fetch = originalFetch;
});

test("development accepts an exact HTTP loopback public origin", async () => {
  process.env.NODE_ENV = "development";
  process.env.DSPEAK_PUBLIC_ORIGIN = "http://localhost:3000";

  await assert.doesNotReject(validateRuntimeEnvironment());
});

test("production rejects an HTTP loopback public origin", async () => {
  process.env.NODE_ENV = "production";
  process.env.DSPEAK_PUBLIC_ORIGIN = "http://localhost:3000";
  process.env.DSPEAK_METRICS_TOKEN = "metrics-secret";
  process.env.DSPEAK_CRON_SECRET = "cron-secret";

  await assert.rejects(validateRuntimeEnvironment(), /must be an HTTPS origin/);
});

test("requires a VAPID subject", async () => {
  delete process.env.VAPID_SUBJECT;

  await assert.rejects(
    validateRuntimeEnvironment(),
    /Missing required environment variables: VAPID_SUBJECT/,
  );
});

test("rejects a VAPID subject without a URL scheme", async () => {
  process.env.VAPID_SUBJECT = "operator@example.com";

  await assert.rejects(
    validateRuntimeEnvironment(),
    /VAPID_SUBJECT must be valid/,
  );
});

test("rejects an unsupported VAPID subject protocol", async () => {
  process.env.VAPID_SUBJECT = "http://operator.example.com";

  await assert.rejects(
    validateRuntimeEnvironment(),
    /VAPID_SUBJECT must use https or mailto/,
  );
});

test("accepts an HTTPS VAPID subject", async () => {
  process.env.VAPID_SUBJECT = "https://operator.example.com/push-contact";

  await assert.doesNotReject(validateRuntimeEnvironment());
});

test("requires Cloudflare TURN credentials together", async () => {
  process.env.CF_TURN_APP_ID = "app-id";
  delete process.env.CF_TURN_API_KEY;

  await assert.rejects(
    validateRuntimeEnvironment(),
    /CF_TURN_APP_ID and CF_TURN_API_KEY must be configured together/,
  );
});

test("requires the shared RTC hostname when TURN is enabled", async () => {
  delete process.env.DSPEAK_RTC_DOMAIN;
  process.env.TURN_SHARED_SECRET = "test-secret";

  await assert.rejects(
    validateRuntimeEnvironment(),
    /DSPEAK_RTC_DOMAIN is required when TURN_SHARED_SECRET is configured/,
  );
});

test("rejects unsafe TURN credential lifetimes", async () => {
  process.env.DSPEAK_RTC_DOMAIN = "rtc.dspeak.example.com";
  process.env.TURN_SHARED_SECRET = "test-secret";
  process.env.TURN_CREDENTIAL_TTL_SECONDS = "60";

  await assert.rejects(
    validateRuntimeEnvironment(),
    /TURN_CREDENTIAL_TTL_SECONDS must be an integer between 300 and 3600/,
  );
});
