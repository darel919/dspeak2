import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeMediaPolicy,
  validateMediaPolicy,
} from "../shared/media-policy.js";

test("legacy channel audio bitrate populates microphone and shared audio", () => {
  const policy = normalizeMediaPolicy({}, 160);
  assert.equal(policy.microphoneKbps, 160);
  assert.equal(policy.sharedAudioKbps, 160);
});

test("media policy rejects invalid ceilings", () => {
  const result = validateMediaPolicy({
    microphoneKbps: 5,
    cameraKbps: 4500,
    screenKbps: 8000,
    sharedAudioKbps: 128,
  });
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /microphoneKbps/);
});
