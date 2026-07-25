import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { validateRuntimeEnvironment } from "../server/utils/env-validation.js";

const originalEnvironment = { ...process.env };
const originalFetch = globalThis.fetch;

beforeEach(() => {
  process.env = {
    ...originalEnvironment,
    AUTH_PATH: "https://api.example.com/auth",
    POCKETBASE_URL: "https://pocketbase.example.com",
    PBASE_ADMIN_EMAIL: "admin@example.com",
    PBASE_ADMIN_PASSWORD: "secret",
    DSPEAK_CSRF_SECRET: "test-secret-with-at-least-32-characters",
    VAPID_PUBLIC_KEY: "public",
    VAPID_PUBKEY: "public",
    VAPID_PRIVKEY: "private",
    DSPEAK_PUBLIC_ORIGIN: "https://app.example.com",
    MEDIASOUP_LISTEN_IP: "0.0.0.0",
    MEDIASOUP_ANNOUNCED_ADDRESS: "auto",
    MEDIASOUP_RTC_PORT: "40000",
    MEDIASOUP_ANNOUNCED_PORT: "45678",
  };
});

afterEach(() => {
  process.env = { ...originalEnvironment };
  globalThis.fetch = originalFetch;
});

test("auto-discovers a globally routable IPv6 address", async () => {
  globalThis.fetch = async () => new Response("2404:c0:ba03:9eb::10\n");

  const config = await validateRuntimeEnvironment();

  assert.equal(config.announcedAddress, "2404:c0:ba03:9eb::10");
  assert.equal(config.rtcPort, 40000);
  assert.equal(config.announcedPort, 45678);
  assert.equal(config.maxClientOutgoingBitrate, 4_500_000);
  assert.equal(config.maxServerOutgoingBitrate, 40_000_000);
});

test("rejects an SFU per-client limit above the global server budget", async () => {
  process.env.MEDIASOUP_ANNOUNCED_ADDRESS = "rtc.dspeak.example.com";
  process.env.MEDIASOUP_MAX_CLIENT_OUTGOING_BITRATE = "41000000";
  process.env.MEDIASOUP_MAX_SERVER_OUTGOING_BITRATE = "40000000";

  await assert.rejects(validateRuntimeEnvironment(), /cannot exceed/);
});

test("rejects IPv4 returned by automatic discovery", async () => {
  globalThis.fetch = async () => new Response("203.0.113.10");

  await assert.rejects(
    validateRuntimeEnvironment(),
    /expected a globally routable IPv6 address/,
  );
});

test("rejects reserved IPv6 returned by automatic discovery", async () => {
  globalThis.fetch = async () => new Response("2001:db8::10");

  await assert.rejects(
    validateRuntimeEnvironment(),
    /expected a globally routable IPv6 address/,
  );
});

test("keeps a DNS-only hostname override unchanged", async () => {
  process.env.MEDIASOUP_ANNOUNCED_ADDRESS = "rtc.dspeak.example.com";

  const config = await validateRuntimeEnvironment();

  assert.equal(config.announcedAddress, "rtc.dspeak.example.com");
});

test("development accepts an exact HTTP loopback public origin", async () => {
  process.env.NODE_ENV = "development";
  process.env.DSPEAK_PUBLIC_ORIGIN = "http://localhost:3000";
  process.env.MEDIASOUP_ANNOUNCED_ADDRESS = "rtc.dspeak.example.com";

  await assert.doesNotReject(validateRuntimeEnvironment());
});

test("production rejects an HTTP loopback public origin", async () => {
  process.env.NODE_ENV = "production";
  process.env.DSPEAK_PUBLIC_ORIGIN = "http://localhost:3000";
  process.env.DSPEAK_METRICS_TOKEN = "metrics-secret";
  process.env.MEDIASOUP_ANNOUNCED_ADDRESS = "rtc.dspeak.example.com";

  await assert.rejects(validateRuntimeEnvironment(), /must be an HTTPS origin/);
});

test("requires the shared RTC hostname when TURN is enabled", async () => {
  process.env.MEDIASOUP_ANNOUNCED_ADDRESS = "rtc.dspeak.example.com";
  delete process.env.DSPEAK_RTC_DOMAIN;
  process.env.TURN_SHARED_SECRET = "test-secret";

  await assert.rejects(
    validateRuntimeEnvironment(),
    /DSPEAK_RTC_DOMAIN is required when TURN_SHARED_SECRET is configured/,
  );
});

test("rejects unsafe TURN credential lifetimes", async () => {
  process.env.MEDIASOUP_ANNOUNCED_ADDRESS = "rtc.dspeak.example.com";
  process.env.DSPEAK_RTC_DOMAIN = "rtc.dspeak.example.com";
  process.env.TURN_SHARED_SECRET = "test-secret";
  process.env.TURN_CREDENTIAL_TTL_SECONDS = "60";

  await assert.rejects(
    validateRuntimeEnvironment(),
    /TURN_CREDENTIAL_TTL_SECONDS must be an integer between 300 and 3600/,
  );
});
