import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hasUsableVoiceRoute,
  waitForVoiceTransportReady,
} from "../app/shared/voice-join-readiness.js";

function createClock() {
  let elapsed = 0;
  return {
    now: () => elapsed,
    wait: async (duration) => {
      elapsed += duration;
    },
  };
}

test("voice transport readiness resolves once the active session is ready", async () => {
  const clock = createClock();
  let checks = 0;

  await waitForVoiceTransportReady({
    getError: () => null,
    isCurrent: () => true,
    isReady: () => ++checks === 3,
    now: clock.now,
    timeoutMs: 150,
    wait: clock.wait,
  });

  assert.equal(checks, 3);
});

test("voice transport readiness rejects a session error", async () => {
  await assert.rejects(
    waitForVoiceTransportReady({
      getError: () => "SFU transport failed",
      isCurrent: () => true,
      isReady: () => false,
    }),
    /SFU transport failed/,
  );
});

test("voice transport readiness rejects a replaced join", async () => {
  await assert.rejects(
    waitForVoiceTransportReady({
      getError: () => null,
      isCurrent: () => false,
      isReady: () => false,
    }),
    (error) => error.code === "VOICE_JOIN_CANCELLED",
  );
});

test("voice transport readiness cannot remain pending forever", async () => {
  const clock = createClock();

  await assert.rejects(
    waitForVoiceTransportReady({
      getError: () => null,
      isCurrent: () => true,
      isReady: () => false,
      now: clock.now,
      pollIntervalMs: 10,
      timeoutMs: 30,
      wait: clock.wait,
    }),
    /Media transport timed out/,
  );
});

test("an active healthy route remains usable during a topology switch", () => {
  assert.equal(
    hasUsableVoiceRoute({
      activeProvider: "sfu",
      p2pReady: true,
      sfuReady: true,
      signalingConnected: true,
      topologyMode: "switching",
      transportReady: false,
    }),
    true,
  );
  assert.equal(
    hasUsableVoiceRoute({
      activeProvider: "p2p",
      p2pReady: true,
      sfuReady: false,
      signalingConnected: true,
      topologyMode: "switching",
      transportReady: false,
    }),
    true,
  );
});

test("a prepared transport completes join while route selection continues", () => {
  assert.equal(
    hasUsableVoiceRoute({
      activeProvider: null,
      p2pReady: true,
      sfuReady: true,
      signalingConnected: true,
      topologyMode: "switching",
      transportReady: true,
    }),
    true,
  );
});
