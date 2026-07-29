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
    assert.ok(
      !source.includes("toggleBroadcastMode"),
      "Must not have legacy toggleBroadcastMode function",
    );
    const broadcastLabels = source.match(
      /Broadcast[\\s\\S]{0,200}toggleSystemAudioShare/,
    );
    assert.ok(
      !broadcastLabels,
      "Broadcast button must not alias system audio share",
    );
  });

  it("voice store exposes a broadcast audio sharing ref", () => {
    const source = readFileSync("app/stores/voice.js", "utf-8");
    assert.ok(
      source.includes("broadcastAudioSharing"),
      "voice store must expose broadcastAudioSharing",
    );
  });

  it("broadcast proxy remains loopback-only and forwards the token path", () => {
    const source = readFileSync(
      "server/routes/api/broadcast/stream.get.js",
      "utf-8",
    );
    assert.ok(source.includes("127.0.0.1"));
    assert.ok(source.includes("encodeURIComponent(token)"));
    assert.ok(!source.includes("const { port, url }"));
    assert.ok(!source.includes("url ||"));
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

  it("SFU signaling advertises broadcast-audio sources", () => {
    const source = readFileSync("server/utils/mediasoup-sfu.js", "utf-8");
    assert.ok(source.includes('"broadcast-audio"'));
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
