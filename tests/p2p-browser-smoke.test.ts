import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("browser P2P smoke avoids bundle-global signaling name collisions", async () => {
  const source = await readFile("scripts/p2p-browser-smoke.mjs", "utf8");

  assert.match(source, /window\.deliverSignal/);
  assert.doesNotMatch(source, /window\.receiveSignal\s*=/);
  assert.doesNotMatch(source, /window\.receiveSignal\(/);
});
