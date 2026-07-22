import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  COMMUNITY_TURN_SERVERS,
  PUBLIC_STUN_SERVERS,
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

test("self-hosted TURN is ordered before public STUN and community TURN", () => {
  const servers = createIceServers(
    {
      DSPEAK_RTC_DOMAIN: "rtc.example.com",
      TURN_SHARED_SECRET: "test-secret",
      TURN_CREDENTIAL_TTL_SECONDS: "600",
    },
    1_700_000_000_000,
  );
  assert.match(servers[0].urls[0], /^stun:rtc\.example\.com/);
  assert.match(servers[0].urls[1], /^turn:rtc\.example\.com/);
  assert.equal(servers[1], PUBLIC_STUN_SERVERS[0]);
  assert.equal(servers.at(-1), COMMUNITY_TURN_SERVERS.at(-1));
});

test("community fallbacks remain when self-hosted TURN is disabled", () => {
  const servers = createIceServers({});
  assert.deepEqual(
    servers.slice(0, PUBLIC_STUN_SERVERS.length),
    PUBLIC_STUN_SERVERS,
  );
  assert.deepEqual(
    servers.slice(PUBLIC_STUN_SERVERS.length),
    COMMUNITY_TURN_SERVERS,
  );
});
