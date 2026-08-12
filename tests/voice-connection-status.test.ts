import assert from "node:assert/strict";
import { test } from "node:test";
import { getVoiceConnectionStatus } from "../app/shared/voice-connection-status.ts";

test("voice status identifies the media control phase before a session exists", () => {
  const status = getVoiceConnectionStatus({
    connecting: true,
    mediaState: "disconnected",
    phase: "socket-connecting",
  });
  assert.equal(status.label, "Connecting to media control");
  assert.equal(status.steps[0].state, "current");
  assert.equal(status.steps[1].state, "pending");
});

test("voice status distinguishes an uninitialized session from an open socket", () => {
  const status = getVoiceConnectionStatus({ connecting: true });
  assert.equal(status.label, "Waiting for media control");
  assert.equal(status.steps[0].state, "current");
});

test("voice status identifies RTC signaling and route selection phases", () => {
  assert.equal(
    getVoiceConnectionStatus({
      phase: "protocol-negotiating",
      connecting: true,
    }).label,
    "RTC signaling",
  );
  assert.equal(
    getVoiceConnectionStatus({
      phase: "topology-selecting",
      connecting: true,
    }).label,
    "Selecting media route",
  );
});

test("voice status identifies transport and media readiness phases", () => {
  const transport = getVoiceConnectionStatus({
    mediaState: "transport-connecting",
    phase: "transport-connecting",
    connecting: true,
  });
  const media = getVoiceConnectionStatus({
    mediaState: "ready-no-active-media",
    phase: "media-ready",
    connecting: true,
  });
  assert.equal(transport.label, "Connecting RTC transport");
  assert.equal(transport.steps[3].state, "current");
  assert.equal(media.label, "Checking media readiness");
  assert.equal(media.steps[4].state, "current");
});

test("voice status distinguishes a failed connection", () => {
  const status = getVoiceConnectionStatus({
    phase: "failed",
    connecting: false,
  });
  assert.equal(status.label, "Connection issue");
  assert.equal(status.steps[3].state, "current");
});
