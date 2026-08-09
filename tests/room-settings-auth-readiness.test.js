import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const source = await readFile(
  new URL("../app/pages/room/[roomId]/settings.vue", import.meta.url),
  "utf8",
);
const roomsApi = await readFile(
  new URL("../server/utils/dspeak-rooms-api.js", import.meta.url),
  "utf8",
);
const oauthProfile = await readFile(
  new URL("../server/auth/oauth-profile.js", import.meta.url),
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

  it("persists room appearance, attenuation, and uploaded images", () => {
    assert.match(roomsApi, /contentType\.includes\("multipart\/form-data"\)/);
    assert.match(roomsApi, /replaceRoomImage\(room\.id, "profile"/);
    assert.match(roomsApi, /replaceRoomImage\(room\.id, "header"/);
    assert.match(roomsApi, /update\.accent = normalizeRoomAccent/);
    assert.match(roomsApi, /update\.attenuation = normalizeAttenuation/);
    assert.match(roomsApi, /roomImages/);
  });

  it("imports provider avatars into the protected avatar store", () => {
    assert.match(oauthProfile, /user_metadata\?\.avatar_url/);
    assert.match(oauthProfile, /fetchPublicBytes/);
    assert.match(oauthProfile, /putObject\(\s*avatarKey/);
    assert.match(oauthProfile, /tx\.insert\(avatars\)/);
  });
});
