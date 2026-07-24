import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = await Promise.all(
  [
    "../server/utils/dspeak-api.js",
    "../server/utils/soundboard-api.js",
    "../server/routes/api/chat/socket.js",
    "../server/routes/api/presence.js",
    "../server/routes/api/voice-presence.js",
    "../server/utils/mediasoup-sfu.js",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
);
const applicationSources = await Promise.all(
  [
    "../app/stores/rooms.js",
    "../app/stores/channels.js",
    "../app/stores/chat.js",
    "../app/stores/notifications.js",
    "../app/stores/identity.js",
    "../app/stores/soundboard.js",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
);
const worker = await readFile(
  new URL("../public/sw.js", import.meta.url),
  "utf8",
);
const runtimeConfig = await readFile(
  new URL("../nuxt.config.ts", import.meta.url),
  "utf8",
);
const authentication = await readFile(
  new URL("../server/utils/authentication.js", import.meta.url),
  "utf8",
);
const migrations = await readFile(
  new URL("../server/utils/pocketbase-migrations.js", import.meta.url),
  "utf8",
);
const authPage = await readFile(
  new URL("../app/pages/auth.vue", import.meta.url),
  "utf8",
);
const dspeakApi = files[0];

test("protected server paths resolve identity through authenticated sessions", () => {
  const combined = files.join("\n");
  assert.doesNotMatch(combined, /getHeader\(event,\s*["']authorization["']\)/);
  assert.doesNotMatch(combined, /searchParams\.get\(["']auth["']\)/);
  assert.doesNotMatch(combined, /searchParams\.get\(["']userId["']\)/);
  assert.match(
    combined,
    /requireAuthenticatedUser|authenticateWebSocketRequest/,
  );
});

test("client API calls do not send user identifiers as authorization", () => {
  assert.doesNotMatch(applicationSources.join("\n"), /Authorization\s*:/);
});

test("offline delivery uses cookie authentication and stable idempotency", () => {
  assert.match(worker, /credentials:\s*"include"/);
  assert.match(worker, /clientMessageId:\s*message\.id/);
  assert.match(worker, /ownerId:\s*message\.ownerId/);
  assert.doesNotMatch(worker, /Authorization:\s*message\.sender/);
  assert.doesNotMatch(worker, /apiConfigReceived|SET_API_CONFIG/);
});

test("protected browser routes stay on the cookie-owning origin", () => {
  assert.match(runtimeConfig, /apiPath:\s*"\/api"/);
  assert.match(runtimeConfig, /websocketPath:\s*""/);
  assert.match(runtimeConfig, /sfuPath:\s*""/);
  assert.doesNotMatch(runtimeConfig, /DSPEAK_(API|WS|SFU)_URL/);
});

test("sessions rotate per device and are stored only as hashes", () => {
  assert.match(authentication, /randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(authentication, /token_hash:\s*hashSessionToken\(rawToken\)/);
  assert.match(authentication, /user = \{:user\} && device_id = \{:device\}/);
  assert.doesNotMatch(authentication, /token:\s*rawToken/);
});

test("external authentication never puts access tokens in URLs", () => {
  assert.doesNotMatch(authentication, /accessToken|verify\?at=/);
  assert.doesNotMatch(dspeakApi, /body\.accessToken/);
  assert.doesNotMatch(authPage, /route\.query\.at|searchParams\.set\(["']at/);
  assert.match(authPage, /route\.query\.code/);
  assert.match(authPage, /route\.query\.state/);
  assert.match(authentication, /session-handoff-exchange/);
});

test("failed SSO callbacks stop with an actionable error instead of looping", () => {
  assert.match(authPage, /Sign-in interrupted/);
  assert.match(authPage, /Try sign-in again/);
  assert.doesNotMatch(authPage, /setTimeout\(resolve,\s*10000\)/);
});

test("notification migration reconciles duplicates before uniqueness", () => {
  const cleanupIndex = migrations.indexOf("notificationKeys.has(key)");
  const indexIndex = migrations.indexOf(
    "idx_dspeak_notifications_message_recipient",
  );
  assert.ok(cleanupIndex >= 0);
  assert.ok(indexIndex > cleanupIndex);
});
