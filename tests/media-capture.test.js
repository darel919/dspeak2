import assert from "node:assert/strict";
import test from "node:test";
import {
  audioConstraints,
  canFallbackToDefaultMicrophone,
  captureMicrophone,
  sharedAudioConstraints,
} from "../app/shared/media-capture.js";

test("microphone constraints preserve processing preferences and selected device", () => {
  assert.deepEqual(
    audioConstraints({
      audio: { echoCancellation: false, noiseSuppression: true },
      micDeviceId: "microphone-1",
    }),
    {
      echoCancellation: false,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: { ideal: 1 },
      sampleRate: { ideal: 48000 },
      deviceId: { exact: "microphone-1" },
    },
  );
});

test("HD microphone capture requests stereo", () => {
  const constraints = audioConstraints({}, true);
  assert.deepEqual(constraints.channelCount, { ideal: 2 });
  assert.equal(constraints.autoGainControl, true);
});

test("shared audio disables destructive speech processing", () => {
  assert.deepEqual(sharedAudioConstraints(), {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: { ideal: 2 },
    sampleRate: { ideal: 48000 },
    restrictOwnAudio: true,
    suppressLocalAudioPlayback: false,
  });
});

test("failed selected microphone resets after system-default capture succeeds", async () => {
  const expectedStream = { id: "default-stream" };
  const calls = [];
  let fallback = null;
  const mediaDevices = {
    async getUserMedia(constraints) {
      calls.push(constraints);
      if (calls.length === 1)
        throw Object.assign(new Error("Selected device is gone"), {
          name: "NotFoundError",
        });
      return expectedStream;
    },
  };
  const stream = await captureMicrophone({
    mediaDevices,
    settings: { micDeviceId: "missing-device" },
    onFallback: (details) => {
      fallback = details;
    },
  });
  assert.equal(stream, expectedStream);
  assert.deepEqual(calls[0].audio.deviceId, { exact: "missing-device" });
  assert.equal(calls[1].audio.deviceId, undefined);
  assert.equal(fallback.failedDeviceId, "missing-device");
});

test("permission failures never trigger a second microphone request", async () => {
  let requests = 0;
  const denied = Object.assign(new Error("Denied"), {
    name: "NotAllowedError",
  });
  await assert.rejects(
    captureMicrophone({
      mediaDevices: {
        async getUserMedia() {
          requests += 1;
          throw denied;
        },
      },
      settings: { micDeviceId: "selected-device" },
    }),
    denied,
  );
  assert.equal(requests, 1);
  assert.equal(
    canFallbackToDefaultMicrophone(denied, "selected-device"),
    false,
  );
});
