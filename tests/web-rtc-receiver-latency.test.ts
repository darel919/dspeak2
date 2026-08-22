import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  JITTER_BUFFER_TARGET_MAX_MS,
  WEB_JITTER_POLICY,
  applyBrowserReceiverLatencyPolicy,
  observeJitterBufferMetrics,
  resolveRequestedJitterTargetMs,
} from "../app/shared/web-rtc-receiver-latency.ts";
import {
  clearWebRtcLatencyEvents,
  getWebRtcLatencyEvents,
} from "../app/shared/web-rtc-latency-diagnostics.ts";

const ultraLowContext = {
  profile: "ultra-low",
  qualityPriority: "framerate",
  configuredFrameRate: 30,
  configuredWidth: null,
  configuredHeight: null,
} as const;

const standardContext = {
  profile: "standard",
  qualityPriority: "framerate",
  configuredFrameRate: 30,
  configuredWidth: null,
  configuredHeight: null,
} as const;

type ReceiverStub = RTCRtpReceiver & Record<string, unknown>;

function receiverWith(properties: Record<string, unknown>): ReceiverStub {
  /* SAFETY: The stub supplies exactly the receiver surface this module touches. */
  return properties as ReceiverStub;
}

type JitterTargetStub = {
  jitterBufferTarget: number;
};

function throwingReceiver(error: Error): ReceiverStub {
  const stub: JitterTargetStub = {
    get jitterBufferTarget(): number {
      return 0;
    },
    set jitterBufferTarget(_value: number) {
      throw error;
    },
  };
  /* SAFETY: The stub supplies exactly the accessor the policy assigns through. */
  return stub as ReceiverStub;
}

describe("web jitter policy (execution-plan 9)", () => {
  it("keeps standard behavior untouched", () => {
    assert.equal(WEB_JITTER_POLICY.standardPreferredMs, null);
    assert.equal(resolveRequestedJitterTargetMs("standard"), null);
  });

  it("requests an experiment-backed low target only for ultra-low", () => {
    assert.equal(WEB_JITTER_POLICY.ultraLowPreferredMs, 10);
    assert.equal(resolveRequestedJitterTargetMs("ultra-low"), 10);
    assert.ok(WEB_JITTER_POLICY.ultraLowPreferredMs! <= 20);
  });

  it("clamps the requested target to the specification maximum", () => {
    assert.ok(JITTER_BUFFER_TARGET_MAX_MS === 4000);
    assert.ok(
      resolveRequestedJitterTargetMs("ultra-low")! <
        JITTER_BUFFER_TARGET_MAX_MS,
    );
  });
});

describe("applyBrowserReceiverLatencyPolicy", () => {
  it("leaves standard-profile receivers untouched", () => {
    const receiver = receiverWith({ jitterBufferTarget: 40 });
    const result = applyBrowserReceiverLatencyPolicy(receiver, standardContext);
    assert.equal(result.applied, false);
    assert.equal(result.reason, "standard-unchanged");
    assert.equal(receiver.jitterBufferTarget, 40);
  });

  it("reports unsupported instead of assigning when the property is absent", () => {
    const result = applyBrowserReceiverLatencyPolicy(
      receiverWith({}),
      ultraLowContext,
    );
    assert.equal(result.jitterBufferTargetSupported, false);
    assert.equal(result.applied, false);
    assert.equal(result.reason, "unsupported");
    assert.equal(result.requestedTargetMs, 10);
  });

  it("assigns milliseconds and reports the requested and assigned values separately", () => {
    const receiver = receiverWith({ jitterBufferTarget: 40 });
    const result = applyBrowserReceiverLatencyPolicy(receiver, ultraLowContext);
    assert.equal(result.applied, true);
    assert.equal(result.reason, "applied");
    assert.equal(result.requestedTargetMs, 10);
    assert.equal(result.assignedTargetMs, 10);
    assert.equal(receiver.jitterBufferTarget, 10);
  });

  it("survives a RangeError rejection without throwing", () => {
    clearWebRtcLatencyEvents();
    const result = applyBrowserReceiverLatencyPolicy(
      throwingReceiver(new RangeError("jitter buffer target out of range")),
      ultraLowContext,
    );
    assert.equal(result.applied, false);
    assert.equal(result.reason, "rejected");
    assert.equal(result.assignedTargetMs, null);
    const events = getWebRtcLatencyEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, "receiver-jitter-target-rejected");
    assert.equal(
      events[0].kind === "receiver-jitter-target-rejected" &&
        events[0].errorName,
      "RangeError",
    );
  });
});

describe("observed jitter-buffer metrics (execution-plan 10)", () => {
  it("derives averages only when frames were emitted", () => {
    const metrics = observeJitterBufferMetrics({
      jitterBufferDelay: 2.5,
      jitterBufferEmittedCount: 250,
      jitterBufferTargetDelay: 1.25,
      jitterBufferMinimumDelay: 0.25,
    });
    assert.equal(metrics.averageDelayMs, 10);
    assert.equal(metrics.averageTargetDelayMs, 5);
    assert.equal(metrics.averageMinimumDelayMs, 1);
  });

  it("returns null averages with a zero emitted count", () => {
    const metrics = observeJitterBufferMetrics({
      jitterBufferDelay: 5,
      jitterBufferEmittedCount: 0,
    });
    assert.equal(metrics.averageDelayMs, null);
    assert.equal(metrics.averageTargetDelayMs, null);
    assert.equal(metrics.averageMinimumDelayMs, null);
  });

  it("treats missing fields as missing rather than zero", () => {
    const metrics = observeJitterBufferMetrics({ jitter: 0.01 });
    assert.equal(metrics.averageDelayMs, null);
    assert.equal(metrics.averageTargetDelayMs, null);
    assert.equal(metrics.averageMinimumDelayMs, null);
  });

  it("rejects malformed values", () => {
    const metrics = observeJitterBufferMetrics({
      jitterBufferDelay: "not-a-number",
      jitterBufferEmittedCount: Number.NaN,
    });
    assert.equal(metrics.averageDelayMs, null);
  });
});
