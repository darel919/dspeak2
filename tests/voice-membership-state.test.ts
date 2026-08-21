import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("transient media route health does not clear voice membership", async () => {
  const source = await readFile("app/shared/voice-media-actions.ts", "utf8");

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

  assert.doesNotMatch(source, /Connect to " \+ props\.channel\.name/);
  assert.match(source, /@click="joinThisChannel"/);
});

test("disconnected channel fallback does not list the local user", async () => {
  const source = await readFile("app/components/ChannelList.vue", "utf8");

  assert.match(
    source,
    /function getChannelParticipants\(channel\)[\s\S]*filter\(\(userId\) => String\(userId\) !== currentUserId\)/,
  );
});

test("connected voice rows follow the room presence snapshot", async () => {
  const source = await readFile("app/components/ChannelList.vue", "utf8");

  assert.match(source, /getConnectedChannelParticipants\(channel\)/);
  assert.match(
    source,
    /function getConnectedChannelParticipants\(channel\)[\s\S]*channel\.inRoom \|\| \[\]\)\.map/,
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
  const source = await readFile("app/shared/voice-media-actions.ts", "utf8");

  assert.match(
    source,
    /connected\.value = true[\s\S]*addConnectedUser\(authenticatedUser\.id/,
  );
});

test("native microphone permission failure keeps the voice session muted", async () => {
  const source = await readFile("app/shared/voice-media-actions.ts", "utf8");

  assert.match(
    source,
    /isNativeMicrophonePermissionError[\s\S]*micMuted\.value = true[\s\S]*joining muted/,
  );
  assert.match(
    source,
    /!isTauriRuntime\(\)[\s\S]*!isNativeMicrophonePermissionError\(captureError\)[\s\S]*throw captureError/,
  );
});

test("microphone unmute enables publication before capture and rolls back failures", async () => {
  const source = await readFile("app/shared/voice-media-actions.ts", "utf8");
  const toggleStart = source.indexOf("async function toggleMicInternal()");
  const toggleEnd = source.indexOf(
    "async function toggleDeafenInternal()",
    toggleStart,
  );
  const toggle = source.slice(toggleStart, toggleEnd);
  const enableIntent = toggle.indexOf("micMuted.value = false;");
  const captureStart = toggle.indexOf("session.startAudioProduction()");
  const rollback = toggle.indexOf("micMuted.value = true;", captureStart);

  assert.ok(enableIntent >= 0);
  assert.ok(captureStart > enableIntent);
  assert.ok(rollback > captureStart);
  assert.match(toggle, /await waitForAudioSourceFlow\(session\)/);
});

test("native participant snapshots hydrate profiles before membership rendering", async () => {
  const source = await readFile(
    "app/composables/media/native-media-engine-session.ts",
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
  assert.match(source, /<div v-show="startupComplete \|\| isAuthPage">/);
});

test("desktop uses a tray-owned window that is created on demand", async () => {
  const config = await readFile("desktop/src-tauri/tauri.conf.json", "utf8");
  const initSource = await readFile("app/components/Init.vue", "utf8");

  assert.match(config, /"windows": \[\]/);
  assert.doesNotMatch(config, /"label": "init"/);
  assert.match(initSource, /<StartupLoader[\s\S]*:visible="true"/);
  assert.match(initSource, /invoke\("desktop_ready"\)/);
});

test("desktop notifications honor the local enabled preference", async () => {
  const source = await readFile("app/stores/notifications.ts", "utf8");

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
  const source = await readFile(
    "desktop/src-tauri/src/desktop/window.rs",
    "utf8",
  );

  assert.match(
    source,
    /HIDE_ON_CLOSE\.load\(Ordering::Relaxed\)[\s\S]*window_clone\.destroy\(\)/,
  );
  assert.match(source, /WebviewWindowBuilder::new\(/);
  assert.match(source, /fn open_main_window\(app: &tauri::AppHandle\)/);
});

test("macOS tray left click opens the on-demand main webview", async () => {
  const source = await readFile(
    "desktop/src-tauri/src/desktop/tray.rs",
    "utf8",
  );

  assert.match(source, /show_menu_on_left_click\(false\)/);
  assert.match(source, /TrayIconEvent::Click/);
  assert.match(source, /MouseButton::Left/);
  assert.match(source, /open_main_window\(tray\.app_handle\(\)\)/);
});

test("macOS Dock reopen recreates the on-demand main webview", async () => {
  const source = await readFile("desktop/src-tauri/src/desktop/mod.rs", "utf8");

  assert.match(source, /\.build\(tauri::generate_context!\(\)\)/);
  assert.match(source, /tauri::RunEvent::Reopen/);
  assert.match(source, /open_main_window\(app_handle\)/);
});

test("desktop startup opens the UI unless it is launched minimized", async () => {
  const [script, source] = await Promise.all([
    readFile("desktop/scripts/dev-desktop.sh", "utf8"),
    readFile("desktop/src-tauri/src/desktop/mod.rs", "utf8"),
  ]);

  assert.match(script, /DSPEAK_DESKTOP_SHOW=.*:-1/);
  assert.match(script, /export DSPEAK_DESKTOP_SHOW/);
  assert.match(source, /DSPEAK_DESKTOP_SHOW/);
  assert.match(source, /argument == "--show"/);
  assert.match(source, /argument == "--minimized"/);
  assert.match(source, /!launched_minimized/);
  assert.match(source, /environment_show_override\.unwrap_or\(true\)/);
});

test("desktop close behavior supports persistent tray and exit modes", async () => {
  const [windowSource, settingsSource] = await Promise.all([
    readFile("desktop/src-tauri/src/desktop/window.rs", "utf8"),
    readFile("app/pages/settings.vue", "utf8"),
  ]);

  assert.match(windowSource, /DESKTOP_PREFERENCES_FILE/);
  assert.match(windowSource, /closeToTray/);
  assert.match(windowSource, /media::shutdown_for_exit/);
  assert.match(windowSource, /app\.exit\(0\)/);
  assert.match(settingsSource, /Close dSpeak window/);
  assert.match(settingsSource, /Minimize to tray/);
  assert.match(settingsSource, /Exit dSpeak/);
  assert.match(settingsSource, /set_hide_on_close/);
});

test("active calls keep signaling alive until the media state disconnects", async () => {
  const [windowSource, desktopSource] = await Promise.all([
    readFile("desktop/src-tauri/src/desktop/window.rs", "utf8"),
    readFile("desktop/src-tauri/src/desktop/mod.rs", "utf8"),
  ]);

  assert.match(windowSource, /media::is_connected/);
  assert.doesNotMatch(windowSource, /media::clear_video_surfaces/);
  assert.match(windowSource, /window_clone\.hide\(\)/);
  assert.match(desktopSource, /app\.listen\(media::MEDIA_EVENT_STATE/);
  assert.match(desktopSource, /!window\.is_visible\(\)\.unwrap_or\(true\)/);
  assert.match(desktopSource, /window\.destroy\(\)/);
});
