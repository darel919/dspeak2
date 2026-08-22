import assert from "node:assert/strict";
import test from "node:test";
import {
  PENDING_SIGNAL_LIMIT,
  enqueuePendingSignal,
  expirePendingSignals,
  samplePendingSignalQueue,
  takePendingSignals,
} from "../app/shared/pending-signal-queue.ts";
import { NativeP2pMesh } from "../app/shared/native-p2p.ts";

test("pending signal entries record their enqueue time", () => {
  const pendingSignals = new Map();
  enqueuePendingSignal(pendingSignals, 3, { epoch: 3, signal: "a" }, 8, 1000);
  const sample = samplePendingSignalQueue(pendingSignals, 1500);
  assert.equal(sample.epochs, 1);
  assert.equal(sample.queued, 1);
  assert.equal(sample.oldestQueuedAgeMs, 500);
});

test("capacity overflow drops the oldest pending signal", () => {
  const pendingSignals = new Map();
  enqueuePendingSignal(pendingSignals, 1, { n: 1 }, 2, 0);
  enqueuePendingSignal(pendingSignals, 1, { n: 2 }, 2, 10);
  enqueuePendingSignal(pendingSignals, 1, { n: 3 }, 2, 20);
  const sample = samplePendingSignalQueue(pendingSignals, 30);
  assert.equal(sample.queued, 2);
  const [first] = takePendingSignals(pendingSignals, 1);
  assert.equal(first?.payload.n, 2);
});

test("stale epochs expire once past the max age", () => {
  const pendingSignals = new Map();
  enqueuePendingSignal(pendingSignals, 5, { epoch: 5 }, 4, 0);
  enqueuePendingSignal(pendingSignals, 6, { epoch: 6 }, 4, 9_000);
  const expired = expirePendingSignals(pendingSignals, 10_000, 10_500);
  assert.equal(expired, 1);
  assert.deepEqual([...pendingSignals.keys()], [6]);
});

test("take drains only the requested epoch", () => {
  const pendingSignals = new Map();
  enqueuePendingSignal(pendingSignals, 7, { e: 7 }, 4, 0);
  enqueuePendingSignal(pendingSignals, 8, { e: 8 }, 4, 0);
  const taken = takePendingSignals(pendingSignals, 7);
  assert.equal(taken.length, 1);
  assert.deepEqual([...pendingSignals.keys()], [8]);
});

test("sampled age reflects the oldest entry across every epoch", () => {
  const pendingSignals = new Map();
  enqueuePendingSignal(pendingSignals, 1, {}, PENDING_SIGNAL_LIMIT, 5_000);
  enqueuePendingSignal(pendingSignals, 2, {}, PENDING_SIGNAL_LIMIT, 6_400);
  const sample = samplePendingSignalQueue(pendingSignals, 10_000);
  assert.equal(sample.queued, 2);
  assert.equal(sample.oldestQueuedAgeMs, 5_000);
});

test("mesh queues future-epoch signals and flushes them after topology lands", async () => {
  const client = new NativeP2pMesh({
    iceServers: [],
    sendSignal() {},
    onRemoteTrack() {},
    onRemoteTrackEnded() {},
    onFailure() {},
    onSnapshot() {},
  });
  client.epoch = 1;
  const received: Array<Record<string, unknown>> = [];
  client.receiveSignal = (payload) => {
    received.push(payload);
    return Promise.resolve(true);
  };
  assert.equal(client.queuePendingSignal({ epoch: 2, signal: "offer" }), true);
  assert.equal(
    client.queuePendingSignal({ epoch: 0, signal: "stale" }),
    false,
    "signals below the current epoch are rejected",
  );
  await client.flushPendingSignals();
  assert.deepEqual(received, [], "flush skips epochs above the active one");
  client.mode = "p2p";
  client.epoch = 2;
  await client.flushPendingSignals();
  assert.deepEqual(received, [{ epoch: 2, signal: "offer" }]);
  assert.equal(client.pendingSignals.size, 0);
});
