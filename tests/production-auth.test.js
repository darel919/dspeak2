import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = await Promise.all(
  [
    "../server/utils/dspeak-api.js",
    "../server/utils/soundboard-api.js",
    "../server/utils/media-control-admin.js",
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
const supabaseAuth = await readFile(
  new URL("../server/auth/supabase.js", import.meta.url),
  "utf8",
);
const oauthCallback = await readFile(
  new URL("../server/routes/api/auth/callback.get.js", import.meta.url),
  "utf8",
);
const oauthCallbackSession = await readFile(
  new URL(
    "../server/routes/api/auth/callback-session.post.js",
    import.meta.url,
  ),
  "utf8",
);
const securityMiddleware = await readFile(
  new URL("../server/middleware/security.js", import.meta.url),
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
const profilesRepository = await readFile(
  new URL("../server/db/repositories/profiles.js", import.meta.url),
  "utf8",
);
const randomUsername = await readFile(
  new URL("../server/auth/random-username.js", import.meta.url),
  "utf8",
);
const oauthProfile = await readFile(
  new URL("../server/auth/oauth-profile.js", import.meta.url),
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

test("browser push registration uses the registered push-subscriptions route", () => {
  const notificationsStore = applicationSources[3];
  assert.match(notificationsStore, /apiPath}\/push-subscriptions/);
  assert.doesNotMatch(notificationsStore, /chat\/subscribe\/global/);
  assert.match(notificationsStore, /enable: true/);
  assert.match(notificationsStore, /enable: false/);
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
  assert.doesNotMatch(runtimeConfig, /websocketPath:/);
  assert.doesNotMatch(runtimeConfig, /sfuPath:/);
  assert.match(runtimeConfig, /:\s*"\/api"/);
  assert.doesNotMatch(runtimeConfig, /DSPEAK_(API|WS|SFU)_URL/);
});

test("auth.js uses Supabase Auth with local JWT verification", () => {
  assert.match(auth, /verifyAccessToken/);
  assert.match(auth, /createHmac/);
  assert.match(auth, /setCookie\(event, SESSION_COOKIE, accessToken/);

  assert.doesNotMatch(auth, /ACCOUNT_URL/);
});

test("server OAuth uses PKCE so callbacks receive a query code", () => {
  assert.match(supabaseAuth, /flowType:\s*["']pkce["']/);
  assert.match(authPage, /route\.query\.code/);
  assert.doesNotMatch(authPage, /provider_refresh_token/);
});

test("web OAuth redirects before profile provisioning can block callback navigation", () => {
  assert.match(oauthCallback, /createPendingOAuthSession\(session\)/);
  assert.doesNotMatch(
    oauthCallback,
    /profileRepository|getOrCreateOnFirstLogin/,
  );
  assert.match(oauthCallbackSession, /provisionOAuthProfile\(session\.user\)/);
});

test("OAuth code exchange has a bounded provider wait", async () => {
  const exchange = await readFile(
    new URL("../server/auth/oauth-exchange.js", import.meta.url),
    "utf8",
  );
  assert.match(exchange, /oauthExchangeTimeoutMs = 20_000/);
  assert.match(exchange, /Promise\.race/);
});

test("OAuth profile provisioning has a bounded database wait", async () => {
  const profile = await readFile(
    new URL("../server/auth/oauth-profile.js", import.meta.url),
    "utf8",
  );
  assert.match(profile, /profileProvisioningTimeoutMs = 15_000/);
  assert.match(profile, /Promise\.race/);
});

test("OAuth first login allocates usernames across account and profile records", () => {
  assert.match(profilesRepository, /from\(users\)/);
  assert.match(profilesRepository, /users_username_unique/);
  assert.match(profilesRepository, /profiles_username_unique/);
  assert.match(profilesRepository, /usernameRetryLimit/);
  assert.match(profilesRepository, /generateRandomUsername/);
  assert.doesNotMatch(profilesRepository, /preferredUsername/);
  assert.doesNotMatch(oauthProfile, /username:\s*user\.user_metadata/);
  assert.match(randomUsername, /randomInt\(100, 1000\)/);
  assert.match(
    randomUsername,
    /\$\{randomItem\(adjectives\)\}_\$\{randomItem\(nouns\)\}/,
  );
  assert.match(
    profilesRepository,
    /username,[\s\S]*onConflictDoNothing\(\{ target: users\.id \}\)/,
  );
});

test("client session restoration targets the registered auth session route", () => {
  assert.match(authStore, /apiPath}\/auth\/session/);
  assert.doesNotMatch(authStore, /apiPath}\/session/);
  assert.doesNotMatch(authStore, /event !== "SIGNED_IN"/);
  assert.doesNotMatch(authStore, /restoreDesktopNotificationSession/);
});

test("OAuth callback accepts the external provider navigation", () => {
  assert.match(securityMiddleware, /oauthCallbackPaths/);
  assert.match(securityMiddleware, /oauthCallbackPaths\.has\(path\)/);
  assert.match(securityMiddleware, /["']\/api\/auth\/callback["']/);
});

test("one-time browser OAuth handoff bypasses only CSRF token validation", () => {
  assert.match(securityMiddleware, /csrfExemptPaths/);
  assert.match(securityMiddleware, /["']\/api\/auth\/callback-session["']/);
  assert.match(securityMiddleware, /["']\/api\/auth\/session["']/);
  assert.match(authStore, /callback-session/);
});

test("server OAuth stores PKCE state in a short-lived HTTP-only cookie", async () => {
  const supabaseSource = await readFile(
    new URL("../server/auth/supabase.js", import.meta.url),
    "utf8",
  );
  assert.match(supabaseSource, /createOAuthSupabaseClient/);
  assert.match(supabaseSource, /httpOnly: true/);
  assert.match(supabaseSource, /sameSite: "lax"/);
  assert.match(supabaseSource, /maxAge: 600/);
  assert.match(supabaseSource, /storageKey: oauthStorageKey/);
});

test("external authentication never puts access tokens in URLs", () => {
  assert.doesNotMatch(dspeakApi, /body\.accessToken/);
  assert.doesNotMatch(authPage, /route\.query\.at|searchParams\.set\("at/);
  assert.doesNotMatch(authPage, /accessToken|verify\?at=/);
  assert.match(authPage, /route\.query\.code/);
  assert.match(authPage, /completeWebSignIn/);
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
  assert.match(
    authPage,
    /const completed = await authStore\.completeWebSignIn\(callbackCode\);[\s\S]*if \(!completed\) throw new Error[\s\S]*await finishAuthentication\(\);[\s\S]*return;/,
  );
  assert.doesNotMatch(authPage, /router\.replace\("\/auth"\)/);
  assert.match(authPage, /async function finishAuthentication\(\)/);
  assert.match(authPage, /if \(completionPromise\) return completionPromise/);
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
