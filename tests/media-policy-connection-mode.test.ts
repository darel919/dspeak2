import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ConnectionMode,
  DEFAULT_CONNECTION_MODE,
  normalizeConnectionMode,
  validateConnectionMode,
  normalizeMediaPolicy,
  validateMediaPolicy,
  MEDIA_POLICY_LIMITS,
  STANDARD_MICROPHONE_MAX_KBPS,
} from "../shared/media-policy.ts";

describe("media-policy connection mode", () => {
  describe("ConnectionMode constants", () => {
    it("has correct values", () => {
      assert.equal(ConnectionMode.AUTO, "auto");
      assert.equal(ConnectionMode.DIRECT, "direct");
    });

    it("is frozen", () => {
      assert.throws(() => {
        ConnectionMode.AUTO = "hacked";
      });
    });
  });

  describe("DEFAULT_CONNECTION_MODE", () => {
    it("is auto", () => {
      assert.equal(DEFAULT_CONNECTION_MODE, ConnectionMode.AUTO);
    });
  });

  describe("normalizeConnectionMode", () => {
    it("returns auto for auto", () => {
      assert.equal(normalizeConnectionMode("auto"), "auto");
    });

    it("returns direct for direct", () => {
      assert.equal(normalizeConnectionMode("direct"), "direct");
    });

    it("defaults to auto for unknown values", () => {
      assert.equal(normalizeConnectionMode("unknown"), "auto");
      assert.equal(normalizeConnectionMode(null), "auto");
      assert.equal(normalizeConnectionMode(undefined), "auto");
      assert.equal(normalizeConnectionMode(123), "auto");
    });
  });

  describe("validateConnectionMode", () => {
    it("returns true for auto", () => {
      assert.equal(validateConnectionMode("auto"), true);
    });

    it("returns true for direct", () => {
      assert.equal(validateConnectionMode("direct"), true);
    });

    it("returns false for unknown values", () => {
      assert.equal(validateConnectionMode("unknown"), false);
      assert.equal(validateConnectionMode(null), false);
      assert.equal(validateConnectionMode(undefined), false);
      assert.equal(validateConnectionMode(123), false);
    });
  });

  describe("normalizeMediaPolicy with connectionMode", () => {
    it("preserves connectionMode when valid", () => {
      const result = normalizeMediaPolicy({ connectionMode: "direct" });
      assert.equal(result.connectionMode, "direct");
    });

    it("defaults connectionMode to auto when missing", () => {
      const result = normalizeMediaPolicy({});
      assert.equal(result.connectionMode, "auto");
    });

    it("normalizes invalid connectionMode to auto", () => {
      const result = normalizeMediaPolicy({ connectionMode: "invalid" });
      assert.equal(result.connectionMode, "auto");
    });
  });

  describe("validateMediaPolicy with connectionMode", () => {
    it("accepts valid connectionMode", () => {
      const result = validateMediaPolicy({
        connectionMode: "direct",
        hdAudio: false,
        microphoneKbps: 96,
        cameraKbps: 1500,
        screenKbps: 4000,
        sharedAudioKbps: 128,
      });
      assert.equal(result.valid, true);
      assert.equal(result.value.connectionMode, "direct");
    });

    it("normalizes invalid connectionMode instead of rejecting", () => {
      const result = validateMediaPolicy({
        connectionMode: "invalid",
        hdAudio: false,
        microphoneKbps: 96,
        cameraKbps: 1500,
        screenKbps: 4000,
        sharedAudioKbps: 128,
      });
      assert.equal(result.valid, true);
      assert.equal(result.value.connectionMode, "auto");
    });
  });
});
