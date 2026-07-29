import assert from "node:assert/strict";
import test from "node:test";
import { createMediaSourceController } from "../app/shared/media-source-controller.js";

function controller(overrides = {}) {
  const localSources = new Map();
  const localVideoFeeds = { value: new Map() };
  const sent = [];
  const failures = [];
  const meteredSources = [];
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
    localVideoFeeds,
    producerFacade: (entry) => entry,
    refreshPublicMaps() {},
    reportSfuFailure: (reason) => failures.push(reason),
    send: (message) => sent.push(message),
    startLocalVoiceDetection() {},
    startSharedAudioMeter: (source) => meteredSources.push(source),
    stopLocalVoiceDetection() {},
    stopSharedAudioMeter: () => {
      stoppedMeter += 1;
    },
    topologyState: { value: { mode: "sfu", epoch: 2, sourceRevision: 3 } },
    voiceStore: { micMuted: false, deafened: false },
    broadcastCapture: {
      async start() {
        throw new Error("Broadcast capture is not configured");
      },
      async stop() {},
    },
    ...overrides,
  });
  return {
    failures,
    instance,
    localSources,
    localVideoFeeds,
    meteredSources,
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

test("local screen preview is available while route publication is pending", async () => {
  let releasePublication;
  const publication = new Promise((resolve) => {
    releasePublication = resolve;
  });
  const harness = controller({
    getSfu: () => ({
      addSource: () => publication,
    }),
  });
  const stream = {};
  const publishing = harness.instance.publishSource({
    source: "screen",
    stream,
    track: { id: "screen-track", readyState: "live" },
  });

  assert.equal(harness.localSources.has("screen"), false);
  assert.equal(harness.localVideoFeeds.value.get("screen").stream, stream);

  releasePublication();
  await publishing;

  assert.equal(harness.localSources.has("screen"), true);
});

test("failed screen publication removes its provisional local preview", async () => {
  const harness = controller({
    getSfu: () => ({
      async addSource() {
        throw new Error("producer rejected");
      },
      removeSource() {},
    }),
  });

  await assert.rejects(
    harness.instance.publishSource({
      source: "screen",
      stream: {},
      track: { id: "screen-track", readyState: "live" },
    }),
    /producer rejected/,
  );

  assert.equal(harness.localVideoFeeds.value.has("screen"), false);
});

test("a missing active transport cannot report publication success", async () => {
  const harness = controller();

  await assert.rejects(
    harness.instance.publishSource({
      source: "audio",
      stream: {},
      track: { id: "microphone", readyState: "live" },
    }),
    /active SFU transport is unavailable/,
  );

  assert.equal(harness.localSources.size, 0);
  assert.equal(
    harness.sent.some((message) => message.type === "media-sources"),
    false,
  );
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

test("new sources publish to the active and preparing transports", async () => {
  const published = [];
  const harness = controller({
    getActiveProvider: () => "sfu",
    getP2pMesh: () => ({
      async publishSource(source) {
        published.push(`p2p:${source}`);
      },
    }),
    getSfu: () => ({
      async addSource(entry) {
        published.push(`sfu:${entry.source}`);
      },
    }),
    topologyState: {
      value: {
        mode: "probing",
        target: "p2p",
        epoch: 2,
        sourceRevision: 3,
      },
    },
  });

  await harness.instance.publishSource({
    source: "screen-audio",
    stream: {},
    track: { id: "system-audio", readyState: "live" },
  });

  assert.deepEqual(published, ["p2p:screen-audio", "sfu:screen-audio"]);
});

test("broadcast start publishes the captured source and stop unpublishes it", async () => {
  const removed = [];
  let captureStopped = 0;
  const entry = {
    source: "broadcast-audio",
    stream: {},
    track: {
      id: "broadcast-track",
      kind: "audio",
      readyState: "live",
      addEventListener() {},
    },
  };
  const file = { name: "set.mp3", type: "audio/mpeg" };
  const harness = controller({
    broadcastCapture: {
      async start(options) {
        assert.equal(options.file, file);
        return entry;
      },
      async stop() {
        captureStopped += 1;
      },
    },
    getSfu: () => ({
      async addSource(sourceEntry) {
        assert.equal(sourceEntry.source, "broadcast-audio");
      },
      removeSource(source) {
        removed.push(source);
      },
    }),
  });

  const producer = await harness.instance.startBroadcastProduction({
    file,
  });

  assert.equal(producer.track, entry.track);
  assert.equal(harness.localSources.get("broadcast-audio"), entry);
  assert.deepEqual(harness.meteredSources, ["broadcast-audio"]);

  await harness.instance.stopBroadcastProduction();

  assert.deepEqual(removed, ["broadcast-audio"]);
  assert.equal(harness.localSources.has("broadcast-audio"), false);
  assert.equal(captureStopped, 1);
});
