import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const authStore = await readFile(
  new URL("../app/stores/auth.js", import.meta.url),
  "utf8",
);
const authPage = await readFile(
  new URL("../app/pages/auth.vue", import.meta.url),
  "utf8",
);
const desktopCallback = await readFile(
  new URL("../app/composables/useDeepLinkAuth.js", import.meta.url),
  "utf8",
);
const tauriMain = await readFile(
  new URL("../desktop/src-tauri/src/main.rs", import.meta.url),
  "utf8",
);

test("desktop sign-in opens the system browser", () => {
  assert.match(
    authStore,
    /const \{ open \} = await import\("@tauri-apps\/plugin-shell"\)/,
  );
  assert.match(authStore, /await open\(result\.loginUrl\)/);
  assert.doesNotMatch(authStore, /const \{ shell \}/);
});

test("sign-in startup failures replace the terms form", () => {
  assert.match(authPage, /showTerms\.value = false/);
  assert.match(authPage, /console\.error\("\[Auth\] Could not start sign-in:"/);
});

test("desktop sign-in automatically exchanges a loopback callback", () => {
  assert.match(tauriMain, /emit\("oauth-callback",/);
  assert.match(desktopCallback, /listen\("oauth-callback",/);
  assert.match(desktopCallback, /authStore\.exchangeHandoff\(code, state\)/);
  assert.match(desktopCallback, /unlistenOAuthCallback/);
  assert.match(authPage, /authStore\.completePendingDesktopSignIn\(\)/);
  assert.match(authStore, /invoke\("get_pending_oauth_callback"\)/);
  assert.match(authStore, /body: JSON\.stringify\(\{[\s\S]*redirectUri/);
  assert.match(authPage, /Could not complete desktop sign-in/);
});

test("desktop sign-in registers native background notifications without exposing browser cookies", () => {
  assert.match(authStore, /X-Desktop-App/);
  assert.match(authStore, /session\.desktopToken/);
  assert.match(authStore, /register_background_notifications/);
  assert.match(authStore, /set_credential/);
  assert.match(authStore, /restoreDesktopNotificationSession/);
  assert.match(authStore, /clear_background_notifications/);
  assert.match(tauriMain, /register_background_notifications/);
  assert.match(tauriMain, /set_background_notifications_enabled/);
  assert.match(tauriMain, /bearer_auth\(&session\.token\)/);
  assert.doesNotMatch(authStore, /document\.cookie/);
});

test("desktop sign-in provides a recoverable browser waiting state", () => {
  assert.match(authPage, /status\.value = "waiting"/);
  assert.match(authPage, /Waiting for browser/);
  assert.match(authPage, /Open browser again/);
  assert.match(authPage, /I've finished signing in/);
  assert.match(authPage, /Cancel/);
  assert.match(authPage, /180_000/);
  assert.match(authPage, /Sign-in was not completed/);
  assert.match(authStore, /return \{ isDesktop, loginUrl: result\.loginUrl \}/);
});

test("web sign-in finishes after exchanging the callback", () => {
  assert.match(
    authPage,
    /if \(valid\) \{\s+await finishAuthentication\(\);\s+return;/,
  );
  assert.doesNotMatch(
    authPage,
    /window\.location\.replace\([\s\S]*tauri:\/\/callback/,
  );
});
