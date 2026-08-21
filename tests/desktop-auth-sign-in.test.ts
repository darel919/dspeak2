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
const externalUrl = await readFile(
  new URL("../app/shared/desktop-external-url.ts", import.meta.url),
  "utf8",
);

const tauriMain = await readFile(
  new URL("../desktop/src-tauri/src/desktop/mod.rs", import.meta.url),
  "utf8",
);

test("desktop sign-in opens the system browser", () => {
  assert.match(authStore, /openExternalUrl\(data\.url, true\)/);
  assert.match(externalUrl, /@tauri-apps\/plugin-opener/);
  assert.doesNotMatch(authStore, /@tauri-apps\/plugin-shell/);
});

test("sign-in startup failures replace the terms form", () => {
  assert.match(authPage, /showTerms\.value = false/);
  assert.match(authPage, /console\.error\("\[Auth\] Could not start sign-in:/);
});

test("desktop sign-in uses Supabase OAuth PKCE flow", () => {
  assert.match(authStore, /get_oauth_callback_url/);
  assert.match(authStore, /callbackUrl\.searchParams\.set\("state", state\)/);
  assert.match(authStore, /signInWithOAuth\(\{/);
  assert.match(authStore, /redirectTo: desktopRedirect/);
  assert.match(authStore, /skipBrowserRedirect: true/);
  assert.match(authStore, /exchangeDesktopOAuthCode/);
  assert.match(authStore, /desktopOAuth\.setFlowId\(desktopOAuthFlowId\)/);
  assert.match(authStore, /desktopOAuth\.getFlowId\(\)/);
  assert.match(authStore, /createDesktopOAuthStateStore/);
  assert.doesNotMatch(authStore, /exchangeCodeForSession\(callbackCode\)/);
  assert.match(authStore, /isDesktopOAuthStateValid\(expectedState, state\)/);
  assert.match(authStore, /DESKTOP_OAUTH_CALLBACK_RECEIVED/);
  assert.match(authStore, /DESKTOP_OAUTH_STATE_VALIDATED/);
  assert.match(authStore, /DESKTOP_OAUTH_CODE_EXCHANGE_SUCCEEDED/);
  assert.match(authStore, /SESSION_BRIDGE_REQUEST/);
  assert.match(authStore, /SESSION_BRIDGE_RESPONSE/);
  assert.match(authStore, /DESKTOP_API_SESSION_BRIDGE_SUCCEEDED/);
  assert.match(authStore, /DESKTOP_SIGN_IN_COMPLETE/);
  assert.match(authStore, /desktop-session/);
  assert.doesNotMatch(authStore, /X-Desktop-App/);
  assert.doesNotMatch(authStore, /desktop-callback-session/);
  assert.match(authPage, /authStore\.completePendingDesktopSignIn\(\)/);
  assert.match(authPage, /authStore\.hasPendingDesktopOAuthAttempt\(\)/);
  assert.match(authPage, /authStore\.cancelDesktopSignIn\(\)/);
  assert.match(authStore, /desktopOAuthSessionExchanged/);
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
  assert.match(authStore, /return \{ isDesktop: true, loginUrl: data\.url \}/);
  assert.match(
    authStore,
    /return \{ isDesktop: false, loginUrl: result\.url \}/,
  );
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

test("desktop sign-in keeps PKCE and API bridge failures distinct", () => {
  assert.match(authStore, /DESKTOP_OAUTH_CODE_EXCHANGE_FAILED/);
  assert.match(authStore, /DESKTOP_API_SESSION_BRIDGE_FAILED/);
  assert.match(authPage, /could not verify the sign-in/);
  assert.match(authPage, /could not create your app session/);
  assert.match(authStore, /hasFlowId/);
  assert.match(authStore, /diagnosticCategory/);
  assert.doesNotMatch(authStore, /console\.(log|info|error)[^\n]*callbackCode/);
});

test("web sign-in finishes after exchanging the callback", () => {
  assert.match(authPage, /await authStore\.restoreSession\(\)/);
  assert.doesNotMatch(
    authPage,
    /window\.location\.replace\([\s\S]*tauri:\/\/callback/,
  );
});

test("duplicate callback joins the in-flight promise before exchange-state logic", () => {
  assert.ok(
    authStore.indexOf(
      "if (desktopCallbackPromise && desktopCallbackCode === callbackCode) {",
    ) < authStore.indexOf("if (desktopOAuthSessionExchanged) {"),
    "same-callback promise check must precede desktopOAuthSessionExchanged",
  );
});

test("duplicate callback cannot start a restore while the bridge is in flight", () => {
  assert.ok(
    authStore.indexOf("return desktopCallbackPromise;") <
      authStore.indexOf(
        "const restoreResult = await restoreSessionDetailed();",
      ),
    "in-flight promise join must come before restore fallback",
  );
});

test("original bridge error is preserved and rethrown before restore fallback", () => {
  assert.match(
    authStore,
    /request\.then\(\s*\(\) => \{[\s\S]*?\},\s*\(error\) => \{[\s\S]*?desktopCallbackPromiseError = isDesktopAuthError\(error\)[\s\S]*?parseThrownError\(error\);[\s\S]*?desktopCallbackPromise = null;[\s\S]*?desktopCallbackCode = "";/,
  );
  assert.match(
    authStore,
    /if \(desktopOAuthSessionExchanged\) \{[\s\S]*?if \(\n\s*desktopCallbackPromiseError &&\n\s*isDesktopAuthError\(desktopCallbackPromiseError\)\n\s*\) \{\n\s*throw desktopCallbackPromiseError;\n\s*\}\n\s*const restoreResult = await restoreSessionDetailed\(\);/,
  );
});

test("stale promise error resets on clear and new attempts", () => {
  assert.match(
    authStore,
    /function clearDesktopOAuthAttempt\(\) \{[\s\S]*?desktopCallbackPromiseError = null;/,
  );
  assert.match(
    authStore,
    /desktopCallbackCode = callbackCode;\n\s*desktopCallbackPromiseError = null;/,
  );
  assert.match(
    authStore,
    /request\.then\(\s*\(\) => \{[\s\S]*?desktopCallbackPromiseError = null;\s*\},/,
  );
});

test("callback ownership is explicit and atomic", () => {
  assert.match(authStore, /const request = \(async \(\) => \{/);
  assert.match(
    authStore,
    /desktopCallbackCode = callbackCode;\n\s*desktopCallbackPromiseError = null;\n\s*const request/,
  );
  assert.match(
    authStore,
    /desktopCallbackPromise = request;\n\s*request\.then\(/,
  );
});

test("restore failures carry diagnostic reasons", () => {
  assert.match(authStore, /type RestoreSessionResult/);
  assert.match(
    authStore,
    /"NO_SUPABASE_SESSION"|"TRANSPORT_ERROR"|"HTTP_ERROR"|"INVALID_PAYLOAD"|"UNKNOWN"/,
  );
  assert.match(authStore, /restoreSessionDetailed/);
});

test("restore-only fallback is last resort with no preserved bridge error", () => {
  assert.match(
    authStore,
    /desktopCallbackPromiseError &&\n\s*isDesktopAuthError\(desktopCallbackPromiseError\)\n\s*\) \{[\s\S]*?throw desktopCallbackPromiseError;\n\s*\}\n\s*const restoreResult = await restoreSessionDetailed\(\);/,
  );
  assert.match(
    authStore,
    /const restoreResult = await restoreSessionDetailed\(\);\n\s*if \(restoreResult\.ok\) return true;/,
  );
  assert.match(authStore, /DESKTOP_API_SESSION_RESTORE_FAILED/);
  assert.doesNotMatch(authStore, /if \(await restoreSessionDetailed\(\)\)/);
});

test("restore failure surfaces diagnostic reason instead of truthy collapse", () => {
  assert.match(authStore, /httpStatus: restoreResult\.httpStatus \?\? 0,/);
  assert.match(
    authStore,
    /serverDiagnostic:\n\s*restoreResult\.serverDiagnostic \|\|\n\s*`DESKTOP_SESSION_RESTORE_\$\{restoreResult\.reason\}`,/,
  );
  assert.match(
    authStore,
    /serverBuildCommit: restoreResult\.serverBuildCommit \|\| "",/,
  );
  assert.match(
    authStore,
    /serverProjectRef: restoreResult\.serverProjectRef \|\| "",/,
  );
});

test("event and polling both converge on completeDesktopSignIn", () => {
  assert.match(
    desktopCallback,
    /authStore\.completeDesktopSignIn\(code, payload\?\.state/,
  );
  assert.match(authPage, /authStore\.completePendingDesktopSignIn\(\)/);
  assert.match(
    authStore,
    /return completeDesktopSignIn\(pendingCode, pendingState\)/,
  );
});

test("different callback code while a promise is in flight is rejected", () => {
  assert.match(
    authStore,
    /if \(desktopCallbackPromise && desktopCallbackCode === callbackCode\) \{[\s\S]*?return desktopCallbackPromise;[\s\S]*?\}\n\s*if \(desktopCallbackPromise && desktopCallbackCode !== callbackCode\) \{[\s\S]*?throw withDesktopDiagnostics\(/,
  );
});
