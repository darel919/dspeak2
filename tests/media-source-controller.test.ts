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
  let pendingOperationIds: string[] = [];
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
    send: (message) => {
      sent.push(message);
      // Auto-resolve media-sources ACKs for tests
      if (message.type === "media-sources" && message.data?.operationId) {
        pendingOperationIds.push(message.data.operationId as string);
        // Resolve immediately after the send completes
        setTimeout(() => {
          while (pendingOperationIds.length > 0) {
            const opId = pendingOperationIds.shift()!;
            instance.resolveOperationAck?.(opId);
          }
        }, 0);
      }
    },
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
    resolveOperationAck: (operationId: string) => {
      instance.resolveOperationAck?.(operationId);
    },
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

test("stop commits control intent before provider transport cleanup", async () => {
  const removalOrder: string[] = [];
  let providerRemovalStarted = false;
  const harness = controller({
    getSfu: () => ({
      removeSource: (source: string) => {
        removalOrder.push(`sfu:${source}`);
        providerRemovalStarted = true;
        // Simulate the Cloudflare Realtime session operation blocking while
        // the PeerConnection reconnects (documented multi-second stall).
        return new Promise((resolve) => {
          setTimeout(() => resolve(true), 5);
        });
      },
    }),
    getP2pMesh: () => null,
  });
  const entry = {
    source: "screen",
    track: { id: "screen-track" },
  } as unknown as Parameters<typeof harness.instance.removeSource>[0];
  harness.localSources.set(entry.source, entry);

  const removal = harness.instance.removeSource(entry);
  // Synchronously after removeSource() the sender UI is already stopped and
  // the control mutation (media-sources, desiredState inactive) is queued.
  assert.equal(
    harness.sent.some((m) => m.type === "media-sources"),
    true,
  );
  const mediaSources = harness.sent.find(
    (m) => m.type === "media-sources",
  )?.data;
  assert.equal(mediaSources.sourceStates?.screen?.desiredState, "inactive");

  // Provider cleanup must NOT have started yet: it waits for the ACK.
  assert.equal(providerRemovalStarted, false);

  // Auto-ACK resolves; provider cleanup proceeds after the canonical commit.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await removal;

  assert.equal(providerRemovalStarted, true);
  assert.ok(removalOrder.includes("sfu:screen"));
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
  await new Promise((resolve) => setTimeout(resolve, 0));
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
  const voiceStore = { micMuted: true, deafened: false };
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
  // Intent IS sent before provider publish; rollback happens on failure
  assert.equal(
    harness.sent.some((message) => message.type === "media-sources"),
    true,
  );
  // An untyped source error (tracks-new, sender config, renegotiation) is
  // source-scoped, not a provider fault: it must NOT escalate to failover.
  assert.equal(harness.failures.length, 0);
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

  // Yield to let commitSourceIntent complete and set localVideoFeeds
  await new Promise((r) => setImmediate(r));

  // localVideoFeeds is set synchronously in commitSourceIntent -> publishSource
  // localSources is only added after provider publication succeeds
  // So at this point (during provider publication), localVideoFeeds should be set
  // but localSources should NOT be set yet
  if (!harness.localVideoFeeds.value.has("screen")) {
    // If preview not yet set, wait a bit more
    await new Promise((r) => setTimeout(r, 10));
  }
  // Preview feed is available before provider publication completes
  assert.equal(harness.localVideoFeeds.value.has("screen"), true);
  assert.equal(harness.localVideoFeeds.value.get("screen").stream, stream);
  // localSources only added after provider publication succeeds
  assert.equal(harness.localSources.has("screen"), false);

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
  // Preflight rejects BEFORE any server mutation: no media-sources intent
  // may reach the server for a missing required transport.
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

  await assert.rejects(
    harness.instance.publishSource({
      source: "screen-audio",
      stream: {},
      track: captureTrack,
    }),
    /producer rejected/,
  );

  assert.equal(harness.stoppedMeter(), 1);
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
  assert.ok(sourceMessage?.sourceStates);
});

