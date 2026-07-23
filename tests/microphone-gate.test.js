import assert from "node:assert/strict";
import test from "node:test";
import {
  automaticGateThreshold,
  createNoiseFloorEstimator,
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

test("noise floor bootstraps from unprocessed room noise", () => {
  const estimator = createNoiseFloorEstimator();
  for (let index = 0; index < 150; index += 1) {
    const thresholdDb = automaticGateThreshold(estimator.noiseFloorDb);
    updateNoiseFloor(estimator, -42, -42 >= thresholdDb);
  }
  assert.ok(estimator.noiseFloorDb > -43);
  assert.ok(automaticGateThreshold(estimator.noiseFloorDb) > -33);
});

test("noise floor ignores intermittent speech", () => {
  const estimator = createNoiseFloorEstimator();
  for (let index = 0; index < 125; index += 1) {
    const levelDb = index % 5 === 0 ? -24 : -52;
    updateNoiseFloor(
      estimator,
      levelDb,
      levelDb >= automaticGateThreshold(estimator.noiseFloorDb),
    );
  }
  assert.ok(estimator.noiseFloorDb < -51);
});

test("noise floor follows a quieter room quickly", () => {
  const estimator = createNoiseFloorEstimator();
  for (let index = 0; index < 125; index += 1) {
    updateNoiseFloor(estimator, -42, false);
  }
  for (let index = 0; index < 125; index += 1) {
    updateNoiseFloor(estimator, -58, false);
  }
  assert.ok(estimator.noiseFloorDb < -57);
});

test("noise floor does not rise during continuous speech", () => {
  const estimator = createNoiseFloorEstimator();
  for (let index = 0; index < 125; index += 1) {
    updateNoiseFloor(estimator, -52, false);
  }
  const noiseFloorBeforeSpeech = estimator.noiseFloorDb;
  for (let index = 0; index < 250; index += 1) {
    const speechLevelDb = -30 + (index % 7);
    updateNoiseFloor(estimator, speechLevelDb, true);
  }
  assert.equal(estimator.noiseFloorDb, noiseFloorBeforeSpeech);
});
