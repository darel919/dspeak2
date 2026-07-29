import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("broadcast contract", () => {
  it("broadcast capture module has no getDisplayMedia dependency", async () => {
    const source = readFileSync(
      "app/shared/local-broadcast-capture.js",
      "utf-8",
    );
    assert.ok(
      !source.includes("getDisplayMedia"),
      "broadcast capture must not call getDisplayMedia",
    );
  });

  it("broadcast mode toggle does not alias toggleSystemAudioShare", () => {
    const source = readFileSync("app/components/Navbar.vue", "utf-8");
    const toggleDef = source.match(
      /function\s+toggleBroadcastMode[\s\S]*?^\s*}/m,
    );
    assert.ok(toggleDef, "toggleBroadcastMode function must be defined");
    assert.ok(
      !toggleDef[0].includes("toggleSystemAudioShare"),
      "toggleBroadcastMode must not call toggleSystemAudioShare",
    );
  });

  it("voice store exposes a broadcast audio sharing ref", () => {
    const source = readFileSync("app/stores/voice.js", "utf-8");
    assert.ok(
      source.includes("broadcastAudioSharing"),
      "voice store must expose broadcastAudioSharing",
    );
  });

  it("source controller handles broadcast-audio source type", () => {
    const source = readFileSync(
      "app/shared/media-source-controller.js",
      "utf-8",
    );
    assert.ok(
      source.includes("broadcast-audio"),
      "source controller must handle broadcast-audio sources",
    );
  });

  it("broadcast audio uses a dedicated capture class", async () => {
    const { LocalBroadcastCapture } =
      await import("../app/shared/local-broadcast-capture.js");
    assert.ok(
      typeof LocalBroadcastCapture === "function",
      "LocalBroadcastCapture must be a class",
    );
    assert.ok(
      typeof LocalBroadcastCapture.prototype.start === "function",
      "LocalBroadcastCapture must have a start method",
    );
    assert.ok(
      typeof LocalBroadcastCapture.prototype.stop === "function",
      "LocalBroadcastCapture must have a stop method",
    );
  });
});
