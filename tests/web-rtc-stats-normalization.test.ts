import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeWebRtcPathStats,
  reportStatValues,
} from "../app/shared/web-rtc-stats-normalization.ts";

describe("reportStatValues", () => {
  it("reads standard-report dictionaries", () => {
    const values = reportStatValues({
      "inbound-rtp-1": { kind: "audio" },
      "candidate-pair": { state: "succeeded" },
    });
    assert.equal(values.length, 2);
  });

  it("reads maps", () => {
    const values = reportStatValues(new Map([["a", { jitter: 0.01 }]]));
    assert.equal(values.length, 1);
  });

  it("reads arrays and callable-values reports", () => {
    assert.equal(reportStatValues([{ a: 1 }, { b: 2 }]).length, 2);
    assert.equal(reportStatValues({ values: () => [{ c: 3 }] }).length, 1);
  });

  it("returns empty for unusable payloads instead of throwing", () => {
    assert.deepEqual(reportStatValues(null), []);
    assert.deepEqual(reportStatValues(undefined), []);
    assert.deepEqual(reportStatValues(42), []);
    assert.deepEqual(
      reportStatValues({
        values: () => {
          throw new Error("x");
        },
      }),
      [],
    );
  });
});

describe("normalizeWebRtcPathStats", () => {
  const audioInbound = {
    jitter: 0.005,
    packetsReceived: 5000,
    packetsLost: 12,
    jitterBufferDelay: 25,
    jitterBufferEmittedCount: 2500,
    jitterBufferTargetDelay: 20,
    jitterBufferMinimumDelay: 4,
  };

  it("converts seconds to milliseconds across the path stats", () => {
    const normalized = normalizeWebRtcPathStats({
      timestamp: 1000,
      candidatePair: { currentRoundTripTime: 0.03 },
      inboundAudio: audioInbound,
      inboundVideo: null,
    });
    assert.equal(normalized.rttMs, 30);
    assert.equal(normalized.jitterMs, 5);
    assert.equal(normalized.jitterBufferAverageDelayMs, 10);
    assert.equal(normalized.jitterBufferAverageTargetDelayMs, 8);
    assert.equal(normalized.jitterBufferAverageMinimumDelayMs, 1.6);
    assert.equal(normalized.packetsLost, 12);
    assert.equal(normalized.packetsReceived, 5000);
  });

  it("prefers audio fields and falls back to video fields per metric", () => {
    const normalized = normalizeWebRtcPathStats({
      timestamp: null,
      candidatePair: {},
      inboundAudio: { jitter: 0.004 },
      inboundVideo: { framesDropped: 3, framesDecoded: 900 },
    });
    assert.equal(normalized.jitterMs, 4);
    assert.equal(normalized.framesDecoded, 900);
    assert.equal(normalized.framesDropped, 3);
  });

  it("keeps missing inputs as missing rather than zero", () => {
    const normalized = normalizeWebRtcPathStats({
      timestamp: null,
      candidatePair: null,
      inboundAudio: null,
      inboundVideo: null,
    });
    assert.equal(normalized.rttMs, null);
    assert.equal(normalized.jitterMs, null);
    assert.equal(normalized.jitterBufferAverageDelayMs, null);
    assert.equal(normalized.encoderImplementation, null);
    assert.equal(normalized.powerEfficientDecoder, null);
  });

  it("rejects malformed stat records", () => {
    const normalized = normalizeWebRtcPathStats({
      timestamp: "not-a-number",
      candidatePair: { currentRoundTripTime: Number.NaN },
      inboundAudio: { jitter: "high" },
      inboundVideo: { framesDropped: true },
    });
    assert.equal(normalized.timestampMs, null);
    assert.equal(normalized.rttMs, null);
    assert.equal(normalized.jitterMs, null);
    assert.equal(normalized.framesDropped, null);
  });
});
