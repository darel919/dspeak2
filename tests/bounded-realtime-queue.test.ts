import assert from "node:assert/strict";
import test from "node:test";
import { BoundedRealtimeQueue } from "../app/shared/bounded-realtime-queue.ts";

test("bounded realtime queue measures item age at dequeue", () => {
  let now = 1000;
  const queue = new BoundedRealtimeQueue<number>({
    capacity: 4,
    maxAgeMs: 10_000,
    overflow: "drop-oldest",
    now: () => now,
  });
  queue.enqueue(1, 1000);
  queue.enqueue(2, 1500);
  const first = queue.dequeue(1750);
  assert.equal(first?.value, 1);
  assert.equal(first?.ageMs, 750);
  assert.equal(queue.sample(2000).oldestQueuedAgeMs, 500);
});

test("bounded realtime queue reports empty-queue age as null", () => {
  const queue = new BoundedRealtimeQueue<number>({
    capacity: 2,
    maxAgeMs: 1000,
    overflow: "drop-oldest",
    now: () => 0,
  });
  assert.equal(queue.sample().size, 0);
  assert.equal(queue.sample().oldestQueuedAgeMs, null);
  assert.equal(queue.dequeue(), null);
});

test("drop-oldest overflow keeps the newest items within capacity", () => {
  const queue = new BoundedRealtimeQueue<number>({
    capacity: 2,
    maxAgeMs: 60_000,
    overflow: "drop-oldest",
    now: () => 0,
  });
  assert.equal(queue.enqueue(1), true);
  assert.equal(queue.enqueue(2), true);
  assert.equal(queue.enqueue(3), true);
  assert.deepEqual(queue.drain(), [2, 3]);
  const sample = queue.sample();
  assert.equal(sample.droppedCount, 1);
  assert.equal(sample.lastDropReason, "capacity-drop-oldest");
});

test("replace-with-newest overflow keeps only the incoming item", () => {
  const queue = new BoundedRealtimeQueue<number>({
    capacity: 3,
    maxAgeMs: 60_000,
    overflow: "replace-with-newest",
    now: () => 0,
  });
  queue.enqueue(1);
  queue.enqueue(2);
  queue.enqueue(3);
  assert.equal(queue.enqueue(9), true);
  assert.deepEqual(queue.drain(), [9]);
  const sample = queue.sample();
  assert.equal(sample.droppedCount, 3);
  assert.equal(sample.lastDropReason, "capacity-replace-with-newest");
});

test("reject-new overflow refuses the incoming item", () => {
  const queue = new BoundedRealtimeQueue<string>({
    capacity: 1,
    maxAgeMs: 60_000,
    overflow: "reject-new",
    now: () => 0,
  });
  assert.equal(queue.enqueue("kept"), true);
  assert.equal(queue.enqueue("refused"), false);
  assert.deepEqual(queue.drain(), ["kept"]);
  assert.equal(queue.sample().droppedCount, 1);
  assert.equal(queue.sample().lastDropReason, "capacity-reject-new");
});

test("stale items expire by age before capacity pressure exists", () => {
  let now = 0;
  const queue = new BoundedRealtimeQueue<number>({
    capacity: 4,
    maxAgeMs: 500,
    overflow: "reject-new",
    now: () => now,
  });
  queue.enqueue(1, 0);
  queue.enqueue(2, 100);
  now = 700;
  assert.equal(queue.expireExpired(now), 2);
  assert.equal(queue.size, 0);
  assert.equal(queue.sample().lastDropReason, "max-age-expired");
  assert.equal(queue.sample().droppedCount, 2);
});

test("enqueue after expiry makes room without counting a policy drop", () => {
  let now = 0;
  const queue = new BoundedRealtimeQueue<number>({
    capacity: 2,
    maxAgeMs: 500,
    overflow: "reject-new",
    now: () => now,
  });
  queue.enqueue(1, 0);
  queue.enqueue(2, 10);
  now = 600;
  assert.equal(queue.enqueue(3, now), true);
  assert.deepEqual(queue.drain(), [3]);
});
