import assert from "node:assert/strict";
import test from "node:test";
import {
  availableSystemSoundThemes,
  systemSoundAsset,
} from "../app/shared/system-sounds.js";

test("default voice lifecycle sounds use supplied public Ogg assets", () => {
  assert.deepEqual(availableSystemSoundThemes(), ["default"]);
  assert.equal(systemSoundAsset("voice-join"), "/sounds/default_connect.ogg");
  assert.equal(
    systemSoundAsset("voice-leave"),
    "/sounds/default_disconnect.ogg",
  );
});
