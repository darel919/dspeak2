import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  createDesktopCaptureSelection,
  desktopCaptureRequest,
  hasTauriRuntimeMarker,
  isDesktopCaptureSelection,
  normalizeCaptureSources,
  assertDesktopCaptureMode,
} from "../app/shared/desktop-capture.ts";

describe("desktop capture contract", () => {
  it("detects Tauri synchronously without treating a browser as desktop", () => {
    const previousWindow = globalThis.window;
    try {
      globalThis.window = {};
      assert.equal(hasTauriRuntimeMarker(), false);
      globalThis.window = { __TAURI_INTERNALS__: {} };
      assert.equal(hasTauriRuntimeMarker(), true);
    } finally {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    }
  });

  it("normalizes app, window, display, and system audio sources", () => {
    const sources = normalizeCaptureSources([
      { id: "app:one", kind: "application", name: "Editor" },
      { id: "window:one", kind: "window", title: "Document" },
      { id: "display:one", kind: "display", title: "Main display" },
      {
        id: "audio:system",
        kind: "system-audio",
        title: "System audio",
        selfExcluded: true,
        capabilities: { audio: true, stereo: true },
      },
      { id: "closed", kind: "window", available: false },
    ]);

    assert.deepEqual(
      sources.map((source) => source.sourceType),
      ["system-audio"],
    );
    assert.equal(sources.length, 1);
    assert.equal(sources[0].sourceKey, "system-audio:audio:system");
    assert.equal(sources[0].capabilities.video, false);
    assert.equal(sources[0].capabilities.audio, true);
  });

  it("requires stereo 48 kHz audio with self-audio exclusion", () => {
    const selection = createDesktopCaptureSelection(
      {
        sourceId: "window:editor",
        sourceType: "window",
        title: "Editor",
        selfExcluded: true,
        capabilities: { video: true, audio: true, stereo: true },
      },
      "both",
      { audio: { maxBitrateBps: 96000 } },
    );

    assert.equal(isDesktopCaptureSelection(selection), true);
    assert.equal(selection.sourceKey, "window:window:editor");
    assert.equal(selection.excludeSelf, true);
    assert.deepEqual(selection.audio, {
      channels: 2,
      sampleRate: 48000,
      excludeSelfAudio: true,
      stereo: true,
      maxBitrateBps: 96000,
    });
    assert.equal(selection.video.frameRate, 60);
  });

  it("rejects a capture selection when its operation requires another mode", () => {
    const selection = createDesktopCaptureSelection(
      {
        sourceId: "display:main",
        sourceType: "display",
        selfExcluded: true,
        capabilities: { video: true, audio: true, stereo: true },
      },
      "both",
    );

    assert.equal(
      assertDesktopCaptureMode(selection, ["video", "both"]),
      selection,
    );
    assert.throws(
      () => assertDesktopCaptureMode(selection, ["audio"], "system-audio"),
      /incompatible with system-audio/,
    );
  });

  it("rejects video requests for the system-audio source", () => {
    assert.throws(
      () =>
        createDesktopCaptureSelection(
          {
            sourceId: "audio:system",
            sourceType: "system-audio",
            title: "System audio",
            selfExcluded: true,
            capabilities: { video: false, audio: true, stereo: true },
          },
          "both",
        ),
      /does not provide video/,
    );
  });

  it("fails closed for unverified or mono audio sources", () => {
    assert.equal(
      normalizeCaptureSources([
        {
          sourceId: "window:unknown",
          sourceType: "window",
          capabilities: { video: true, audio: true, stereo: true },
        },
      ]).length,
      0,
    );
    assert.throws(
      () =>
        createDesktopCaptureSelection(
          {
            sourceId: "window:mono",
            sourceType: "window",
            selfExcluded: true,
            capabilities: { video: true, audio: true, stereo: false },
          },
          "audio",
        ),
      /does not guarantee stereo audio/,
    );
  });

  it("threads the selected identity, policy, and room bitrate into the native request", () => {
    const selection = createDesktopCaptureSelection(
      {
        sourceId: "display:main",
        sourceType: "display",
        bounds: { width: 2560, height: 1440 },
        selfExcluded: true,
        capabilities: { video: true, audio: true, stereo: true },
      },
      "both",
    );
    const request = desktopCaptureRequest(selection, {
      roomBitrateBps: 128000,
    });

    assert.deepEqual(request.source, selection.source);
    assert.equal(request.mode, "both");
    assert.equal(request.audio.channels, 2);
    assert.equal(request.audio.sampleRate, 48000);
    assert.equal(request.audio.excludeSelfAudio, true);
    assert.equal(request.excludeSelfAudio, true);
    assert.equal(request.roomBitrateBps, 128000);
    assert.equal(request.captureSelection.audio.maxBitrateBps, 128000);
    assert.deepEqual(request.captureSelection.bounds, {
      x: 0,
      y: 0,
      width: 2560,
      height: 1440,
    });
  });

  it("allows the native low-spec profile to cap screen capture before capture starts", () => {
    const selection = createDesktopCaptureSelection(
      {
        sourceId: "display:main",
        sourceType: "display",
        bounds: { width: 2560, height: 1440 },
        selfExcluded: true,
        capabilities: { video: true, audio: true, stereo: true },
      },
      "video",
    );
    const request = desktopCaptureRequest(selection, {
      video: {
        resolution: "720p",
        width: 1280,
        height: 720,
        frameRate: 15,
        lowSpec: true,
      },
    });

    assert.deepEqual(request.video, {
      resolution: "720p",
      frameRate: 15,
      qualityPriority: "framerate",
      width: 1280,
      height: 720,
      lowSpec: true,
    });
    assert.deepEqual(request.captureSelection.video, request.video);
  });

  it("builds the exact native request for macOS system audio", () => {
    const selection = createDesktopCaptureSelection(
      {
        sourceId: "macos:system-audio",
        sourceType: "system-audio",
        title: "System audio",
        selfExcluded: true,
        capabilities: { audio: true, stereo: true },
      },
      "audio",
    );
    const request = desktopCaptureRequest(selection, {
      operation: "system-audio",
      roomBitrateBps: 128000,
    });

    assert.equal(request.captureSelection.sourceId, "macos:system-audio");
    assert.equal(request.captureSelection.sourceType, "system-audio");
    assert.equal(
      request.captureSelection.sourceKey,
      "system-audio:macos:system-audio",
    );
    assert.equal(request.captureSelection.mode, "audio");
    assert.equal(request.captureSelection.excludeSelf, true);
    assert.equal(request.captureSelection.excludeSelfAudio, true);
    assert.equal(request.captureSelection.audio.channels, 2);
    assert.equal(request.captureSelection.audio.sampleRate, 48000);
    assert.equal(request.captureSelection.audio.stereo, true);
    assert.equal(request.captureSelection.audio.excludeSelfAudio, true);
  });

  it("routes the desktop navbar system-audio action through the picker", async () => {
    const source = await readFile("app/components/Navbar.vue", "utf8");
    assert.match(source, /@click="requestSystemAudioShare"/);
    assert.match(source, /:audio-only="capturePickerAudioOnly"/);
    assert.doesNotMatch(source, /@click="voiceStore\.toggleSystemAudioShare"/);
  });

  it("routes the voice-channel screen action through the desktop picker", async () => {
    const source = await readFile("app/components/VoiceChannel.vue", "utf8");
    assert.match(source, /const api = await getDesktopCaptureApi\(\);/);
    assert.match(source, /if \(runtimeStore\.isTauri \|\| api\)/);
    assert.match(source, /capturePickerOpen\.value = true;/);
  });

  it("enumerates native sources through a short-lived media preparation probe", async () => {
    const picker = await readFile(
      "app/components/DesktopCapturePicker.vue",
      "utf8",
    );
    const desktop = await readFile(
      "desktop/src-tauri/src/desktop/mod.rs",
      "utf8",
    );
    assert.match(picker, /media_prepare_capture/);
    assert.doesNotMatch(picker, /media_list_capture_sources/);
    assert.match(desktop, /media::media_prepare_capture/);
  });

  it("enumerates native devices through a short-lived media preparation probe", async () => {
    const runtime = await readFile(
      "app/composables/media/native-media-engine-observability.ts",
      "utf8",
    );
    const command = await readFile(
      "desktop/src-tauri/src/media/command_capture.rs",
      "utf8",
    );
    assert.match(runtime, /media_prepare_devices/);
    assert.match(command, /pub async fn media_prepare_devices/);
    assert.match(command, /call_native_shutdown\(\)/);
  });

  it("passes the bounded camera profile into native capture", async () => {
    const session = await readFile(
      "app/composables/media/native-media-engine-session.ts",
      "utf8",
    );
    const command = await readFile(
      "desktop/src-tauri/src/media/command_capture.rs",
      "utf8",
    );
    const bridge = await readFile(
      "desktop/native-media/libdspeak_media/src/internal/device_capture_bridge.cpp",
      "utf8",
    );
    assert.match(
      session,
      /videoSettings: engine\.getVideoSettings\?\.\("camera"\)/,
    );
    assert.match(command, /start_camera_capture\(settings\.as_ptr\(\)/);
    assert.match(bridge, /camera_profile_from_json/);
    assert.match(bridge, /std::clamp\(profile\.frame_rate, 15u, 60u\)/);
  });
});
