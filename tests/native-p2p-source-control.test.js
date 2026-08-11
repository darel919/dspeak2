import assert from "node:assert/strict";
import test from "node:test";
import { NativeP2pMesh } from "../app/shared/native-p2p.js";

function createMesh() {
  return new NativeP2pMesh({
    iceServers: [],
    sendSignal() {},
    onRemoteTrack() {},
    onRemoteTrackEnded() {},
    onFailure() {},
    onSnapshot() {},
  });
}

function createSender(track) {
  let parameters = { encodings: [{}] };
  return {
    track,
    getParameters: () => structuredClone(parameters),
    setParameters: async (next) => {
      parameters = structuredClone(next);
    },
    parameters: () => parameters,
  };
}

test("P2P per-peer receiving never disables a shared capture track", async () => {
  const client = createMesh();
  const track = { kind: "video", enabled: true };
  const screenSender = createSender(track);
  const state = {
    senders: new Map([["screen", screenSender]]),
    sourceReceiving: new Map(),
  };
  client.localSources.set("screen", { track });
  client.connections.set("peer-1", state);

  await client.setSenderReceiving(state, "screen", false);

  assert.equal(track.enabled, true);
  assert.equal(screenSender.parameters().encodings[0].active, false);
});

test("P2P source transmission remains global across provider handoff", async () => {
  const client = createMesh();
  const track = { kind: "audio", enabled: true };
  const audioSender = createSender(track);
  const state = {
    senders: new Map([["audio", audioSender]]),
    sourceReceiving: new Map([["audio", false]]),
  };
  client.localSources.set("audio", { track });
  client.connections.set("peer-1", state);

  await client.setSourceTransmission("audio", false);
  assert.equal(track.enabled, false);
  assert.equal(audioSender.parameters().encodings[0].active, false);

  await client.setSourceTransmission("audio", true);
  assert.equal(track.enabled, true);
  assert.equal(audioSender.parameters().encodings[0].active, false);
});

test("P2P preserves an initially muted source during publication", async () => {
  const client = createMesh();
  const track = { kind: "audio", enabled: false };

  await client.publishSource("audio", track, {});

  assert.equal(client.sourceTransmission.get("audio"), false);
  assert.equal(track.enabled, false);
});
