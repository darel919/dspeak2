import assert from "node:assert/strict";
import { test } from "node:test";
import {
  VOICE_JOIN_TIMEOUT_MS,
  hasUsableVoiceRoute,
  waitForVoiceTransportReady,
} from "../app/shared/voice-join-readiness.ts";

test("voice joins use a twenty-second connection deadline", () => {
  assert.equal(VOICE_JOIN_TIMEOUT_MS, 20_000);
});

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

test("voice transport readiness ignores empty session error details", async () => {
  const clock = createClock();
  let checks = 0;

  await waitForVoiceTransportReady({
    getError: () => ({}),
    isCurrent: () => true,
    isReady: () => ++checks === 2,
    now: clock.now,
    wait: clock.wait,
  });

  assert.equal(checks, 2);
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

test("voice transport readiness can wait through provider recovery", async () => {
  const clock = createClock();
  let checks = 0;

  await waitForVoiceTransportReady({
    getError: () => null,
    isCurrent: () => true,
    isReady: () => ++checks === 5,
    now: clock.now,
    pollIntervalMs: 10,
    timeoutMs: () => 60,
    wait: clock.wait,
  });

  assert.equal(checks, 5);
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

test("a prepared transport is not reported as media-ready without an active route", () => {
  assert.equal(
    hasUsableVoiceRoute({
      activeProvider: null,
      p2pReady: true,
      sfuReady: true,
      signalingConnected: true,
      topologyMode: "switching",
      transportReady: true,
    }),
    false,
  );
});
