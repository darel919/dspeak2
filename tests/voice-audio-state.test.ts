import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { nextTick, ref, shallowRef, watch } from "vue";
import { buildMediaAttenuationWatchKey } from "../app/shared/media-attenuation-reporter.ts";
import {
  normalizeSharedAudioAttenuation,
  normalizeSharedAudioDucking,
  normalizeSharedAudioStats,
} from "../shared/voice-audio-state.ts";

describe("voice audio UI state", () => {
  it("unwraps media-session refs at the voice store boundary", async () => {
    const source = await readFile("app/stores/voice.ts", "utf8");

    assert.match(
      source,
      /normalizeSharedAudioStats\([\s\S]*?unref\([\s\S]*?sfuComposable\.value\?\.sharedAudioStats/,
    );
    assert.match(
      source,
      /normalizeSharedAudioAttenuation\([\s\S]*?unref\([\s\S]*?sfuComposable\.value\?\.sharedAudioAttenuation/,
    );
    assert.match(
      source,
      /normalizeSharedAudioDucking\([\s\S]*?unref\([\s\S]*?sfuComposable\.value\?\.sharedAudioDucking/,
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

  it("keeps attenuation effects independent from media-session output refs", async () => {
    const connected = ref(true);
    const speaking = ref(false);
    const ducking = ref({ active: false, effectivePercent: 100 });
    const session = shallowRef({
      sharedAudioDucking: ducking,
      setSharedAudioAttenuation() {
        ducking.value = { active: false, effectivePercent: 100 };
      },
    });
    let runs = 0;
    const stop = watch(
      () =>
        buildMediaAttenuationWatchKey({
          roomAttenuation: { enabled: true, reductionPercent: 65 },
          streamAttenuation: { mode: "room", reductionPercent: 65 },
          speaking: speaking.value,
          connected: connected.value,
          sessionAvailable:
            typeof session.value.setSharedAudioAttenuation === "function",
        }),
      () => {
        runs += 1;
        session.value.setSharedAudioAttenuation();
      },
      { immediate: true },
    );

    await nextTick();
    assert.equal(runs, 1);
    speaking.value = true;
    await nextTick();
    assert.equal(runs, 2);
    stop();
  });
});
