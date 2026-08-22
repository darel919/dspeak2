import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RTT_WARNING_ENTER_MS,
  RTT_WARNING_ENTER_SAMPLES,
  RTT_WARNING_RECOVERY_MS,
  RTT_WARNING_RECOVERY_SAMPLES,
  advanceRttWarningTracker,
  createRttWarningTrackerState,
  deriveParticipantLatencyStatus,
  deriveWebMediaLatencyTier,
} from "../app/shared/web-rtc-latency-status.ts";

describe("rtt warning tracker hysteresis", () => {
  it("stays quiet below the enter threshold", () => {
    const initial = createRttWarningTrackerState();
    let state = initial;
    for (let i = 0; i < RTT_WARNING_ENTER_SAMPLES + 1; i++)
      state = advanceRttWarningTracker(state, RTT_WARNING_ENTER_MS);
    assert.equal(state.active, false);
  });

  it("raises only after consecutive high samples", () => {
    let state = createRttWarningTrackerState();
    state = advanceRttWarningTracker(state, 25);
    state = advanceRttWarningTracker(state, null);
    assert.equal(state.active, false);
    state = advanceRttWarningTracker(state, 25);
    for (let i = 1; i < RTT_WARNING_ENTER_SAMPLES; i++)
      state = advanceRttWarningTracker(state, 25);
    assert.equal(state.active, true);
  });

  it("requires a full recovery run before clearing", () => {
    let state = createRttWarningTrackerState();
    for (let i = 0; i < RTT_WARNING_ENTER_SAMPLES; i++)
      state = advanceRttWarningTracker(state, 30);
    assert.equal(state.active, true);
    for (let i = 0; i < RTT_WARNING_RECOVERY_SAMPLES - 1; i++)
      state = advanceRttWarningTracker(state, RTT_WARNING_RECOVERY_MS);
    assert.equal(state.active, true);
    state = advanceRttWarningTracker(state, RTT_WARNING_RECOVERY_MS);
    assert.equal(state.active, false);
  });

  it("a single high sample resets the recovery run", () => {
    let state = createRttWarningTrackerState();
    for (let i = 0; i < RTT_WARNING_ENTER_SAMPLES; i++)
      state = advanceRttWarningTracker(state, 30);
    for (let i = 0; i < RTT_WARNING_RECOVERY_SAMPLES - 1; i++)
      state = advanceRttWarningTracker(state, RTT_WARNING_RECOVERY_MS);
    state = advanceRttWarningTracker(state, 40);
    assert.equal(state.active, true);
    assert.equal(state.recoveredSamples, 0);
  });
});

describe("web media latency tier", () => {
  it("reports standard-webrtc without tuning evidence", () => {
    assert.equal(
      deriveWebMediaLatencyTier({
        receiverTuningApplied: false,
        receiverTargetObserved: null,
        senderPolicyVerified: false,
        observedTargetDelayLowered: false,
      }),
      "standard-webrtc",
    );
  });

  it("upgrades to latency-tuned-webrtc on verified sender policy", () => {
    assert.equal(
      deriveWebMediaLatencyTier({
        receiverTuningApplied: false,
        receiverTargetObserved: null,
        senderPolicyVerified: true,
        observedTargetDelayLowered: false,
      }),
      "latency-tuned-webrtc",
    );
  });

  it("upgrades on an assigned jitter target even before stats confirm it", () => {
    assert.equal(
      deriveWebMediaLatencyTier({
        receiverTuningApplied: true,
        receiverTargetObserved: 10,
        senderPolicyVerified: false,
        observedTargetDelayLowered: false,
      }),
      "latency-tuned-webrtc",
    );
  });

  it("does not upgrade when tuning was attempted but nothing landed", () => {
    assert.equal(
      deriveWebMediaLatencyTier({
        receiverTuningApplied: true,
        receiverTargetObserved: null,
        senderPolicyVerified: false,
        observedTargetDelayLowered: false,
      }),
      "standard-webrtc",
    );
  });
});

describe("participant latency status", () => {
  it("reports inactive levels when media is not active", () => {
    const status = deriveParticipantLatencyStatus({
      requested: "ultra-low",
      tier: "latency-tuned-webrtc",
      mediaActive: false,
      mediaRttMs: null,
    });
    assert.equal(status.audioSend, "inactive");
    assert.equal(status.videoReceive, "inactive");
    assert.equal(status.networkWarning, false);
    assert.deepEqual(status.warningReasons, []);
  });

  it("keeps the requested profile visible while active", () => {
    const status = deriveParticipantLatencyStatus({
      requested: "standard",
      tier: "standard-webrtc",
      mediaActive: true,
      mediaRttMs: 10,
    });
    assert.equal(status.requested, "standard");
    assert.equal(status.audioSend, "compatibility");
    assert.equal(status.networkWarning, false);
  });

  it("keeps a single elevated sample below the warning threshold", () => {
    const status = deriveParticipantLatencyStatus({
      requested: "ultra-low",
      tier: "latency-tuned-webrtc",
      mediaActive: true,
      mediaRttMs: 80,
      networkWarning: false,
    });
    assert.equal(status.mediaRttMs, 80);
    assert.equal(status.networkWarning, false);
    assert.deepEqual(status.warningReasons, []);
  });

  it("propagates an active tracker verdict into the warning channel", () => {
    let state = createRttWarningTrackerState();
    for (let i = 0; i < RTT_WARNING_ENTER_SAMPLES; i++)
      state = advanceRttWarningTracker(state, 30);
    assert.equal(state.active, true);
    const status = deriveParticipantLatencyStatus({
      requested: "ultra-low",
      tier: "latency-tuned-webrtc",
      mediaActive: true,
      mediaRttMs: 30,
      networkWarning: state.active,
    });
    assert.ok(status.warningReasons.includes("rtt"));
    assert.equal(status.networkWarning, true);
  });

  it("merges externally supplied reasons without duplicates", () => {
    const status = deriveParticipantLatencyStatus({
      requested: "ultra-low",
      tier: "latency-tuned-webrtc",
      mediaActive: true,
      mediaRttMs: null,
      warningReasons: ["jitter-buffer", "jitter-buffer"],
    });
    assert.deepEqual(status.warningReasons, ["jitter-buffer"]);
  });
});
