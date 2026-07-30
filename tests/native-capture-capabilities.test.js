import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getNativeCaptureCapability,
  normalizeNativeCaptureCapabilities,
} from "../app/shared/desktop-capture.js";

const unsupportedLinux = {
  nativeRtc: false,
  nativeBackendReady: false,
  capture: {
    pipewirePortal: {
      available: false,
      reason: "unsupported: PipeWire portal capture is not implemented",
      sources: [],
    },
    x11: {
      available: false,
      reason: "unsupported: X11 capture is not implemented",
      sources: [],
    },
    systemAudio: {
      available: false,
      reason: "unsupported: Linux system audio capture is not implemented",
      sources: [],
    },
  },
};

describe("native capture capability contract", () => {
  it("normalizes every platform backend to an explicit capability record", () => {
    const normalized = normalizeNativeCaptureCapabilities(unsupportedLinux);

    assert.deepEqual(Object.keys(normalized), [
      "pipewirePortal",
      "x11",
      "systemAudio",
      "windowsGraphicsCapture",
      "wasapiProcessLoopback",
    ]);
    assert.equal(normalized.pipewirePortal.available, false);
    assert.match(normalized.pipewirePortal.reason, /unsupported/);
    assert.deepEqual(normalized.pipewirePortal.sources, []);
    assert.equal(normalized.windowsGraphicsCapture.available, false);
    assert.deepEqual(normalized.windowsGraphicsCapture.sources, []);
  });

  it("selects the platform backends without turning an unavailable backend on", () => {
    const video = getNativeCaptureCapability(unsupportedLinux, "video");
    const audio = getNativeCaptureCapability(unsupportedLinux, "audio");

    assert.equal(video.available, false);
    assert.match(video.reason, /PipeWire portal|X11/);
    assert.equal(audio.available, false);
    assert.match(audio.reason, /system audio/);
    assert.deepEqual(video.sources, []);
    assert.deepEqual(audio.sources, []);
  });

  it("keeps source enumeration empty and reasons stable when metadata is absent", () => {
    const normalized = normalizeNativeCaptureCapabilities({});

    for (const capability of Object.values(normalized)) {
      assert.equal(capability.available, false);
      assert.equal(typeof capability.reason, "string");
      assert.ok(capability.reason.length > 0);
      assert.deepEqual(capability.sources, []);
    }
  });
});
