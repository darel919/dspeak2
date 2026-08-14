import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeAdaptationAction,
  decodeAdaptationDecision,
  type DecodeAdaptationCounters,
} from "../app/shared/video-codec-overload.ts";

function counters(
  totalDecodeTime: number,
  framesDecoded: number,
  framesDropped = 0,
): DecodeAdaptationCounters {
  return { totalDecodeTime, framesDecoded, framesDropped };
}

test("reports video unavailable only after all receive layers are exhausted", () => {
  const decision = decodeAdaptationDecision(
    counters(2, 20, 8),
    counters(3, 20, 16),
    {
      spatialLayer: 0,
      temporalLayer: 0,
      pressureSamples: 1,
      healthySamples: 0,
    },
    30,
  );

  assert.equal(decision.overloaded, true);
  assert.equal(decision.exhausted, true);
  assert.equal(decodeAdaptationAction(decision), "video-unavailable");
});

test("decode pressure reduces temporal then spatial layers after stable pressure", () => {
  const initial = decodeAdaptationDecision(null, counters(0, 0), undefined, 30);
  const first = decodeAdaptationDecision(
    counters(0, 0),
    counters(0.9, 30),
    initial.state,
    30,
  );
  const second = decodeAdaptationDecision(
    counters(0.9, 30),
    counters(1.8, 60),
    first.state,
    30,
  );
  assert.equal(first.changed, false);
  assert.deepEqual(
    {
      spatialLayer: second.state.spatialLayer,
      temporalLayer: second.state.temporalLayer,
    },
    { spatialLayer: 2, temporalLayer: 1 },
  );
  const third = decodeAdaptationDecision(
    counters(1.8, 60),
    counters(2.7, 90),
    second.state,
    30,
  );
  const fourth = decodeAdaptationDecision(
    counters(2.7, 90),
    counters(3.6, 120),
    third.state,
    30,
  );
  assert.deepEqual(
    {
      spatialLayer: fourth.state.spatialLayer,
      temporalLayer: fourth.state.temporalLayer,
    },
    { spatialLayer: 2, temporalLayer: 0 },
  );
});

test("dropped frames are pressure even when decode time is unavailable", () => {
  const result = decodeAdaptationDecision(
    counters(1, 30, 0),
    counters(1, 60, 1),
    {
      spatialLayer: 2,
      temporalLayer: 2,
      pressureSamples: 1,
      healthySamples: 0,
    },
    null,
  );
  assert.equal(result.overloaded, true);
  assert.equal(result.droppedFrames, 1);
  assert.equal(result.changed, true);
});

test("a paused or stalled counter does not masquerade as a healthy decode sample", () => {
  const state = {
    spatialLayer: 1,
    temporalLayer: 1,
    pressureSamples: 0,
    healthySamples: 7,
  };
  const result = decodeAdaptationDecision(
    counters(2, 60),
    counters(2, 60),
    state,
    30,
  );
  assert.equal(result.changed, false);
  assert.deepEqual(result.state, state);
});

test("healthy samples recover one layer only after a stability window", () => {
  let state = {
    spatialLayer: 1,
    temporalLayer: 1,
    pressureSamples: 0,
    healthySamples: 0,
  };
  let previous = counters(0, 0);
  for (let index = 1; index <= 8; index += 1) {
    const current = counters(index * 0.7, index * 30);
    const result = decodeAdaptationDecision(previous, current, state, 30);
    state = result.state;
    previous = current;
    if (index < 8) assert.equal(result.changed, false);
  }
  assert.deepEqual(
    { spatialLayer: state.spatialLayer, temporalLayer: state.temporalLayer },
    { spatialLayer: 1, temporalLayer: 2 },
  );
});
