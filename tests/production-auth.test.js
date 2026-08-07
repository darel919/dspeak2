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
const auth = await readFile(
  new URL("../server/utils/auth.js", import.meta.url),
  "utf8",
);
const authPage = await readFile(
  new URL("../app/pages/auth.vue", import.meta.url),
  "utf8",
);
const authStore = await readFile(
  new URL("../app/stores/auth.js", import.meta.url),
  "utf8",
);
const accountPage = await readFile(
  new URL("../app/pages/settings.vue", import.meta.url),
  "utf8",
);
const settingsPage = await readFile(
  new URL("../app/pages/settings.vue", import.meta.url),
  "utf8",
);
const defaultLayout = await readFile(
  new URL("../app/layouts/default.vue", import.meta.url),
  "utf8",
);
const dspeakApi = files[0];

test("protected server paths resolve identity through authenticated sessions", () => {
  const combined = files.join("\n");
  assert.doesNotMatch(combined, /getHeader\(event,\s*["']authorization["']\)/);
  assert.doesNotMatch(combined, /searchParams\.get\("auth"\)/);
  assert.doesNotMatch(combined, /searchParams\.get\("userId"\)/);
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
  assert.doesNotMatch(worker, /Authorization:\s*mes...r/);
  assert.doesNotMatch(worker, /apiConfigReceived|SET_API_CONFIG/);
});

test("protected browser routes stay on the cookie-owning origin", () => {
  assert.match(runtimeConfig, /apiPath:/);
  assert.match(runtimeConfig, /websocketPath:/);
  assert.match(runtimeConfig, /sfuPath:/);
  assert.match(runtimeConfig, /:\s*"\/api"/);
  assert.doesNotMatch(runtimeConfig, /DSPEAK_(API|WS|SFU)_URL/);
});

test("auth.js uses Supabase Auth with local JWT verification", () => {
  assert.match(auth, /verifyAccessToken/);
  assert.match(auth, /createHmac/);
  assert.match(auth, /createHash/);
  assert.doesNotMatch(auth, /PocketBase/);
  assert.doesNotMatch(auth, /ACCOUNT_URL/);
  assert.doesNotMatch(auth, /AUTH_HANDOFF_CONSENT_COOKIE/);
});

test("external authentication never puts access tokens in URLs", () => {
  assert.doesNotMatch(dspeakApi, /body\.accessToken/);
  assert.doesNotMatch(authPage, /route\.query\.at|searchParams\.set\("at/);
  assert.doesNotMatch(authPage, /accessToken|verify\?at=/);
  assert.match(authPage, /route\.query\.code/);
  assert.match(authPage, /route\.query\.state/);
});

test("failed SSO callbacks stop with an actionable error instead of looping", () => {
  assert.match(authPage, /Sign-in interrupted/);
  assert.match(authPage, /Try sign-in again/);
  assert.doesNotMatch(authPage, /setTimeout\(resolve,\s*10000\)/);
});

test("desktop sign-in opens the system browser and exposes startup failures", () => {
  assert.match(
    authStore,
    /const \{ open \} = await import\("@tauri-apps\/plugin-shell"\)/,
  );
  assert.match(authStore, /await open\(result\.url\)/);
  assert.doesNotMatch(authStore, /const \{ shell \}/);
  assert.match(authPage, /showTerms\.value = false/);
  assert.match(authPage, /console\.error\("\[Auth\] Could not start sign-in:"/);
});

test("authentication state changes do not remount and replay the callback", () => {
  assert.equal(defaultLayout.match(/<slot\s*\/>/g)?.length, 1);
  assert.match(authPage, /await router\.replace\("\/auth"\)/);
  assert.match(authPage, /async function finishAuthentication\(\)/);
  assert.match(authPage, /watch\(\s*\(\) => authStore\.getUserData\(\)\?\.id,/);
  assert.match(
    authStore,
    /if \(getUserData\(\)\?\.id\) \{[\s\S]{0,200}sessionChecked\.value = true;[\s\S]{0,80}return true;/,
  );
  assert.doesNotMatch(authPage, /history\.replaceState/);
});

test("logout awaits a user-scoped browser-data purge before navigation", () => {
  assert.match(authStore, /const userId = String\(getUserData\(\)\?\.id/);
  assert.match(authStore, /chatCleanup[\s\S]*purgeUserLocalData\(userId\)/);
  assert.match(authStore, /useChatStore\(\)\.clearChat\(\)/);
  assert.match(accountPage, /await authStore\.clearAuth\(\)/);
  assert.match(settingsPage, /await authStore\.clearAuth\(\)/);
  assert.doesNotMatch(authStore, /resetLocalDatabases/);
});
