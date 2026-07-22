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
  assert.equal(policy.hdAudio, true);
});

test("legacy null media policy is normalized without breaking room responses", () => {
  assert.deepEqual(normalizeMediaPolicy(null, 96), {
    hdAudio: true,
    microphoneKbps: 96,
    cameraKbps: 1500,
    screenKbps: 4000,
    sharedAudioKbps: 96,
    revision: 1,
    updatedAt: null,
  });
});

test("media policy rejects invalid ceilings", () => {
  const result = validateMediaPolicy({
    hdAudio: false,
    microphoneKbps: 5,
    cameraKbps: 1500,
    screenKbps: 4000,
    sharedAudioKbps: 128,
  });
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /microphoneKbps/);
});

test("media policy validation rejects null input without throwing", () => {
  const result = validateMediaPolicy(null);
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 5);
});

test("standard and HD microphone modes enforce mono and stereo bitrate bands", () => {
  assert.equal(
    validateMediaPolicy({
      hdAudio: false,
      microphoneKbps: 48,
      cameraKbps: 1500,
      screenKbps: 4000,
      sharedAudioKbps: 128,
    }).valid,
    true,
  );
  assert.equal(
    validateMediaPolicy({
      hdAudio: false,
      microphoneKbps: 96,
      cameraKbps: 1500,
      screenKbps: 4000,
      sharedAudioKbps: 128,
    }).valid,
    false,
  );
});
