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
});
