import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AudioLatencyProfile,
  DEFAULT_AUDIO_LATENCY_PROFILE,
  normalizeAudioLatencyProfile,
  validateAudioLatencyProfile,
  normalizeMediaPolicy,
  validateMediaPolicy,
} from "../shared/media-policy.ts";

describe("media-policy audio latency profile", () => {
  describe("AudioLatencyProfile constants", () => {
    it("has correct values", () => {
      assert.equal(AudioLatencyProfile.STANDARD, "standard");
      assert.equal(AudioLatencyProfile.ULTRA_LOW, "ultra-low");
    });

    it("is frozen", () => {
      assert.throws(() => {
        AudioLatencyProfile.STANDARD = "hacked";
      });
    });
  });

  describe("DEFAULT_AUDIO_LATENCY_PROFILE", () => {
    it("is standard", () => {
      assert.equal(DEFAULT_AUDIO_LATENCY_PROFILE, "standard");
    });
  });

  describe("normalizeAudioLatencyProfile", () => {
    it("returns standard for standard", () => {
      assert.equal(normalizeAudioLatencyProfile("standard"), "standard");
    });

    it("returns ultra-low for ultra-low", () => {
      assert.equal(normalizeAudioLatencyProfile("ultra-low"), "ultra-low");
    });

    it("defaults to standard for unknown values", () => {
      assert.equal(normalizeAudioLatencyProfile("unknown"), "standard");
      assert.equal(normalizeAudioLatencyProfile(null), "standard");
      assert.equal(normalizeAudioLatencyProfile(undefined), "standard");
      assert.equal(normalizeAudioLatencyProfile(123), "standard");
      assert.equal(normalizeAudioLatencyProfile(true), "standard");
    });
  });

  describe("validateAudioLatencyProfile", () => {
    it("accepts known values", () => {
      assert.equal(validateAudioLatencyProfile("standard"), true);
      assert.equal(validateAudioLatencyProfile("ultra-low"), true);
    });

    it("rejects unknown values", () => {
      assert.equal(validateAudioLatencyProfile("unknown"), false);
      assert.equal(validateAudioLatencyProfile(null), false);
      assert.equal(validateAudioLatencyProfile(undefined), false);
      assert.equal(validateAudioLatencyProfile(123), false);
      assert.equal(validateAudioLatencyProfile(""), false);
      assert.equal(validateAudioLatencyProfile("ULTRA-LOW"), false);
    });
  });

  describe("normalizeMediaPolicy with audioLatencyProfile", () => {
    it("preserves ultra-low when valid", () => {
      const result = normalizeMediaPolicy({ audioLatencyProfile: "ultra-low" });
      assert.equal(result.audioLatencyProfile, "ultra-low");
    });

    it("defaults old channel policies without the field to standard", () => {
      const result = normalizeMediaPolicy({
        microphoneKbps: 96,
        revision: 4,
      });
      assert.equal(result.audioLatencyProfile, "standard");
      assert.equal(result.revision, 4);
    });

    it("normalizes invalid values to standard instead of throwing", () => {
      const result = normalizeMediaPolicy({
        audioLatencyProfile: "sub-ms-turbo",
      });
      assert.equal(result.audioLatencyProfile, "standard");
    });

    it("normalizes null input to standard", () => {
      const result = normalizeMediaPolicy(null);
      assert.equal(result.audioLatencyProfile, "standard");
    });
  });

  describe("validateMediaPolicy with audioLatencyProfile", () => {
    it("accepts ultra-low", () => {
      const result = validateMediaPolicy({
        hdAudio: false,
        microphoneKbps: 48,
        cameraKbps: 1500,
        screenKbps: 4000,
        sharedAudioKbps: 128,
        audioLatencyProfile: "ultra-low",
      });
      assert.equal(result.valid, true);
      if (result.valid)
        assert.equal(result.value.audioLatencyProfile, "ultra-low");
    });

    it("rejects arbitrary quantum or unknown profile values", () => {
      const result = validateMediaPolicy({
        hdAudio: false,
        microphoneKbps: 48,
        cameraKbps: 1500,
        screenKbps: 4000,
        sharedAudioKbps: 128,
        audioLatencyProfile: 2500,
      });
      assert.equal(result.valid, false);
      assert.ok(
        !result.valid &&
          result.errors.some((error) => error.includes("audioLatencyProfile")),
      );
    });

    it("accepts policies that omit the field entirely", () => {
      const result = validateMediaPolicy({
        hdAudio: false,
        microphoneKbps: 48,
        cameraKbps: 1500,
        screenKbps: 4000,
        sharedAudioKbps: 128,
      });
      assert.equal(result.valid, true);
      if (result.valid)
        assert.equal(result.value.audioLatencyProfile, "standard");
    });
  });
});
