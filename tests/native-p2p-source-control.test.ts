import assert from "node:assert/strict";
import test from "node:test";
import { NativeP2pMesh } from "../app/shared/native-p2p.ts";
import { NativeP2pSession } from "../app/shared/native-p2p-session.ts";

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

test("native P2P receive toggles do not rebind an existing track", async () => {
  const calls = [];
  const signals = [];
  let rebound = 0;
  const session = new NativeP2pSession({
    invoke: async (command, payload) => {
      calls.push([command, payload]);
      return {};
    },
    sendSignal: (signal) => signals.push(signal),
    onRemoteTrack: () => {
      rebound += 1;
    },
  });
  session.peers.set("peer-1", {
    peerId: "peer-1",
    userId: "user-2",
    handle: 9,
    remoteReceiving: new Map([["camera", true]]),
  });
  session.trackEntries.set("track-1", {
    key: "p2p:user-2:camera",
    trackId: "track-1",
    userId: "user-2",
    source: "camera",
    kind: "video",
    receiving: true,
    closed: false,
  });

  await session.setRemoteReceiving("user-2", "camera", true);
  assert.deepEqual(calls, [
    [
      "media_p2p_set_receive_enabled",
      { p2pHandle: 9, trackId: "track-1", enabled: true },
    ],
  ]);
  assert.deepEqual(signals, [
    {
      targetPeerId: "peer-1",
      epoch: 0,
      signal: { sourceReceiving: { source: "camera", receiving: true } },
    },
  ]);
  assert.equal(rebound, 0);

  await session.setRemoteReceiving("user-2", "camera", false);
  assert.deepEqual(calls, [
    [
      "media_p2p_set_receive_enabled",
      { p2pHandle: 9, trackId: "track-1", enabled: true },
    ],
    [
      "media_p2p_set_receive_enabled",
      { p2pHandle: 9, trackId: "track-1", enabled: false },
    ],
  ]);
  assert.deepEqual(signals, [
    {
      targetPeerId: "peer-1",
      epoch: 0,
      signal: { sourceReceiving: { source: "camera", receiving: true } },
    },
    {
      targetPeerId: "peer-1",
      epoch: 0,
      signal: { sourceReceiving: { source: "camera", receiving: false } },
    },
  ]);
  assert.equal(rebound, 0);
});
