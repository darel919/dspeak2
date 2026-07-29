import { existsSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("broadcast contract", () => {
  it("DJ Mode does not use browser-owned file capture", () => {
    assert.equal(existsSync("app/shared/local-broadcast-capture.js"), false);
    const dialog = readFileSync(
      "app/components/BroadcastSetupDialog.vue",
      "utf-8",
    );
    assert.doesNotMatch(dialog, /type="file"/);
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

  it("obsolete loopback proxy remains removed", () => {
    assert.ok(!existsSync("server/routes/api/broadcast/stream.get.js"));
  });

  it("server owns the DJ broadcast producer", () => {
    const source = readFileSync("server/utils/mediasoup-sfu.js", "utf-8");
    assert.match(source, /createDjBroadcastProducer/);
    assert.match(source, /createPlainTransport/);
    assert.match(source, /source: "broadcast-audio"/);
  });

  it("SFU signaling advertises broadcast-audio sources", () => {
    const source = readFileSync("server/utils/mediasoup-sfu.js", "utf-8");
    assert.ok(source.includes('"broadcast-audio"'));
  });

  it("uses authenticated SRT ingest through MediaMTX", () => {
    const config = readFileSync("ops/mediamtx/mediamtx.yml", "utf-8");
    const sessions = readFileSync("server/domains/dj/dj-sessions.js", "utf-8");
    assert.match(config, /authMethod: http/);
    assert.match(config, /srtAddress: :9999/);
    assert.match(sessions, /authorizeDjIngest/);
    assert.match(sessions, /libopus/);
  });

  it("does not shadow the Node process global while starting FFmpeg", () => {
    const sessions = readFileSync("server/domains/dj/dj-sessions.js", "utf-8");
    assert.doesNotMatch(sessions, /const process = session\.process/);
    assert.match(sessions, /const bridgeProcess = session\.process/);
  });

  it("retries the RTSP bridge while a new MediaMTX publisher becomes ready", () => {
    const sessions = readFileSync("server/domains/dj/dj-sessions.js", "utf-8");
    assert.match(sessions, /const BRIDGE_RETRY_MS = 1000/);
    assert.match(
      sessions,
      /session\.recoveryDeadline = Date\.now\(\) \+ PUBLISHER_RECOVERY_MS/,
    );
    assert.match(sessions, /\(\) => startBridge\(session\)/);
    assert.match(sessions, /session\.process !== bridgeProcess/);
  });
});
