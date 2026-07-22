import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("authenticated shell owns fixed navigation and page content", async () => {
  const layout = await readFile("app/layouts/default.vue", "utf8");
  assert.match(layout, /v-if="authenticated" class="authenticated-shell"/);
  assert.match(layout, /<MetroRoomRail\s*\/>/);
  assert.match(layout, /<Navbar\s*\/>/);
});

test("Metro geometry covers shell, overlays, and standalone utility flows", async () => {
  const css = await readFile("app/assets/app.css", "utf8");
  for (const boundary of [
    ".authenticated-shell *",
    ".metro-standalone *",
    ".metro-pane *",
    ".modal *",
    ".toast *",
  ])
    assert.equal(css.includes(boundary), true, `${boundary} must stay square`);
});

test("authenticated page copy consistently calls shared spaces rooms", async () => {
  const files = [
    "app/pages/index.vue",
    "app/components/MobileRoomSidebar.vue",
    "app/components/MobileChannelList.vue",
  ];
  const source = (
    await Promise.all(files.map((file) => readFile(file, "utf8")))
  ).join("\n");
  assert.doesNotMatch(
    source,
    /Join Server|Create Server|No servers|This server|Select a server/,
  );
});

test("channel editor owns the complete live media policy", async () => {
  const source = await readFile("app/components/ChannelList.vue", "utf8");
  const roomSettings = await readFile(
    "app/pages/room/[roomId]/settings.vue",
    "utf8",
  );
  const api = await readFile("server/utils/dspeak-api.js", "utf8");
  assert.match(source, /channel\.manage_media_policy/);
  assert.match(source, /editingChannelPolicy\[field\.key\]/);
  assert.doesNotMatch(roomSettings, /Channel media policies/);
  assert.doesNotMatch(api, /body\.audio_bitrate && channel\.isMedia/);
});

test("room settings opens the full administration route", async () => {
  const source = await readFile("app/components/ChannelList.vue", "utf8");
  assert.match(
    source,
    /navigateTo\(`\/room\/\$\{props\.room\.id\}\/settings`\)/,
  );
  assert.doesNotMatch(source, /showRoomSettings/);
});

test("voice controls resize the stage instead of covering participant tiles", async () => {
  const source = await readFile("app/components/VoiceChannel.vue", "utf8");
  assert.match(source, /class="voice-controls-shell"/);
  assert.match(source, /grid-template-rows: 0fr/);
  assert.match(source, /\.voice-channel:hover \.voice-controls-shell/);
  assert.doesNotMatch(source, /class="voice-controls absolute/);
});

test("room administration uses explicit responsive form layouts", async () => {
  const source = await readFile("app/pages/room/[roomId]/settings.vue", "utf8");
  assert.doesNotMatch(source, /class="form-control/);
  assert.match(source, /lg:grid-cols-\[220px_minmax\(0,1fr\)\]/);
  assert.match(source, /file-input file-input-bordered w-full min-w-0/);
});

test("room role assignments use explicit role controls instead of a native multi-select", async () => {
  const source = await readFile("app/pages/room/[roomId]/settings.vue", "utf8");
  assert.doesNotMatch(source, /<select[\s\S]*multiple/);
  assert.match(source, /toggleMembershipRole\(membership, role\.id\)/);
  assert.match(source, /assignmentChanged\(membership\)/);
  assert.match(source, /membershipSystemRoles\(membership\)/);
});

test("room rail owns a permission-aware context menu", async () => {
  const source = await readFile("app/components/MetroRoomRail.vue", "utf8");
  assert.match(source, /@contextmenu\.prevent\.stop="openRoomMenu/);
  assert.match(source, /openSelectedRoomSettings/);
  assert.match(source, /copySelectedRoomInvite/);
  assert.match(source, /deleteSelectedRoom/);
  assert.match(source, /leaveSelectedRoom/);
});
