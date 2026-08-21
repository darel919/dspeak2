import assert from "node:assert/strict";
import test from "node:test";
import { createMediaSourceController } from "../app/shared/media-source-controller.ts";
import { FakeMediaStreamTrack } from "./helpers/fake-media.ts";
import type { TopologySourceEntry } from "../app/shared/types/topology-controller.ts";
import {
  parseExternalRecord,
  parseExternalString,
} from "../shared/types/external.ts";

function sourceEntry(source: string, id: string): TopologySourceEntry {
  return {
    source,
    track: new FakeMediaStreamTrack(source === "audio" ? "audio" : "video", id),
  };
}

function controller(overrides: Record<string, unknown> = {}) {
  const localSources = new Map();
  const localVideoFeeds = { value: new Map() };
  const error = { value: null };
  const sent = [];
  const failures = [];
  const meteredSources = [];
  let stoppedMeter = 0;
  let pendingOperationIds: string[] = [];
  const autoAck = overrides.autoAck !== false;
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
      if (
        autoAck &&
        message.type === "media-sources" &&
        parseExternalString(parseExternalRecord(message.data)?.operationId)
      ) {
        const operationId = parseExternalString(
          parseExternalRecord(message.data)?.operationId,
        );
        if (!operationId) return;
        pendingOperationIds.push(operationId);
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
        return new Promise((resolve) => {
          setTimeout(() => resolve(true), 5);
        });
      },
    }),
    getP2pMesh: () => null,
  });
  const entry = sourceEntry("screen", "screen-track");
  harness.localSources.set(entry.source, entry);

  const removal = harness.instance.removeSource(entry);
  assert.equal(
    harness.sent.some((m) => m.type === "media-sources"),
    true,
  );
  const mediaSources = harness.sent.find(
    (m) => m.type === "media-sources",
  )?.data;
  assert.equal(mediaSources.sourceStates?.screen?.desiredState, "inactive");

  assert.equal(providerRemovalStarted, false);

  await new Promise((resolve) => setTimeout(resolve, 0));
  await removal;

  assert.equal(providerRemovalStarted, true);
  assert.ok(removalOrder.includes("sfu:screen"));
});

