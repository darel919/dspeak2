import assert from "node:assert/strict";
import test from "node:test";
import {
  audioConstraints,
  canFallbackToDefaultMicrophone,
  captureMicrophone,
  MediaCaptureManager,
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

test("system audio start waits for processed publication", async () => {
  const track = fakeTrack("captured-system-audio");
  const stream = {
    getAudioTracks: () => [track],
    getVideoTracks: () => [{ stop() {} }],
    getTracks: () => [track],
  };
  let finishPublication;
  const published = new Promise((resolve) => {
    finishPublication = resolve;
  });
  const manager = new MediaCaptureManager({
    mediaDevices: {
      getDisplayMedia: async () => stream,
    },
    getSettings: () => ({}),
    onSource: () => published,
    onSourceEnded() {},
  });

  const starting = manager.startSystemAudio();
  let settled = false;
  starting.then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  finishPublication({ source: "screen-audio", track: { id: "processed" } });
  assert.equal((await starting).track.id, "processed");
});

test("screen capture requests the browser picker before publication work", async () => {
  const calls = [];
  const track = fakeTrack("captured-screen");
  const stream = {
    getAudioTracks: () => [],
    getVideoTracks: () => [track],
    getTracks: () => [track],
  };
  const manager = new MediaCaptureManager({
    mediaDevices: {
      getDisplayMedia(constraints) {
        calls.push(constraints);
        return Promise.resolve(stream);
      },
    },
    getSettings: () => ({
      screenVideo: { frameRate: 30, qualityPriority: "framerate" },
    }),
    onSource: () => Promise.resolve({ source: "screen", track }),
    onSourceEnded() {},
  });

  const starting = manager.startVideo("screen");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].video.frameRate.max, 30);
  await starting;
});

test("screen video refuses to overwrite standalone system audio", async () => {
  const audioTrack = fakeTrack("standalone-system-audio");
  audioTrack.kind = "audio";
  const manager = new MediaCaptureManager({
    mediaDevices: {
      getDisplayMedia: async () => {
        throw new Error("the picker must not open");
      },
    },
    getSettings: () => ({ screenVideo: {} }),
    onSource: () => Promise.resolve(),
    onSourceEnded() {},
  });
  manager.register("screen-audio", fakeStream(audioTrack), audioTrack, {
    ownerSource: "system-audio",
  });

  await assert.rejects(
    () => manager.startVideo("screen"),
    (error) => error?.code === "DESKTOP_CAPTURE_SOURCE_CONFLICT",
  );
  assert.equal(manager.sources.get("screen-audio").track, audioTrack);
  assert.equal(audioTrack.readyState, "live");
});

test("standalone system audio refuses to overwrite combined screen audio", async () => {
  const audioTrack = fakeTrack("combined-screen-audio");
  audioTrack.kind = "audio";
  const manager = new MediaCaptureManager({
    mediaDevices: {
      getDisplayMedia: async () => {
        throw new Error("the picker must not open");
      },
    },
    getSettings: () => ({}),
    onSource: () => Promise.resolve(),
    onSourceEnded() {},
  });
  manager.register("screen-audio", fakeStream(audioTrack), audioTrack, {
    ownerSource: "screen",
  });

  await assert.rejects(
    () => manager.startSystemAudio(),
    (error) => error?.code === "DESKTOP_CAPTURE_SOURCE_CONFLICT",
  );
  assert.equal(manager.sources.get("screen-audio").track, audioTrack);
  assert.equal(audioTrack.readyState, "live");
});

