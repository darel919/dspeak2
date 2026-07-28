import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../app/pages/room/create.vue", import.meta.url),
  "utf8",
);

test("room creation page passes the room name and description to the store", () => {
  assert.match(
    source,
    /roomsStore\.createRoom\(\s*roomName\.value,\s*roomDesc\.value,?\s*\)/,
  );
});
