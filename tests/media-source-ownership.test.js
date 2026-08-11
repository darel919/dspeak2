import assert from "node:assert/strict";
import test from "node:test";
import {
  isPairedScreenAudio,
  isStandaloneSystemAudio,
  normalizeMediaOwnerSource,
} from "../app/shared/media-source-ownership.js";

test("missing screen audio ownership defaults to paired consent", () => {
  assert.equal(normalizeMediaOwnerSource("screen-audio"), "screen");
  assert.equal(
    isPairedScreenAudio({ source: "screen-audio", ownerSource: null }),
    true,
  );
  assert.equal(
    isStandaloneSystemAudio({ source: "screen-audio", ownerSource: null }),
    false,
  );
});

test("standalone system audio remains explicitly identifiable", () => {
  const entry = {
    source: "screen-audio",
    ownerSource: "system-audio",
  };

  assert.equal(isStandaloneSystemAudio(entry), true);
  assert.equal(isPairedScreenAudio(entry), false);
});
