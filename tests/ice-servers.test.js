import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  PUBLIC_STUN_SERVERS,
  createCloudflareTurnServers,
  createIceServers,
  createTurnCredentials,
} from "../server/const/ice-servers.js";

test("TURN credentials use the Coturn REST timestamp and HMAC contract", () => {
  const credentials = createTurnCredentials({
    secret: "test-secret",
    ttlSeconds: 900,
    now: 1_700_000_000_000,
  });
  assert.equal(credentials.username, "1700000900:dspeak");
  assert.equal(credentials.expiresAt, 1700000900);
  assert.equal(
    credentials.credential,
    createHmac("sha1", "test-secret")
      .update(credentials.username)
      .digest("base64"),
  );
});

test("self-hosted TURN is ordered after public STUN without community relays", () => {
  const servers = createIceServers(
    {
      DSPEAK_RTC_DOMAIN: "rtc.example.com",
      TURN_SHARED_SECRET: "test-secret",
      TURN_CREDENTIAL_TTL_SECONDS: "600",
    },
    1_700_000_000_000,
    { connectionMode: "auto" },
  );
  assert.equal(servers[0], PUBLIC_STUN_SERVERS[0]);
  assert.equal(servers[1], PUBLIC_STUN_SERVERS[1]);
  assert.equal(servers[2], PUBLIC_STUN_SERVERS[2]);
  assert.match(servers[3].urls[0], /^stun:rtc\.example\.com/);
  assert.match(servers[3].urls[1], /^turn:rtc\.example\.com/);
  assert.equal(servers.length, PUBLIC_STUN_SERVERS.length + 1);
});

test("TURN is excluded in direct mode", () => {
  const servers = createIceServers(
    {
      DSPEAK_RTC_DOMAIN: "rtc.example.com",
      TURN_SHARED_SECRET: "test-secret",
      TURN_CREDENTIAL_TTL_SECONDS: "600",
    },
    1_700_000_000_000,
    { connectionMode: "direct" },
  );
  assert.deepEqual(servers, PUBLIC_STUN_SERVERS);
});

test("Cloudflare TURN credentials are generated server-side", async () => {
  let request;
  const servers = await createCloudflareTurnServers(
    {
      CF_TURN_APP_ID: "app-id",
      CF_TURN_API_KEY: "api-key",
      CF_TURN_CREDENTIAL_TTL_SECONDS: "3600",
    },
    async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        async json() {
          return {
            iceServers: [
              {
                urls: ["turn:turn.cloudflare.com:3478?transport=udp"],
                username: "temporary-user",
                credential: "temporary-credential",
              },
            ],
          };
        },
      };
    },
  );
  assert.match(
    request.url,
    /\/turn\/keys\/app-id\/credentials\/generate-ice-servers$/,
  );
  assert.equal(request.options.headers.Authorization, "Bearer api-key");
  assert.deepEqual(JSON.parse(request.options.body), { ttl: 3600 });
  assert.equal(servers.length, 1);
  assert.equal(servers[0].username, "temporary-user");
});
