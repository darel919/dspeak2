import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("transient media route health does not clear voice membership", async () => {
  const source = await readFile("app/stores/voice.js", "utf8");

  assert.doesNotMatch(
    source,
    /mediaConnectionState[\s\S]{0,300}connected\.value\s*=\s*false/,
  );
  assert.match(
    source,
    /async function leaveVoiceChannel[\s\S]*connected\.value\s*=\s*false/,
  );
  assert.match(
    source,
    /async function disposeFailedSession[\s\S]*connected\.value\s*=\s*false/,
  );
});

test("voice channel does not render duplicate disconnected join panels", async () => {
  const source = await readFile("app/components/VoiceChannel.vue", "utf8");

  assert.doesNotMatch(source, /Connect to \" \+ props\.channel\.name/);
  assert.match(source, /@click="joinThisChannel"/);
});

test("disconnected channel fallback does not list the local user", async () => {
  const source = await readFile("app/components/ChannelList.vue", "utf8");

  assert.match(
    source,
    /function getChannelParticipants\(channel\)[\s\S]*filter\(\(userId\) => String\(userId\) !== currentUserId\)/,
  );
});

test("connected empty voice channels render an explicit empty state", async () => {
  const source = await readFile("app/components/VoiceChannel.vue", "utf8");

  assert.match(
    source,
    /v-if="roomTiles\.length"[\s\S]*v-else[\s\S]*You’re the only one here/,
  );
});

test("joining voice inserts the local participant after media connects", async () => {
  const source = await readFile("app/stores/voice.js", "utf8");

  assert.match(
    source,
    /connected\.value = true[\s\S]*addConnectedUser\(authenticatedUser\.id/,
  );
});

test("native microphone permission failure keeps the voice session muted", async () => {
  const source = await readFile("app/stores/voice.js", "utf8");

  assert.match(
    source,
    /isNativeMicrophonePermissionError[\s\S]*micMuted\.value = true[\s\S]*joining muted/,
  );
  assert.match(
    source,
    /!isTauriRuntime\(\)[\s\S]*!isNativeMicrophonePermissionError\(captureError\)[\s\S]*throw captureError/,
  );
});

test("native participant snapshots hydrate profiles before membership rendering", async () => {
  const source = await readFile(
    "app/composables/media/nativeMediaEngine.js",
    "utf8",
  );
  const snapshot = source.slice(source.indexOf("onCurrentlyInChannel"));
  assert.match(snapshot, /const profiles = Array\.isArray\(data\?\.profiles\)/);
  assert.ok(
    snapshot.indexOf("upsertUserProfile") <
      snapshot.indexOf("addConnectedUser"),
  );
  assert.match(snapshot, /if \(authenticatedUser\?\.id\)\s*active\.add/);
});

test("desktop uses one visible startup loader before the app shell mounts", async () => {
  const source = await readFile("app/components/Init.vue", "utf8");

  assert.match(source, /<StartupLoader[\s\S]*:visible="true"/);
  assert.match(source, /Starting dSpeak…/);
  assert.match(source, /<div v-if="startupComplete \|\| isAuthPage">/);
});

test("desktop uses the visible main window for startup", async () => {
  const config = await readFile("desktop/src-tauri/tauri.conf.json", "utf8");
  const initSource = await readFile("app/components/Init.vue", "utf8");

  assert.match(config, /"label": "main"[\s\S]*"visible": true/);
  assert.doesNotMatch(config, /"label": "init"/);
  assert.match(initSource, /<StartupLoader[\s\S]*:visible="true"/);
  assert.match(initSource, /invoke\("desktop_ready"\)/);
});

test("desktop notifications honor the local enabled preference", async () => {
  const source = await readFile("app/stores/notifications.js", "utf8");

  assert.match(
    source,
    /hasTauriRuntimeMarker\(\)[\s\S]*notificationManager\.isEnabled/,
  );
  assert.match(source, /invoke\("show_notification"/);
  assert.match(
    source,
    /function checkPushSupport\(\)[\s\S]*hasTauriRuntimeMarker\(\)[\s\S]*pushSupported\.value = false/,
  );
});

test("tray mode destroys the main webview and recreates it on demand", async () => {
  const source = await readFile("desktop/src-tauri/src/main.rs", "utf8");

  assert.match(
    source,
    /HIDE_ON_CLOSE\.load\(Ordering::Relaxed\)[\s\S]*window_clone\.destroy\(\)/,
  );
  assert.match(source, /WebviewWindowBuilder::from_config\(app, config\)/);
  assert.match(source, /fn open_main_window\(app: &tauri::AppHandle\)/);
});
