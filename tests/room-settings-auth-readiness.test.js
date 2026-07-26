import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const source = await readFile(
  new URL("../app/pages/room/[roomId]/settings.vue", import.meta.url),
  "utf8",
);

describe("room settings authentication readiness", () => {
  it("loads normally after the application-level authentication gate", () => {
    assert.match(source, /onMounted\(async \(\) => \{/);
    assert.doesNotMatch(
      source,
      /\[\(\) => authStore\.getUserData\(\)\?\.id, roomId\]/,
    );
  });

  it("keeps startup pending until the initial settings request settles", () => {
    assert.match(
      source,
      /startupReadiness\?\.hold\("Loading room settings…"\)/,
    );
    assert.match(source, /releaseInitialSettingsLoad\(\)/);
  });

  it("uses the global navigation error surface for missing room access", () => {
    assert.match(source, /canAccessRoomAdministration\(room\.value\)/);
    assert.match(source, /presentNavigationError\(/);
    assert.doesNotMatch(source, /InvalidLinkState/);
  });
});