test("replacement restore failure commits N+3 inactive to the real FSM", async () => {
  let addSourceCalls = 0;
  const harness = controller({
    getSfu: () => ({
      addSource: async () => {
        addSourceCalls += 1;
        if (addSourceCalls >= 2) {
          throw new Error("producer rejected on recovery");
        }
      },
      removeSource: async () => {},
    }),
  });

  // Initial publication: N
  const firstEntry = {
    source: "camera",
    stream: {},
    track: {
      id: "camera-1",
      kind: "video",
      readyState: "live",
      enabled: true,
    },
  };
  await harness.instance.publishSource(firstEntry);

  // Replacement publication: N+1 FAILS on the provider (second addSource)
  const replacement = {
    source: "camera",
    stream: {},
    track: {
      id: "camera-2",
      kind: "video",
      readyState: "live",
      enabled: true,
    },
  };
  await assert.rejects(
    harness.instance.publishSource(replacement),
    /producer rejected on recovery/,
  );

  // The failed replacement must leave the REAL FSM at N+3 inactive:
  // N (initial) -> N+1 (replacement fail) -> N+2 (active recovery) -> N+3 (retire)
  const fsm = harness.instance.sourceFsms.get("camera");
  assert.equal(fsm?.desiredState, "inactive");
  assert.equal(fsm?.phase, "idle");
  // localSources must be absent
  assert.equal(harness.localSources.has("camera"), false);
});

test("missing required SFU provider rejects recovery, not fulfilled", async () => {
  const harness = controller();
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

  // In a required-SFU topology, publishSource without an SFU must reject.
  await assert.rejects(
    harness.instance.publishSource(entry),
    /active SFU transport is unavailable/,
  );
});

test("missing required provider preflight does NOT commit server intent", async () => {
  const harness = controller();
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

  await assert.rejects(
    harness.instance.publishSource(entry),
    /active SFU transport is unavailable/,
  );
  // The preflight must reject BEFORE commitSourceIntent: no media-sources
  // mutation may reach the server, no optimistic FSM state may be created.
  assert.equal(
    harness.sent.some((message) => message.type === "media-sources"),
    false,
  );
  assert.equal(harness.instance.sourceFsms.has("audio"), false);
  assert.equal(harness.localSources.size, 0);
});

test("successful replacement rollback restores the previous video preview", async () => {
  let addSourceCalls = 0;
  const harness = controller({
    getSfu: () => ({
      addSource: async () => {
        addSourceCalls += 1;
        // First call (N) succeeds; second call (N+1 replacement) fails;
        // third call (N+2 recovery re-publish) succeeds.
        if (addSourceCalls === 2) {
          throw new Error("producer rejected");
        }
      },
      removeSource: async () => {},
    }),
  });

  const oldStream = { id: "old-stream" };
  const firstEntry = {
    source: "camera",
    stream: oldStream,
    track: {
      id: "camera-1",
      kind: "video",
      readyState: "live",
      enabled: true,
    },
  };
  await harness.instance.publishSource(firstEntry);
  assert.equal(harness.localVideoFeeds.value.get("camera").stream, oldStream);

  const newStream = { id: "new-stream" };
  const replacement = {
    source: "camera",
    stream: newStream,
    track: {
      id: "camera-2",
      kind: "video",
      readyState: "live",
      enabled: true,
    },
  };
  // Replacement provider failure rolls back to the previous source; when the
  // recovery re-publish succeeds, publishSource RESOLVES with the recovered
  // entry rather than rejecting.
  const recovered = await harness.instance.publishSource(replacement);
  assert.equal(recovered.track.id, "camera-1");

  // The rollback path restores the previous preview feed: the failed
  // replacement stream must not survive in the UI.
  assert.equal(harness.localVideoFeeds.value.get("camera").stream, oldStream);
  assert.equal(harness.localSources.get("camera").track.id, "camera-1");
  assert.equal(harness.localSources.get("camera").track, recovered.track);
});
