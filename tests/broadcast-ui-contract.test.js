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

  it("voice store has broadcast control actions", () => {
    const source = readFileSync("app/stores/voice.js", "utf-8");
    assert.ok(
      source.includes("toggleBroadcast"),
      "Must expose toggleBroadcast action",
    );
  });
});
