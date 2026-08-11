import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const config = await readFile(
  new URL("../nuxt.config.ts", import.meta.url),
  "utf8",
);

test("Nitro enables WebSocket route handling for realtime endpoints", () => {
  assert.match(
    config,
    /nitro:\s*\{[\s\S]*experimental:\s*\{[\s\S]*websocket:\s*true/,
  );
});
