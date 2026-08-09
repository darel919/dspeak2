import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canManageSoundboardClip,
  normalizeSoundboardMetadata,
  presentSoundboardClip,
  SOUNDBOARD_MAX_CLIPS_PER_ROOM,
  SOUNDBOARD_MAX_DURATION_SECONDS,
  SOUNDBOARD_MAX_SOURCE_BYTES,
} from "../shared/soundboard.js";

test("soundboard limits retain the room contract", () => {
  assert.equal(SOUNDBOARD_MAX_SOURCE_BYTES, 5 * 1024 * 1024);
  assert.equal(SOUNDBOARD_MAX_DURATION_SECONDS, 10);
  assert.equal(SOUNDBOARD_MAX_CLIPS_PER_ROOM, 50);
});

test("soundboard metadata is bounded and receives safe defaults", () => {
  assert.deepEqual(normalizeSoundboardMetadata({ title: "  Door   bell  " }), {
    title: "Door bell",
    category: "General",
    icon: "",
    enabled: true,
  });
  assert.equal(
    normalizeSoundboardMetadata({ title: "x".repeat(80) }).title.length,
    48,
  );
});

test("uploaders manage their own sounds while room managers manage every sound", () => {
  const clip = { uploader: "person-a" };
  assert.equal(canManageSoundboardClip(clip, "person-a"), true);
  assert.equal(canManageSoundboardClip(clip, "person-b"), false);
  assert.equal(
    canManageSoundboardClip(clip, "admin", ["room.manage_soundboard"]),
    true,
  );
});

test("soundboard presentation exposes only the protected media route", () => {
  const clip = presentSoundboardClip({
    id: "clip-1",
    room: "room-1",
    uploader: "user-1",
    title: "Bell",
    category: "Alerts",
    icon: "🔔",
    media: "private-file.ogg",
    duration: 1.25,
    display_order: 2,
    enabled: true,
  });
  assert.equal(clip.mediaUrl, "/api/soundboard/media?id=clip-1");
  assert.equal(JSON.stringify(clip).includes("private-file.ogg"), false);
});

test("soundboard triggers carry server-owned player attribution", async () => {
  const source = await readFile("server/utils/soundboard-api.js", "utf8");
  assert.match(source, /triggeredBy: String\(userId\)/);
  assert.match(source, /clipTitle: clip\.name/);
  assert.match(source, /duration: Number\(clip\.duration\)/);
  assert.match(source, /activityId: crypto\.randomUUID\(\)/);
});

test("soundboard activity follows actual audio completion", async () => {
  const store = await readFile("app/stores/soundboard.js", "utf8");
  const media = await readFile(
    "app/composables/useHybridMediaSession.js",
    "utf8",
  );
  assert.match(store, /await play\(data\.clipId, data\.roomId\)/);
  assert.match(store, /voiceStore\.clearSoundboardActivity/);
  assert.doesNotMatch(media, /voiceStore\.showSoundboardActivity/);
});
