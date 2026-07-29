import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("Broadcast UI contract", () => {
  it("Navbar no longer has a simple broadcastMode toggle", () => {
    const source = readFileSync("app/components/Navbar.vue", "utf-8");
    assert.ok(
      !source.includes("toggleBroadcastMode"),
      "Must not have toggleBroadcastMode function",
    );
  });

  it("Navbar has a broadcast dialog trigger", () => {
    const source = readFileSync("app/components/Navbar.vue", "utf-8");
    assert.ok(
      source.includes("broadcastDialogOpen") ||
        source.includes("BroadcastSetupDialog"),
      "Must trigger a broadcast setup dialog",
    );
  });

  it("BroadcastSetupDialog component exists", () => {
    assert.doesNotThrow(
      () => readFileSync("app/components/BroadcastSetupDialog.vue", "utf-8"),
      "BroadcastSetupDialog component must exist",
    );
  });

  it("BroadcastSetupDialog uses a non-blocking utility panel", () => {
    const source = readFileSync(
      "app/components/BroadcastSetupDialog.vue",
      "utf-8",
    );
    assert.ok(source.includes("<aside"));
    assert.ok(source.includes("pointer-events-none"));
    assert.ok(source.includes("pointer-events-auto"));
    assert.ok(!source.includes("modal-open"));
    assert.ok(!source.includes("<dialog"));
    assert.ok(source.includes('@click.stop="startBroadcast()"'));
  });

  it("BroadcastSetupDialog has start and stop controls", () => {
    const source = readFileSync(
      "app/components/BroadcastSetupDialog.vue",
      "utf-8",
    );
    assert.ok(
      source.includes("startBroadcast") || source.includes("beginBroadcast"),
      "Must have a start action",
    );
    assert.ok(
      source.includes("stopBroadcast") || source.includes("endBroadcast"),
      "Must have a stop action",
    );
  });

  it("BroadcastSetupDialog starts through voice store actions", () => {
    const source = readFileSync(
      "app/components/BroadcastSetupDialog.vue",
      "utf-8",
    );
    assert.ok(source.includes("voiceStore.startBroadcast(proxyUrl)"));
    assert.ok(source.includes("voiceStore.stopBroadcast()"));
    assert.ok(!source.includes("voiceStore.sfuComposable.value"));
  });

  it("BroadcastSetupDialog displays inactive start failures", () => {
    const source = readFileSync(
      "app/components/BroadcastSetupDialog.vue",
      "utf-8",
    );
    const setupPanel = source.slice(
      source.indexOf('<div v-if="!broadcastActive"'),
      source.indexOf('<div v-else class="space-y-3">'),
    );
    assert.ok(setupPanel.includes('v-if="broadcastError"'));
  });

  it("VoiceChannel has no removed RTMP setup remnants", () => {
    const source = readFileSync("app/components/VoiceChannel.vue", "utf-8");
    assert.ok(!source.includes("StreamSetup"));
    assert.ok(!source.includes("showStreamSetup"));
    assert.ok(!source.includes("setBroadcastMode"));
  });

  it("BroadcastSetupDialog shows the VLC command", () => {
    const source = readFileSync(
      "app/components/BroadcastSetupDialog.vue",
      "utf-8",
    );
    assert.ok(
      source.includes("VLC") || source.includes("vlc"),
      "Must reference VLC in the setup instructions",
    );
  });

  it("BroadcastSetupDialog shows status (waiting, connecting, live, error)", () => {
    const source = readFileSync(
      "app/components/BroadcastSetupDialog.vue",
      "utf-8",
    );
    assert.ok(
      source.includes("connecting") ||
        source.includes("Waiting") ||
        source.includes("Live") ||
        source.includes("live"),
      "Must show broadcast status",
    );
  });
});

describe("Voice store broadcast contract", () => {
  it("voice store has broadcastAudioSharing ref", () => {
    const source = readFileSync("app/stores/voice.js", "utf-8");
    assert.ok(
      source.includes("broadcastAudioSharing"),
      "Must expose broadcastAudioSharing",
    );
  });

  it("voice store passes the broadcast URL contract", () => {
    const source = readFileSync("app/stores/voice.js", "utf-8");
    assert.ok(source.includes("startBroadcastProduction({ url })"));
    assert.ok(
      source.indexOf("broadcastAudioSharing.value = true") >
        source.indexOf("await sfuComposable.value.startBroadcastProduction"),
    );
    assert.ok(!source.includes("startBroadcastProduction(url)"));
  });

  it("voice store has broadcast control actions", () => {
    const source = readFileSync("app/stores/voice.js", "utf-8");
    assert.ok(
      source.includes("toggleBroadcast"),
      "Must expose toggleBroadcast action",
    );
  });
});
