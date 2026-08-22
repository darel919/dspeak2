import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveMicrophoneProcessingConstraints } from "../shared/audio-codec-policy.ts";

describe("audio processing policy separation (execution-plan 11)", () => {
  it("maps explicit user processing settings one-to-one", () => {
    assert.deepEqual(
      resolveMicrophoneProcessingConstraints({
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,
      }),
      {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,
      },
    );
    assert.deepEqual(
      resolveMicrophoneProcessingConstraints({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
      }),
      {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
      },
    );
  });

  it("fills gaps with capture defaults without inventing values", () => {
    assert.deepEqual(resolveMicrophoneProcessingConstraints(null), {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
    assert.deepEqual(
      resolveMicrophoneProcessingConstraints({ echoCancellation: false }),
      {
        echoCancellation: false,
        noiseSuppression: true,
        autoGainControl: true,
      },
    );
  });

  it("channel latency policy never reaches capture constraint code", () => {
    for (const file of [
      "shared/audio-codec-policy.ts",
      "app/shared/media-capture.ts",
    ]) {
      const source = readFileSync(file, "utf8");
      assert.ok(
        !source.includes("audioLatencyProfile"),
        `${file} must not reference audioLatencyProfile`,
      );
      assert.ok(
        !source.includes("ultra-low"),
        `${file} must not branch on ultra-low`,
      );
    }
  });
});
