import assert from "node:assert/strict";
import test from "node:test";
import { createMediaSourceController } from "../app/shared/media-source-controller.ts";

function controller(overrides = {}) {
  const localSources = new Map();
  const localVideoFeeds = { value: new Map() };
  const error = { value: null };
  const sent = [];
  const failures = [];
  const meteredSources = [];
  let stoppedMeter = 0;
  const instance = createMediaSourceController({
    capture: { stop() {} },
    connected: { value: true },
    createSharedAudioSource: async (entry) => entry,
    error,
    getActiveProvider: () => "sfu",
    getConnectionEpoch: () => 1,
    getIntentionalClose: () => false,
    getLastAppliedRoomRevision: () => "0",
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
    ...overrides,
  });
  return {
    failures,
    error,
    instance,
    localSources,
    localVideoFeeds,
    meteredSources,
    sent,
    stoppedMeter: () => stoppedMeter,
  };
}

test("SFU source removal absorbs an expected session cancellation", async () => {
  const harness = controller({
    getSfu: () => ({
      removeSource: async () => {
        const error = new Error("Cloudflare session closed");
        error.code = "MEDIA_SESSION_CLOSED";
        throw error;
      },
    }),
  });
  const entry = {
    source: "audio",
    track: { id: "microphone" },
  };
  harness.localSources.set(entry.source, entry);

  harness.instance.removeSource(entry);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.error.value, null);
});

test("unexpected microphone capture loss marks the local participant muted", async () => {
  const voiceStore = {
    micMuted: false,
    deafened: false,
    screenSharing: false,
    systemAudioSharing: false,
  };
  const harness = controller({ voiceStore });
  const entry = {
    source: "audio",
    track: { id: "microphone" },
  };
  harness.localSources.set(entry.source, entry);

  harness.instance.removeSource(entry, { unexpected: true });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(voiceStore.micMuted, true);
  const voiceMessage = harness.sent.find(
    (message) => message.type === "participant-voice-state",
  )?.data;
  assert.equal(voiceMessage?.muted, true);
  assert.equal(voiceMessage?.deafened, false);
  assert.equal(typeof voiceMessage?.operationId, "string");
  assert.match(harness.error.value, /capture ended/i);
});

test("a muted microphone source is published with its track disabled", async () => {
  const voiceStore = {
    micMuted: true,
    deafened: false,
  };
  let publishedTrack = null;
  const harness = controller({
    voiceStore,
    getSfu: () => ({
      async addSource(entry) {
        publishedTrack = entry.track;
      },
    }),
  });
  const entry = {
    source: "audio",
    stream: {},
    track: {
      id: "microphone",
      kind: "audio",
      readyState: "live",
      enabled: true,
    },
  };

  await harness.instance.publishSource(entry);

  assert.equal(publishedTrack.enabled, false);
});

test("microphone start clears stale disabled transmission before capture", async () => {
  const calls = [];
  const entry = {
    source: "audio",
    track: { id: "microphone", readyState: "live" },
  };
  const harness = controller({
    capture: {
      async startMicrophone() {
        calls.push(["capture"]);
        return entry;
      },
      stop() {},
    },
    getP2pMesh: () => ({
      async setSourceTransmission(source, enabled) {
        calls.push(["p2p", source, enabled]);
      },
    }),
    getSfu: () => ({
      async setSourceTransmission(source, enabled) {
        calls.push(["sfu", source, enabled]);
      },
    }),
  });

  await harness.instance.startAudioProduction();

  assert.deepEqual(calls, [
    ["p2p", "audio", true],
    ["sfu", "audio", true],
    ["capture"],
  ]);
});

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

test("leave sends a clean leave mutation with operationId and epoch", async () => {
  const harness = controller();
  const promise = harness.instance.leave();
  const leaveMessage = harness.sent.find(
    (message) => message.type === "leave",
  )?.data;
  assert.equal(typeof leaveMessage?.operationId, "string");
  assert.equal(leaveMessage?.requestId, leaveMessage?.operationId);
  assert.equal(leaveMessage?.connectionEpoch, 1);
  harness.instance.resolveOperationAck(leaveMessage.operationId);
  await promise;
});

test("source-state mutation carries the connection envelope and FSM digest", async () => {
  const harness = controller();
  harness.instance.sendSourceState();
  const sourceMessage = harness.sent.find(
    (message) => message.type === "media-sources",
  )?.data;
  assert.equal(typeof sourceMessage?.operationId, "string");
  assert.equal(sourceMessage?.connectionEpoch, 1);
  assert.equal(sourceMessage?.expectedRoomRevision, "0");
  assert.ok(sourceMessage?.sourceStates);
});
