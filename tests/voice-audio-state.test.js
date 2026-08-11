import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  normalizeSharedAudioAttenuation,
  normalizeSharedAudioDucking,
  normalizeSharedAudioStats,
} from "../shared/voice-audio-state.js";

describe("voice audio UI state", () => {
  it("unwraps media-session refs at the voice store boundary", async () => {
    const source = await readFile("app/stores/voice.js", "utf8");

    assert.match(
      source,
      /normalizeSharedAudioStats\(\s*unref\(sfuComposable\.value\?\.sharedAudioStats\)/,
    );
    assert.match(
      source,
      /normalizeSharedAudioAttenuation\(\s*unref\(sfuComposable\.value\?\.sharedAudioAttenuation\)/,
    );
    assert.match(
      source,
      /normalizeSharedAudioDucking\(\s*unref\(sfuComposable\.value\?\.sharedAudioDucking\)/,
    );
  });

  it("provides finite defaults for missing and partial audio stats", () => {
    assert.deepEqual(normalizeSharedAudioStats(), {
      kbps: 0,
      level: 0,
      dbfs: -60,
    });
    assert.deepEqual(normalizeSharedAudioStats({ level: 0.25 }), {
      kbps: 0,
      level: 0.25,
      dbfs: -60,
    });
    assert.deepEqual(
      normalizeSharedAudioStats({ kbps: undefined, level: NaN, dbfs: null }),
      { kbps: 0, level: 0, dbfs: -60 },
    );
  });

  it("preserves complete attenuation and ducking values", () => {
    assert.deepEqual(
      normalizeSharedAudioAttenuation({
        active: true,
        effectivePercent: 55,
        expectedListeners: 3,
        reportingListeners: 2,
      }),
      {
        active: true,
        effectivePercent: 55,
        expectedListeners: 3,
        reportingListeners: 2,
      },
    );
    assert.deepEqual(
      normalizeSharedAudioDucking({ active: true, effectivePercent: 40 }),
      { active: true, effectivePercent: 40 },
    );
  });
});