test("failed selected microphone falls back without losing its identity", async () => {
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
  assert.equal(stream.stream, expectedStream);
  assert.equal(stream.fallback, true);
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

function fakeTrack(id) {
  const listeners = new Map();
  return {
    id,
    readyState: "live",
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    applyConstraints() {
      return Promise.resolve();
    },
    stop() {
      if (this.readyState === "ended") return;
      this.readyState = "ended";
      listeners.get("ended")?.();
    },
  };
}

function fakeStream(track) {
  return {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  };
}

test("fallback microphone is replaced when the exact preferred device returns", async () => {
  const fallbackTrack = fakeTrack("fallback");
  const preferredTrack = fakeTrack("preferred");
  const fallbackStream = fakeStream(fallbackTrack);
  const preferredStream = fakeStream(preferredTrack);
  const published = [];
  const restored = [];
  let request = 0;
  const mediaDevices = {
    addEventListener() {},
    removeEventListener() {},
    async enumerateDevices() {
      return [{ kind: "audioinput", deviceId: "preferred-device" }];
    },
    async getUserMedia() {
      request += 1;
      if (request === 1)
        throw Object.assign(new Error("Missing"), { name: "NotFoundError" });
      return request === 2 ? fallbackStream : preferredStream;
    },
  };
  const manager = new MediaCaptureManager({
    mediaDevices,
    getSettings: () => ({ micDeviceId: "preferred-device" }),
    onSource: (entry) => published.push(entry.track.id),
    onSourceEnded() {},
    onMicrophoneRestored: (details) => restored.push(details.deviceId),
  });

  const initial = await manager.startMicrophone();
  assert.equal(initial.track, fallbackTrack);
  assert.equal(fallbackTrack.readyState, "live");

  const replacement = await manager.restorePreferredMicrophone();
  assert.equal(replacement.track, preferredTrack);
  assert.deepEqual(published, ["fallback", "preferred"]);
  assert.deepEqual(restored, ["preferred-device"]);
  assert.equal(fallbackTrack.readyState, "ended");
  assert.equal(manager.sources.get("audio").track, preferredTrack);
});

test("failed microphone publication keeps the currently published capture alive", async () => {
  const fallbackTrack = fakeTrack("fallback");
  const preferredTrack = fakeTrack("preferred");
  let publication = 0;
  let request = 0;
  const manager = new MediaCaptureManager({
    mediaDevices: {
      addEventListener() {},
      removeEventListener() {},
      async enumerateDevices() {
        return [{ kind: "audioinput", deviceId: "preferred-device" }];
      },
      async getUserMedia() {
        request += 1;
        if (request === 1)
          throw Object.assign(new Error("Missing"), { name: "NotFoundError" });
        return request === 2
          ? fakeStream(fallbackTrack)
          : fakeStream(preferredTrack);
      },
    },
    getSettings: () => ({ micDeviceId: "preferred-device" }),
    onSource() {
      publication += 1;
      if (publication === 2) throw new Error("transport replacement failed");
    },
    onSourceEnded() {},
  });

  await manager.startMicrophone();
  await assert.rejects(
    manager.restorePreferredMicrophone(),
    /transport replacement failed/,
  );

  assert.equal(manager.sources.get("audio").track, fallbackTrack);
  assert.equal(fallbackTrack.readyState, "live");
  assert.equal(preferredTrack.readyState, "ended");
});

test("device recovery does not guess when the preferred microphone is absent", async () => {
  const fallbackTrack = fakeTrack("fallback");
  let requests = 0;
  const manager = new MediaCaptureManager({
    mediaDevices: {
      addEventListener() {},
      removeEventListener() {},
      async enumerateDevices() {
        return [{ kind: "audioinput", deviceId: "another-device" }];
      },
      async getUserMedia() {
        requests += 1;
        if (requests === 1)
          throw Object.assign(new Error("Missing"), { name: "NotFoundError" });
        return fakeStream(fallbackTrack);
      },
    },
    getSettings: () => ({ micDeviceId: "preferred-device" }),
    onSource() {},
    onSourceEnded() {},
  });

  await manager.startMicrophone();
  assert.equal(await manager.restorePreferredMicrophone(), false);
  assert.equal(requests, 2);
  assert.equal(fallbackTrack.readyState, "live");
});

test("device reconciliation fails over even when an unplugged track stays live", async () => {
  const selectedTrack = fakeTrack("selected");
  const fallbackTrack = fakeTrack("fallback");
  const fallbackEvents = [];
  let request = 0;
  const manager = new MediaCaptureManager({
    mediaDevices: {
      addEventListener() {},
      removeEventListener() {},
      async enumerateDevices() {
        return [{ kind: "audioinput", deviceId: "another-device" }];
      },
      async getUserMedia() {
        request += 1;
        return request === 1
          ? fakeStream(selectedTrack)
          : fakeStream(fallbackTrack);
      },
    },
    getSettings: () => ({ micDeviceId: "preferred-device" }),
    onSource() {},
    onSourceEnded() {},
    onMicrophoneFallback: (details) =>
      fallbackEvents.push(details.failedDeviceId),
  });

  await manager.startMicrophone();
  assert.equal(selectedTrack.readyState, "live");
  const replacement = await manager.reconcileMicrophoneDevices();

  assert.equal(replacement.track, fallbackTrack);
  assert.equal(selectedTrack.readyState, "ended");
  assert.equal(fallbackTrack.readyState, "live");
  assert.deepEqual(fallbackEvents, ["preferred-device"]);
});

test("stopping camera cancels capture that has not finished opening", async () => {
  const track = fakeTrack("camera");
  track.kind = "video";
  track.applyConstraints = async () => {};
  const stream = {
    getAudioTracks: () => [],
    getVideoTracks: () => [track],
    getTracks: () => [track],
  };
  let finishCapture;
  let publications = 0;
  const manager = new MediaCaptureManager({
    mediaDevices: {
      getUserMedia: () =>
        new Promise((resolve) => {
          finishCapture = () => resolve(stream);
        }),
    },
    getSettings: () => ({ cameraVideo: {} }),
    onSource: () => {
      publications += 1;
    },
    onSourceEnded() {},
  });

  const starting = manager.startVideo("camera");
  manager.stop("camera");
  finishCapture();

  await assert.rejects(
    starting,
    (error) => error?.code === "MEDIA_START_CANCELLED",
  );
  assert.equal(track.readyState, "ended");
  assert.equal(publications, 0);
  assert.equal(manager.sources.has("camera"), false);
});

test("stopping camera wins over publication already in progress", async () => {
  const track = fakeTrack("camera");
  track.kind = "video";
  track.applyConstraints = async () => {};
  const stream = {
    getAudioTracks: () => [],
    getVideoTracks: () => [track],
    getTracks: () => [track],
  };
  let finishPublication;
  let ended = 0;
  const manager = new MediaCaptureManager({
    mediaDevices: {
      getUserMedia: async () => stream,
    },
    getSettings: () => ({ cameraVideo: {} }),
    onSource: () =>
      new Promise((resolve) => {
        finishPublication = resolve;
      }),
    onSourceEnded: () => {
      ended += 1;
    },
  });

  const starting = manager.startVideo("camera");
  while (!manager.sources.has("camera")) await Promise.resolve();
  manager.stop("camera");
  finishPublication({ source: "camera", track });

  await assert.rejects(
    starting,
    (error) => error?.code === "MEDIA_START_CANCELLED",
  );
  assert.equal(track.readyState, "ended");
  assert.equal(ended, 1);
  assert.equal(manager.sources.has("camera"), false);
});