test("stop ACK timeout marks the source reconciling and never settles idle", async () => {
  const harness = controller({ autoAck: false });
  const entry = sourceEntry("screen", "screen-track");
  harness.localSources.set(entry.source, entry);
  const timeoutMs = 15_000;

  const removal = harness.instance.removeSource(entry);
  const removalOutcome = removal.then(
    () => "resolved",
    () => "rejected",
  );
  const stoppingFsm = harness.instance.sourceFsms.get("screen");
  assert.equal(stoppingFsm?.phase, "stopping");
  assert.equal(stoppingFsm?.desiredState, "inactive");

  await new Promise((resolve) => setTimeout(resolve, timeoutMs + 10));

  assert.equal(await removalOutcome, "rejected");
  const reconcilingFsm = harness.instance.sourceFsms.get("screen");
  assert.equal(reconcilingFsm?.phase, "reconciling");
  assert.equal(reconcilingFsm?.desiredState, "inactive");
  assert.equal(reconcilingFsm?.generation, 1);
  assert.equal(harness.localSources.has("screen"), false);
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
  assert.ok(parseExternalString(voiceMessage?.operationId));
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

test("microphone stop waits for provider source cleanup", async () => {
  let releaseProviderRemoval = () => {};
  const providerRemoval = new Promise<void>((resolve) => {
    releaseProviderRemoval = resolve;
  });
  const harness = controller({
    getSfu: () => ({
      removeSource: () => providerRemoval,
    }),
  });
  const entry = sourceEntry("audio", "microphone-track");
  harness.localSources.set(entry.source, entry);

  const completed = Promise.resolve(harness.instance.removeSource(entry));
  let settled = false;
  void completed.then(() => {
    settled = true;
  });

  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(settled, false);
  releaseProviderRemoval();
  await completed;
  assert.equal(settled, true);
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
    true,
  );
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

  await new Promise((r) => setImmediate(r));

  if (!harness.localVideoFeeds.value.has("screen")) {
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(harness.localVideoFeeds.value.has("screen"), true);
  assert.equal(harness.localVideoFeeds.value.get("screen").stream, stream);
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
  assert.equal(
    harness.sent.some((message) => message.type === "media-sources"),
    false,
  );
});

test("a pending SFU activation keeps publishing on the working P2P route", async () => {
  const published: string[] = [];
  const harness = controller({
    getActiveProvider: () => "p2p",
    getP2pMesh: () => ({
      async publishSource(source) {
        published.push(`p2p:${source}`);
      },
    }),
    topologyState: {
      value: {
        mode: "sfu",
        activeTransport: "p2p",
        targetTransport: "sfu",
        epoch: 2,
        sourceRevision: 3,
      },
    },
  });

  await harness.instance.publishSource({
    source: "camera",
    stream: {},
    track: { id: "camera-track", readyState: "live" },
  });

  assert.deepEqual(published, ["p2p:camera"]);
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
  assert.ok(parseExternalString(leaveMessage?.operationId));
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
  assert.ok(parseExternalString(sourceMessage?.operationId));
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

  const fsm = harness.instance.sourceFsms.get("camera");
  assert.equal(fsm?.desiredState, "inactive");
  assert.equal(fsm?.phase, "idle");
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
  const recovered = await harness.instance.publishSource(replacement);
  assert.equal(recovered.track.id, "camera-1");

  assert.equal(harness.localVideoFeeds.value.get("camera").stream, oldStream);
  assert.equal(harness.localSources.get("camera").track.id, "camera-1");
  assert.equal(harness.localSources.get("camera").track, recovered.track);
});

test("stale-generation STOP: NACK adopts canonical generation, retries inactive, ACK, cleanup, idle", async () => {
  let sfuRemoveCalls = 0;
  const harness = controller({
    autoAck: false,
    getSfu: () => ({
      async removeSource(_source: string) {
        sfuRemoveCalls += 1;
        if (sfuRemoveCalls === 1) {
          throw new Error("premature remove");
        }
        return true;
      },
    }),
  });

  const entry = sourceEntry("screen", "screen-track");
  harness.localSources.set(entry.source, entry);

  const removal = harness.instance.removeSource(entry);
  removal.catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 0));

  const fsmBeforeNack = harness.instance.sourceFsms.get("screen");
  console.log("FSM before NACK:", JSON.stringify(fsmBeforeNack));
  assert.equal(fsmBeforeNack?.generation, 1);
  assert.equal(fsmBeforeNack?.desiredState, "inactive");
  assert.equal(fsmBeforeNack?.phase, "stopping");

  const nackPayload = {
    source: "screen",
    code: "STALE_SOURCE_GENERATION",
    expectedGeneration: 2,
    retryable: true,
    adoptsCanonicalGeneration: true,
    canonicalState: {
      participants: [
        {
          peerId: "peer-1",
          sourceStates: {
            screen: { generation: 2, desiredState: "inactive" },
          },
        },
      ],
    },
  };
  const nackResult = harness.instance.queueTargetedReconciliation?.(
    "nack-op",
    nackPayload,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  const fsmAfterNack = harness.instance.sourceFsms.get("screen");
  console.log("FSM after NACK:", JSON.stringify(fsmAfterNack));
  assert.equal(fsmAfterNack?.generation, 2);
  assert.equal(fsmAfterNack?.desiredState, "inactive");
  assert.equal(fsmAfterNack?.phase, "reconciling");

  const opIdForRetry = harness.sent
    .filter((m) => m.type === "media-sources")
    .pop()?.data?.operationId;
  console.log("Resolving ACK for operationId:", opIdForRetry);
  console.log("sfuRemoveCalls before:", sfuRemoveCalls);
  harness.instance.resolveOperationAck?.(opIdForRetry!);
  await nackResult;
  await Promise.resolve();
  console.log("sfuRemoveCalls after:", sfuRemoveCalls);

  const fsmAfterAck = harness.instance.sourceFsms.get("screen");
  console.log(
    "FSM after ACK:",
    JSON.stringify(fsmAfterAck),
    "ref:",
    fsmAfterAck,
  );
  assert.equal(fsmAfterAck?.generation, 2);
  assert.equal(fsmAfterAck?.desiredState, "inactive");
  assert.equal(fsmAfterAck?.phase, "idle");

  console.log("Map keys:", [...harness.instance.sourceFsms.keys()]);
  console.log("Map size:", harness.instance.sourceFsms.size);
  const mapEntry = harness.instance.sourceFsms.get("screen");
  console.log(
    "Map entry:",
    JSON.stringify(mapEntry),
    "same?",
    mapEntry === fsmAfterAck,
  );

  console.log("Final sfuRemoveCalls:", sfuRemoveCalls);
  assert.equal(sfuRemoveCalls, 1);

  const finalFsm1 = harness.instance.sourceFsms.get("screen");
  console.log(
    "Final FSM (immediate):",
    JSON.stringify(finalFsm1),
    "ref:",
    finalFsm1,
    "same?",
    finalFsm1 === fsmAfterAck,
  );
  assert.equal(finalFsm1?.generation, 2);
  assert.equal(finalFsm1?.desiredState, "inactive");
  assert.equal(finalFsm1?.phase, "idle");

  const finalFsm = harness.instance.sourceFsms.get("screen");
  console.log(
    "Final FSM (at assertion):",
    JSON.stringify(finalFsm),
    "ref:",
    finalFsm,
    "same?",
    finalFsm === fsmAfterAck,
  );
  assert.equal(finalFsm?.phase, "idle");
  assert.equal(finalFsm?.desiredState, "inactive");
  assert.equal(finalFsm?.generation, 2);
});

test("stop ACK lost: server already committed inactive, canonical snapshot says inactive, cleanup, idle", async () => {
  let sfuRemoveCalls = 0;
  const harness = controller({
    autoAck: false,
    getLocalPeerId: () => "peer-1",
    getLocalParticipantKey: () => "user-1:device-1",
    getSfu: () => ({
      async removeSource() {
        sfuRemoveCalls += 1;
        return true;
      },
    }),
  });

  const entry = sourceEntry("screen", "screen-track");
  harness.localSources.set(entry.source, entry);

  const removal = harness.instance.removeSource(entry);
  removal.catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 0));

  await new Promise((resolve) => setTimeout(resolve, 15_010));

  const fsmAfterTimeout = harness.instance.sourceFsms.get("screen");
  assert.equal(fsmAfterTimeout?.phase, "reconciling");
  assert.equal(fsmAfterTimeout?.generation, 1);
  assert.equal(fsmAfterTimeout?.desiredState, "inactive");

  const heartbeatPayload = {
    source: "screen",
    code: "STALE_SOURCE_GENERATION",
    expectedGeneration: 1,
    retryable: false,
    adoptsCanonicalGeneration: true,
    canonicalState: {
      participants: [
        {
          peerId: "peer-1",
          sourceStates: {
            screen: { generation: 1, desiredState: "inactive" },
          },
        },
      ],
      sourceStates: {
        "user-1:device-1": {
          screen: { generation: 1, desiredState: "inactive" },
        },
      },
    },
  };
  harness.instance.queueTargetedReconciliation?.(
    "heartbeat-op",
    heartbeatPayload,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  const fsmAfterHeartbeat = harness.instance.sourceFsms.get("screen");
  assert.equal(fsmAfterHeartbeat?.generation, 1);
  assert.equal(fsmAfterHeartbeat?.phase, "idle");
  assert.equal(fsmAfterHeartbeat?.desiredState, "inactive");

  assert.equal(sfuRemoveCalls, 1);
});
