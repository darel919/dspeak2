import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const roomRoot = await readFile(
  new URL("../app/pages/room/[roomId]/index.vue", import.meta.url),
  "utf8",
);
const roomChannel = await readFile(
  new URL("../app/pages/room/[roomId]/[channelId]/index.vue", import.meta.url),
  "utf8",
);

test("direct room routes resolve access even when the room list omits the room", () => {
  for (const source of [roomRoot, roomChannel]) {
    assert.match(source, /await roomsStore\.getRoomDetails\(requestedRoomId\)/);
    assert.match(source, /presentNavigationError\(/);
    assert.doesNotMatch(source, /InvalidLinkState/);
    assert.match(source, /watch\(roomId, resolveRoomAccess\)/);
    assert.match(source, /generation !== roomAccessGeneration/);
  }
});

test("invalid channel links release initial startup readiness", () => {
  assert.match(
    roomChannel,
    /presentNavigationError\([\s\S]*releaseInitialChannelReadiness\(\)/,
  );
});
