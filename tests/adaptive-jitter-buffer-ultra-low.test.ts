import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ULTRA_LOW_JITTER_ENVELOPE_TARGET_MS,
  computeJitterBufferConfig,
  computeSfuJitterBufferConfig,
  smoothJitterBufferConfig,
} from "../app/shared/adaptive-jitter-buffer.ts";
import type { JitterBufferConfig } from "../app/shared/types/adaptive-media.ts";

describe("ultra-low jitter policy (execution-plan 10)", () => {
  it("keeps the standard ladder unchanged by default", () => {
    assert.deepEqual(computeJitterBufferConfig({ jitterMs: 1, rttMs: null }), {
      minDelayMs: 0,
      targetDelayMs: 20,
    });
    assert.deepEqual(computeJitterBufferConfig({ jitterMs: 40, rttMs: null }), {
      minDelayMs: 80,
      targetDelayMs: 120,
    });
  });

  it("uses a much smaller envelope for ultra-low", () => {
    assert.deepEqual(
      computeJitterBufferConfig({ jitterMs: 1, rttMs: null }, "ultra-low"),
      { minDelayMs: 0, targetDelayMs: 10 },
    );
    assert.deepEqual(
      computeJitterBufferConfig({ jitterMs: 20, rttMs: null }, "ultra-low"),
      { minDelayMs: 0, targetDelayMs: 30 },
    );
  });

  it("never disables jitter buffering", () => {
    const degraded = computeJitterBufferConfig(
      { jitterMs: 90, rttMs: null, lossPercent: 10 },
      "ultra-low",
    );
    assert.ok(degraded);
    assert.ok(degraded.targetDelayMs > 0);
    assert.ok(degraded.targetDelayMs <= ULTRA_LOW_JITTER_ENVELOPE_TARGET_MS);
  });

  it("contracts rapidly toward smaller targets in ultra-low", () => {
    const current: JitterBufferConfig = { minDelayMs: 20, targetDelayMs: 60 };
    const next: JitterBufferConfig = { minDelayMs: 0, targetDelayMs: 10 };
    assert.deepEqual(
      smoothJitterBufferConfig(current, next, "ultra-low"),
      next,
    );
    const standardNext = smoothJitterBufferConfig(
      { minDelayMs: 20, targetDelayMs: 60 },
      { minDelayMs: 0, targetDelayMs: 20 },
    );
    assert.deepEqual(standardNext, { minDelayMs: 0, targetDelayMs: 20 });
  });

  it("applies the envelope on SFU routes too", () => {
    assert.deepEqual(computeSfuJitterBufferConfig({ rttMs: 5 }, "ultra-low"), {
      minDelayMs: 0,
      targetDelayMs: 10,
    });
    assert.deepEqual(computeSfuJitterBufferConfig({ rttMs: 5 }), {
      minDelayMs: 0,
      targetDelayMs: 20,
    });
  });
});
