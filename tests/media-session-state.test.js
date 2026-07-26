import assert from "node:assert/strict";
import test from "node:test";
import {
  createMediaGeneration,
  initialMediaTopologyState,
} from "../app/shared/media-session-state.js";

test("initial media topology waits for its first peer", () => {
  assert.deepEqual(initialMediaTopologyState(), {
    mode: "idle",
    epoch: 0,
    reason: "waiting-for-peer",
    peers: [],
    activatedAt: null,
  });
});

test("retiring a media generation rejects delayed topology work", () => {
  const generation = createMediaGeneration();
  const captured = generation.capture();
  generation.assert(captured);
  generation.retire();
  assert.throws(
    () => generation.assert(captured),
    /Media signaling generation retired/,
  );
  generation.assert(generation.capture());
});
