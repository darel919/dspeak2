import assert from "node:assert/strict";
import test from "node:test";
import { createMediaSourceController } from "../app/shared/media-source-controller.js";

function controller(overrides = {}) {
  const localSources = new Map();
  const sent = [];
  const failures = [];
  let stoppedMeter = 0;
  const instance = createMediaSourceController({
    capture: { stop() {} },
    connected: { value: true },
    createSharedAudioSource: async (entry) => entry,
    error: { value: null },
    getActiveProvider: () => "sfu",
    getIntentionalClose: () => false,
    getP2pMesh: () => null,
    getSfu: () => null,
    localSources,
    localVideoFeeds: { value: new Map() },
    producerFacade: (entry) => entry,
    refreshPublicMaps() {},
    reportSfuFailure: (reason) => failures.push(reason),
    send: (message) => sent.push(message),
    startLocalVoiceDetection() {},
    startSharedAudioMeter() {},
    stopLocalVoiceDetection() {},
    stopSharedAudioMeter: () => {
      stoppedMeter += 1;
    },
    topologyState: { value: { mode: "sfu", epoch: 2, sourceRevision: 3 } },
    voiceStore: { micMuted: false, deafened: false },
    ...overrides,
  });
  return {
    failures,
    instance,
    localSources,
    sent,
    stoppedMeter: () => stoppedMeter,
  };
}

test("failed SFU publication never advertises a local source", async () => {
  const harness = controller({
    getSfu: () => ({
      async addSource() {
        throw new Error("producer rejected");
      },
      removeSource() {},
    }),
  });
  const entry = {
    source: "audio",
    stream: {},
    track: { id: "microphone", readyState: "live" },
  };

  await assert.rejects(
    harness.instance.publishSource(entry),
    /producer rejected/,
  );

  assert.equal(harness.localSources.size, 0);
  assert.equal(
    harness.sent.some((message) => message.type === "media-sources"),
    false,
  );
  assert.equal(harness.failures.length, 1);
});

test("failed processed shared audio publication closes its processing graph", async () => {
  const harness = controller({
    getSfu: () => ({
      async addSource() {
        throw new Error("producer rejected");
      },
      removeSource() {},
    }),
  });
  const captureTrack = { id: "capture", readyState: "live" };
  const processedTrack = {
    id: "processed",
    readyState: "live",
    addEventListener() {},
  };
  harness.instance = createMediaSourceController({
    capture: { stop() {} },
    connected: { value: true },
    createSharedAudioSource: async (entry) => ({
      ...entry,
      captureTrack,
      track: processedTrack,
    }),
    error: { value: null },
    getActiveProvider: () => "sfu",
    getIntentionalClose: () => false,
    getP2pMesh: () => null,
    getSfu: () => ({
      async addSource() {
        throw new Error("producer rejected");
      },
      removeSource() {},
    }),
    localSources: harness.localSources,
    localVideoFeeds: { value: new Map() },
    producerFacade: (entry) => entry,
    refreshPublicMaps() {},
    reportSfuFailure() {},
    send() {},
    startLocalVoiceDetection() {},
    startSharedAudioMeter() {},
    stopLocalVoiceDetection() {},
    stopSharedAudioMeter: () => {
      harness.closed = true;
    },
    topologyState: { value: { mode: "sfu", epoch: 2, sourceRevision: 3 } },
    voiceStore: { micMuted: false, deafened: false },
  });

  await assert.rejects(
    harness.instance.publishSource({
      source: "screen-audio",
      stream: {},
      track: captureTrack,
    }),
    /producer rejected/,
  );

  assert.equal(harness.closed, true);
  assert.equal(harness.localSources.size, 0);
});
