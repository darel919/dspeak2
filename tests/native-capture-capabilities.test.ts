import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  getNativeCaptureCapability,
  normalizeNativeCaptureCapabilities,
} from "../app/shared/desktop-capture.ts";
import { parseExternalString } from "../shared/types/external.ts";

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
  it("allows the first native microphone capture to establish health", async () => {
    const commands = await readFile(
      new URL(
        "../desktop/src-tauri/src/media/command_capture.rs",
        import.meta.url,
      ),
      "utf8",
    );
    assert.doesNotMatch(
      commands,
      /state\.capabilities\.native_rtc\s*\|\|\s*!state\.capabilities\.microphone/,
    );
  });

  it("preserves Windows camera and microphone startup error codes", async () => {
    const [source, support, session] = await Promise.all([
      readFile(
        new URL(
          "../desktop/native-media/platform/windows/PlatformCaptureWindowsAudio.cpp",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../desktop/native-media/platform/windows/PlatformCaptureWindowsSupport.cpp",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../desktop/native-media/platform/windows/PlatformCaptureWindowsSession.cpp",
          import.meta.url,
        ),
        "utf8",
      ),
    ]);
    assert.match(source, /startup_result_ = -601/);
    assert.match(source, /startup_result_ = -602/);
    assert.match(source, /startup_result_ = SUCCEEDED\(result\) \? 0 : -611/);
    assert.match(support, /camera_id_from_value\(const char\* value\)/);
    assert.match(session, /camera_id_from_value\(device_id\)/);
    assert.match(source, /set_output_type = \[&\]\(bool constrain_format\)/);
    assert.match(source, /set_output_type\(false\)/);
  });

  it("normalizes every platform backend to an explicit capability record", () => {
    const normalized = normalizeNativeCaptureCapabilities(unsupportedLinux);

    assert.deepEqual(Object.keys(normalized), [
      "screenCaptureKit",
      "screenAudio",
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

  it("retains enumerated sources before delivery health is proven", () => {
    const capabilities = {
      nativeRtc: true,
      nativeBackendReady: true,
      capture: {
        screenCaptureKit: {
          available: false,
          reason: "Screen capture delivery has not been probed",
          sources: [
            {
              sourceId: "display-1",
              sourceType: "display",
            },
          ],
        },
      },
    };

    const video = getNativeCaptureCapability(capabilities, "video");

    assert.equal(video.available, false);
    assert.equal(video.sources.length, 1);
  });

  it("keeps source enumeration empty and reasons stable when metadata is absent", () => {
    const normalized = normalizeNativeCaptureCapabilities({});

    for (const capability of Object.values(normalized)) {
      assert.equal(capability.available, false);
      assert.equal(parseExternalString(capability.reason), capability.reason);
      assert.ok(capability.reason.length > 0);
      assert.deepEqual(capability.sources, []);
    }
  });
});
