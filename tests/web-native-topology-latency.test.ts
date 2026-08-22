import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deriveWebMediaLatencyTier,
  advanceRttWarningTracker,
  createRttWarningTrackerState,
} from "../app/shared/web-rtc-latency-status.ts";
import { normalizeAudioLatencyCapabilities } from "../app/shared/types/audio-latency.ts";

describe("mixed native and web topology latency contract", () => {
  it("keeps native ultra-low capability normalization lossless for the web tier", () => {
    const capabilities = normalizeAudioLatencyCapabilities({
      version: 1,
      nativeAudioEngine: true,
      restrictedLowDelayOpus: true,
      captureQuantaUs: [2500, 10000],
      encodeFrameDurationsUs: [2500],
      decodeFrameDurationsUs: [5000],
      renderQuantaUs: [2500, 5000, 10000],
    });
    assert.equal(capabilities.nativeAudioEngine, true);
    assert.deepEqual(capabilities.captureQuantaUs, [2500, 10000]);
  });

  it("falls back to compatibility quanta for a native peer without capability data", () => {
    const capabilities = normalizeAudioLatencyCapabilities(null);
    assert.equal(capabilities.nativeAudioEngine, false);
    assert.deepEqual(capabilities.captureQuantaUs, [10000]);
  });

  it("reports standard-webrtc when neither path verifies tuning", () => {
    const tier = deriveWebMediaLatencyTier({
      receiverTuningApplied: false,
      receiverTargetObserved: null,
      senderPolicyVerified: false,
      observedTargetDelayLowered: false,
    });
    assert.equal(tier, "standard-webrtc");
  });

  it("reports latency-tuned-webrtc once either transport side verifies tuning", () => {
    const receiverSide = deriveWebMediaLatencyTier({
      receiverTuningApplied: true,
      receiverTargetObserved: 10,
      senderPolicyVerified: false,
      observedTargetDelayLowered: false,
    });
    const senderSide = deriveWebMediaLatencyTier({
      receiverTuningApplied: false,
      receiverTargetObserved: null,
      senderPolicyVerified: true,
      observedTargetDelayLowered: false,
    });
    assert.equal(receiverSide, "latency-tuned-webrtc");
    assert.equal(senderSide, "latency-tuned-webrtc");
  });

  it("applies identical rtt hysteresis regardless of the reporting runtime", () => {
    let state = createRttWarningTrackerState();
    state = advanceRttWarningTracker(state, 30);
    state = advanceRttWarningTracker(state, 30);
    const notYet = advanceRttWarningTracker(state, 30);
    assert.equal(notYet.active, true);
    const fresh = createRttWarningTrackerState();
    assert.equal(advanceRttWarningTracker(fresh, null).active, false);
  });
});
