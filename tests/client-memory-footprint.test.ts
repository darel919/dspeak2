import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("room channels load only the active chat or voice interface", async () => {
  const source = await readFile(
    "app/pages/room/[roomId]/[channelId]/index.vue",
    "utf8",
  );

  assert.match(source, /const ChatWindow = defineAsyncComponent/);
  assert.match(source, /const VoiceChannel = defineAsyncComponent/);
  assert.doesNotMatch(source, /import ChatWindow from/);
  assert.doesNotMatch(source, /import VoiceChannel from/);
});

test("audio-only voice defers video and desktop-capture interfaces", async () => {
  const source = await readFile("app/components/VoiceChannel.vue", "utf8");

  assert.match(source, /const DesktopCapturePicker = defineAsyncComponent/);
  assert.match(source, /const VideoFeed = defineAsyncComponent/);
  assert.match(source, /<DesktopCapturePicker\s+v-if="capturePickerOpen"/);
});

test("compact soundboard loads its library only when opened", async () => {
  const [panel, store] = await Promise.all([
    readFile("app/components/SoundboardPanel.vue", "utf8"),
    readFile("app/stores/soundboard.ts", "utf8"),
  ]);

  assert.match(panel, /@click="openPanel"/);
  assert.match(panel, /if \(!props\.compact\) store\.load\(props\.roomId\)/);
  assert.match(panel, /store\.connectEvents\(props\.roomId\)/);
  assert.match(store, /function hasLoadedLibrary\(roomId: string\)/);
  assert.match(
    store,
    /if \(roomId !== null\) \{[\s\S]*currentRoomId\.value = normalizedRoomId/,
  );
  assert.match(store, /loadedRoomId\.value !== normalizedRoomId/);
  assert.match(store, /clips\.value = \[\]/);
});
