import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  compatibilityAudioLatencyCapabilities,
  effectiveAudioQuantumUs,
  normalizeAudioLatencyCapabilities,
} from "../app/shared/types/audio-latency.ts";

describe("audio latency capability contract", () => {
  it("degrades malformed input to compatibility media", () => {
    for (const bad of [null, "ultra", [], { version: 2 }, { nope: true }]) {
      assert.deepEqual(
        normalizeAudioLatencyCapabilities(bad),
        compatibilityAudioLatencyCapabilities(),
      );
    }
  });

  it("keeps only known integer quanta", () => {
    const normalized = normalizeAudioLatencyCapabilities({
      version: 1,
      nativeAudioEngine: true,
      captureQuantaUs: [2500, 3000, "5000", null],
      encodeFrameDurationsUs: [5000],
      decodeFrameDurationsUs: [5000],
      renderQuantaUs: [10000],
    });
    assert.deepEqual(normalized.captureQuantaUs, [2500]);
    assert.equal(normalized.nativeAudioEngine, true);
    assert.equal(normalized.restrictedLowDelayOpus, false);
  });

  it("effective quantum is the smallest intersection of all stages", () => {
    assert.equal(
      effectiveAudioQuantumUs({
        version: 1,
        nativeAudioEngine: true,
        restrictedLowDelayOpus: true,
        captureQuantaUs: [2500, 5000, 10000],
        encodeFrameDurationsUs: [5000, 10000],
        decodeFrameDurationsUs: [2500, 5000],
        renderQuantaUs: [5000, 10000],
      }),
      5000,
    );
    assert.equal(
      effectiveAudioQuantumUs({
        version: 1,
        nativeAudioEngine: true,
        restrictedLowDelayOpus: true,
        captureQuantaUs: [2500],
        encodeFrameDurationsUs: [5000],
        decodeFrameDurationsUs: [2500],
        renderQuantaUs: [2500],
      }),
      10000,
    );
    assert.equal(
      effectiveAudioQuantumUs(compatibilityAudioLatencyCapabilities()),
      10000,
    );
  });
});
