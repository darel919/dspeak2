import assert from "node:assert/strict";
import test from "node:test";
import {
  automaticGateThreshold,
  microphoneLevelDb,
  normalizeMicrophoneGate,
  updateNoiseFloor,
} from "../app/shared/microphone-gate.js";

test("microphone gate defaults to enabled automatic mode", () => {
  assert.deepEqual(normalizeMicrophoneGate(), {
    enabled: true,
    automatic: true,
    thresholdDb: -48,
  });
});

test("manual microphone gate threshold is bounded", () => {
  assert.equal(normalizeMicrophoneGate({ thresholdDb: -80 }).thresholdDb, -60);
  assert.equal(normalizeMicrophoneGate({ thresholdDb: -10 }).thresholdDb, -20);
});

test("microphone level and automatic threshold use dBFS", () => {
  assert.equal(
    Math.round(microphoneLevelDb(new Float32Array([0.1, -0.1]))),
    -20,
  );
  assert.equal(automaticGateThreshold(-60), -48);
  assert.equal(automaticGateThreshold(-35), -32);
});

test("noise floor only follows quiet samples", () => {
  assert.equal(updateNoiseFloor(-60, -30, false), -60);
  assert.equal(updateNoiseFloor(-60, -70, true), -60);
  assert.ok(updateNoiseFloor(-60, -70, false) < -60);
});
