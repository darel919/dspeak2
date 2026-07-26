import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptiveTrackConstraints,
  updateAdaptiveVideoState,
} from "../app/shared/adaptive-video-controller.js";

function advance(state, sample, settings, count) {
  let current = state;
  for (let index = 0; index < count; index += 1)
    current = updateAdaptiveVideoState(current, sample, settings);
  return current;
}

test("frame-rate priority reduces resolution after sustained processing pressure", () => {
  const settings = {
    frameRate: 30,
    qualityPriority: "framerate",
  };
  const state = advance(
    { scale: 1, frameRate: 30 },
    {
      encodeUtilization: 70,
      framesPerSecond: 18,
      qualityLimitationReason: "cpu",
    },
    settings,
    3,
  );
  assert.equal(state.scale, 1.25);
  assert.equal(state.frameRate, 30);
});

test("resolution priority reduces frame cadence and preserves resolution", () => {
  const settings = {
    frameRate: 30,
    qualityPriority: "resolution",
  };
  const state = advance(
    { scale: 1, frameRate: 30 },
    {
      encodeUtilization: 70,
      framesPerSecond: 18,
      qualityLimitationReason: "cpu",
    },
    settings,
    3,
  );
  assert.equal(state.scale, 1);
  assert.equal(state.frameRate, 25);
  assert.deepEqual(
    adaptiveTrackConstraints(
      { ceilingWidth: 1920, ceilingHeight: 1080 },
      state,
      settings,
    ),
    {
      frameRate: { ideal: 25, max: 25 },
      width: { ideal: 1920, max: 1920 },
      height: { ideal: 1080, max: 1080 },
    },
  );
});

test("resolution priority never adapts below 25 frames per second", () => {
  const settings = {
    frameRate: 60,
    qualityPriority: "resolution",
  };
  let state = { scale: 1, frameRate: 60 };
  for (let step = 0; step < 18; step += 1)
    state = updateAdaptiveVideoState(
      state,
      {
        encodeUtilization: 90,
        framesPerSecond: 10,
        qualityLimitationReason: "cpu",
      },
      settings,
    );
  assert.equal(state.frameRate, 25);
  assert.equal(state.scale, 1);
});

test("adaptation recovers gradually but never exceeds user ceilings", () => {
  const settings = {
    frameRate: 30,
    qualityPriority: "framerate",
  };
  const state = advance(
    { scale: 1.5, frameRate: 30 },
    {
      encodeUtilization: 10,
      framesPerSecond: 30,
      qualityLimitationReason: "none",
    },
    settings,
    6,
  );
  assert.equal(state.scale, 1.25);
  assert.equal(state.frameRate, 30);
});

test("active adaptation follows a newly lowered resolution ceiling", () => {
  assert.deepEqual(
    adaptiveTrackConstraints(
      { ceilingWidth: 2560, ceilingHeight: 1440 },
      { scale: 1.25, frameRate: 30 },
      {
        frameRate: 30,
        qualityPriority: "framerate",
        resolution: "1080p",
      },
    ),
    {
      frameRate: { ideal: 30, max: 30 },
      width: { ideal: 1536, max: 1536 },
      height: { ideal: 864, max: 864 },
    },
  );
});
