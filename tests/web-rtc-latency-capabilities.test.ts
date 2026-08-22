import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildInitialCapabilityReport,
  discoverInboundStatsFields,
  probeWebRtcEnvironment,
  receiverTuningCapabilityState,
  supportsJitterBufferTarget,
  supportsTargetLatency,
} from "../app/shared/web-rtc-latency-capabilities.ts";
import { isExternalBoolean } from "../app/shared/types/boundary.ts";

describe("web rtc environment probe (execution-plan 7)", () => {
  it("reports an unavailable runtime without inventing capabilities", () => {
    const probe = probeWebRtcEnvironment();
    assert.equal(isExternalBoolean(probe.peerConnection), true);
    assert.equal(isExternalBoolean(probe.getStats), true);
  });

  it("keeps every capability false when RTCPeerConnection is missing", () => {
    const original = globalThis.RTCPeerConnection;
    /* SAFETY: The test owns this global and restores it in the finally block below. */
    delete (globalThis as Record<string, unknown>).RTCPeerConnection;
    try {
      assert.deepEqual(probeWebRtcEnvironment(), {
        peerConnection: false,
        receiverJitterBufferTargetProperty: false,
        receiverTargetLatencyProperty: false,
        getStats: false,
      });
    } finally {
      /* SAFETY: The test owns this global and captured the original above. */
      (globalThis as Record<string, unknown>).RTCPeerConnection = original;
    }
  });
});

describe("typed feature guards", () => {
  type FeatureProbeStub = Partial<
    Record<"jitterBufferTarget" | "targetLatency", number>
  >;
  const asReceiver = (stub: FeatureProbeStub): RTCRtpReceiver => {
    /* SAFETY: The stub carries exactly the property the guard checks. */
    return stub as RTCRtpReceiver;
  };
  it("detects jitterBufferTarget by property presence", () => {
    assert.equal(supportsJitterBufferTarget(asReceiver({})), false);
    assert.equal(
      supportsJitterBufferTarget(asReceiver({ jitterBufferTarget: 10 })),
      true,
    );
  });

  it("detects targetLatency by property presence", () => {
    assert.equal(supportsTargetLatency(asReceiver({})), false);
    assert.equal(
      supportsTargetLatency(asReceiver({ targetLatency: 0.01 })),
      true,
    );
  });
});

describe("capability report", () => {
  it("marks receiver properties from the environment probe and leaves live sender state unknown", () => {
    const report = buildInitialCapabilityReport({
      peerConnection: true,
      receiverJitterBufferTargetProperty: true,
      receiverTargetLatencyProperty: false,
      getStats: true,
    });
    assert.equal(report.version, 1);
    assert.equal(report.receiverJitterBufferTarget, "supported");
    assert.equal(report.receiverTargetLatency, "unsupported");
    assert.equal(report.senderSetParameters, "unknown");
    assert.equal(report.senderMaxBitrate, "unknown");
    assert.equal(report.senderDegradationPreference, "unknown");
    assert.equal(report.rtcStats.jitterBufferTargetDelay, "unknown");
  });

  it("derives receiver states from the probe and defers live-only states to verification", () => {
    const report = buildInitialCapabilityReport({
      peerConnection: false,
      receiverJitterBufferTargetProperty: false,
      receiverTargetLatencyProperty: false,
      getStats: false,
    });
    assert.equal(report.receiverJitterBufferTarget, "unsupported");
    assert.equal(report.receiverTargetLatency, "unsupported");
    assert.equal(report.senderSetParameters, "unknown");
    assert.equal(report.rtcStats.jitterBufferDelay, "unknown");
  });
});

describe("receiver tuning capability state", () => {
  const base = {
    requestedTargetMs: 10,
    assignedTargetMs: null,
    observedTargetMs: null,
    targetLatencySupported: false,
  };
  it("stays unsupported when the property is absent", () => {
    assert.equal(
      receiverTuningCapabilityState({
        ...base,
        jitterBufferTargetSupported: false,
        applied: false,
        reason: "unsupported",
      }),
      "unsupported",
    );
  });

  it("requires assignment or observation evidence before claiming support", () => {
    assert.equal(
      receiverTuningCapabilityState({
        ...base,
        jitterBufferTargetSupported: true,
        applied: true,
        reason: "applied",
        assignedTargetMs: 10,
      }),
      "supported",
    );
    assert.equal(
      receiverTuningCapabilityState({
        ...base,
        jitterBufferTargetSupported: true,
        applied: true,
        reason: "applied",
        observedTargetMs: 12,
      }),
      "supported",
    );
    assert.equal(
      receiverTuningCapabilityState({
        ...base,
        jitterBufferTargetSupported: true,
        applied: true,
        reason: "applied",
      }),
      "unsupported",
    );
    assert.equal(
      receiverTuningCapabilityState({
        ...base,
        jitterBufferTargetSupported: true,
        applied: false,
        reason: "rejected",
      }),
      "unsupported",
    );
  });
});

describe("inbound stats field discovery", () => {
  it("marks only observed fields as supported", () => {
    const discovery = discoverInboundStatsFields([
      { jitterBufferDelay: 0.5, jitterBufferEmittedCount: 10, jitter: 0.005 },
    ]);
    assert.equal(discovery.jitterBufferDelay, "supported");
    assert.equal(discovery.inboundJitter, "supported");
    assert.equal(discovery.jitterBufferTargetDelay, "unsupported");
    assert.equal(discovery.framesDropped, "unsupported");
    assert.equal(discovery.powerEfficientDecoder, "unsupported");
  });

  it("aggregates fields across samples and ignores malformed values", () => {
    const discovery = discoverInboundStatsFields([
      { framesDecoded: "not-a-number" },
      { framesDecoded: 120, powerEfficientEncoder: true },
      { encoderImplementation: "libvpx" },
    ]);
    assert.equal(discovery.framesDecoded, "supported");
    assert.equal(discovery.powerEfficientEncoder, "supported");
    assert.equal(discovery.encoderImplementation, "supported");
    assert.equal(discovery.decoderImplementation, "unsupported");
  });

  it("returns every field as unsupported with no samples", () => {
    const discovery = discoverInboundStatsFields([]);
    for (const state of Object.values(discovery))
      assert.equal(state, "unsupported");
  });
});
