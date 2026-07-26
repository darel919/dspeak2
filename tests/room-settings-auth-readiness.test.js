import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const source = await readFile(
  new URL("../app/pages/room/[roomId]/settings.vue", import.meta.url),
  "utf8",
);

describe("room settings authentication readiness", () => {
  it("waits for restored authentication before loading protected room data", () => {
    assert.match(
      source,
      /watch\(\s*\[\(\) => authStore\.getUserData\(\)\?\.id, roomId\]/,
    );
    assert.match(source, /if \(!userId\) return;/);
    assert.doesNotMatch(source, /onMounted\(load\)/);
  });

  it("keeps startup pending until the initial settings request settles", () => {
    assert.match(
      source,
      /startupReadiness\?\.hold\("Loading room settings…"\)/,
    );
    assert.match(source, /releaseInitialSettingsLoad\(\)/);
  });
});
