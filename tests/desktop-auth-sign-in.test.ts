import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const authStore = await readFile(
  new URL("../app/stores/auth.ts", import.meta.url),
  "utf8",
);
const authPage = await readFile(
  new URL("../app/pages/auth.vue", import.meta.url),
  "utf8",
);
const desktopCallback = await readFile(
  new URL("../app/composables/useDeepLinkAuth.ts", import.meta.url),
  "utf8",
);

const tauriMain = await readFile(
  new URL("../desktop/src-tauri/src/desktop/mod.rs", import.meta.url),
  "utf8",
);

test("desktop sign-in opens the system browser", () => {
  assert.match(
    authStore,
    /const \{ open \} = await import\("@tauri-apps\/plugin-shell"\)/,
  );
  assert.match(authStore, /await open\(result\.url\)/);
  assert.doesNotMatch(authStore, /const \{ shell \}/);
});

test("sign-in startup failures replace the terms form", () => {
  assert.match(authPage, /showTerms\.value = false/);
  assert.match(authPage, /console\.error\("\[Auth\] Could not start sign-in:/);
});

test("desktop sign-in uses Supabase OAuth PKCE flow", () => {
  assert.match(authStore, /\/auth\/google/);
  assert.match(authStore, /X-Desktop-App/);
  assert.match(authPage, /authStore\.completePendingDesktopSignIn\(\)/);
  assert.match(
    authStore,
    /desktop-callback-session[\s\S]*credentials: "include"/,
  );
  assert.match(authStore, /completedDesktopCallbackCode/);
});

test("desktop sign-in registers native callbacks and background notifications without exposing browser cookies", () => {
  assert.match(tauriMain, /register_background_notifications/);
  assert.match(tauriMain, /set_background_notifications_enabled/);
  assert.match(desktopCallback, /get_pending_oauth_callback/);
  assert.match(authStore, /completeDesktopSignIn/);
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
  assert.match(authStore, /return \{ isDesktop, loginUrl: result\.url \}/);
});

test("desktop sign-in polls for the native callback while waiting", () => {
  assert.match(authPage, /function startSignInPolling\(\)/);
  assert.match(
    authPage,
    /setInterval\(\(\) => void checkSignIn\(false\), 1000\)/,
  );
  assert.match(authPage, /if \(signInCheckInFlight\) return/);
  assert.match(authPage, /clearSignInPolling\(\)/);
});

test("web sign-in finishes after exchanging the callback", () => {
  assert.match(authPage, /await authStore\.restoreSession\(\)/);
  assert.doesNotMatch(
    authPage,
    /window\.location\.replace\([\s\S]*tauri:\/\/callback/,
  );
});
