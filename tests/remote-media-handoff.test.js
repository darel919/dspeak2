import assert from "node:assert/strict";
import test from "node:test";
import { RemoteMediaHandoff } from "../app/shared/remote-media-handoff.js";
import {
  RemoteMediaRegistry,
  replaceMediaStreamTrack,
} from "../app/shared/remote-media-registry.js";

function harness() {
  const calls = [];
  const registry = {
    bind: (entry, options) => calls.push(["bind", entry.key, options]),
    remove: (key, owner) => calls.push(["remove", key, owner]),
    activateProvider: (provider) => calls.push(["activate", provider]),
    clearProvider: (provider) => calls.push(["retire", provider]),
    clearReceivingPreference: (key) => calls.push(["clear-receiving", key]),
    clear: () => calls.push(["clear"]),
  };
  return { handoff: new RemoteMediaHandoff(registry), calls };
}

test("replacement tracks keep one stable staged feed", () => {
  const { handoff } = harness();
  const oldTrack = { id: "old" };
  const replacement = { id: "new" };
  handoff.stage(
    {
      provider: "p2p",
      key: "p2p:peer:camera",
      userId: "user-1",
      source: "camera",
      track: oldTrack,
    },
    "sfu",
  );
  handoff.stage(
    {
      provider: "p2p",
      key: "p2p:peer:camera",
      userId: "user-1",
      source: "camera",
      track: replacement,
    },
    "sfu",
  );
  assert.equal(handoff.count("p2p"), 1);
  assert.equal([...handoff.entries("p2p")][0].track, replacement);
});

test("a retired track ending cannot remove its replacement", () => {
  const { handoff, calls } = harness();
  const oldTrack = { id: "old" };
  const replacement = { id: "new" };
  const entry = {
    provider: "p2p",
    key: "p2p:peer:screen",
    userId: "user-1",
    source: "screen",
    track: replacement,
  };
  handoff.stage(entry, "p2p");
  assert.equal(handoff.remove({ ...entry, track: oldTrack }), false);
  assert.equal(handoff.count("p2p"), 1);
  assert.equal(
    calls.some((call) => call[0] === "remove"),
    false,
  );
});

test("activation binds only the destination provider and retirement clears its staged tracks", () => {
  const { handoff, calls } = harness();
  handoff.stage(
    {
      provider: "sfu",
      key: "producer-1",
      userId: "user-1",
      source: "camera",
      track: {},
    },
    "p2p",
  );
  handoff.bind("sfu");
  assert.deepEqual(
    calls.map((call) => call.slice(0, 2)),
    [
      ["bind", "remote:user-1:camera"],
      ["activate", "sfu"],
    ],
  );
  handoff.retire("sfu");
  assert.equal(handoff.count("sfu"), 0);
});

test("P2P and SFU replacements share one logical remote feed identity", () => {
  const { handoff, calls } = harness();
  handoff.stage(
    {
      provider: "p2p",
      key: "p2p:peer-1:camera",
      userId: "user-1",
      source: "camera",
      track: {},
    },
    "p2p",
  );
  handoff.stage(
    {
      provider: "sfu",
      key: "producer-42",
      userId: "user-1",
      source: "camera",
      track: {},
    },
    "p2p",
  );
  handoff.bind("sfu");

  const boundKeys = calls
    .filter((call) => call[0] === "bind")
    .map((call) => call[1]);
  assert.deepEqual(new Set(boundKeys), new Set(["remote:user-1:camera"]));
});

test("handoff readiness requires every expected logical source", () => {
  const { handoff } = harness();
  const peers = [
    {
      peerId: "local-peer",
      userId: "local-user",
      sources: ["audio", "screen"],
    },
    { peerId: "peer-1", userId: "user-1", sources: ["audio", "screen"] },
  ];
  handoff.stage(
    {
      provider: "sfu",
      key: "audio-producer",
      userId: "user-1",
      source: "audio",
      track: {},
    },
    "p2p",
  );

  assert.equal(handoff.hasExpectedFeeds("sfu", peers, "local-peer"), false);

  handoff.stage(
    {
      provider: "sfu",
      key: "screen-producer",
      userId: "user-1",
      source: "screen",
      track: {},
    },
    "p2p",
  );

  assert.equal(handoff.hasExpectedFeeds("sfu", peers, "local-peer"), true);
});

test("authoritative source snapshots prune retired remote camera feeds", () => {
  const { handoff, calls } = harness();
  handoff.stage(
    {
      provider: "sfu",
      key: "camera-producer",
      userId: "user-1",
      source: "camera",
      track: {},
    },
    "sfu",
  );

  handoff.pruneExpectedFeeds(
    [
      { peerId: "local-peer", userId: "local-user", sources: ["screen"] },
      { peerId: "peer-1", userId: "user-1", sources: ["audio"] },
    ],
    "local-peer",
  );

  assert.equal(handoff.count("sfu"), 0);
  assert.equal(
    calls.some(
      (call) => call[0] === "remove" && call[1] === "remote:user-1:camera",
    ),
    true,
  );
});

test("a preparing screen feed is exposed as a paused viewer prompt", () => {
  const { handoff, calls } = harness();
  handoff.stage(
    {
      provider: "sfu",
      key: "screen-producer",
      userId: "user-1",
      source: "screen",
      track: {},
    },
    "p2p",
  );

  assert.deepEqual(calls[0], [
    "bind",
    "remote:user-1:screen",
    { staged: true },
  ]);
});

test("resolved participant identity replaces a staged peer-ID alias", () => {
  const { handoff, calls } = harness();
  const track = { id: "screen-track" };
  handoff.stage(
    {
      provider: "p2p",
      key: "p2p:peer-1:screen",
      peerId: "peer-1",
      source: "screen",
      track,
    },
    "sfu",
  );
  handoff.stage(
    {
      provider: "p2p",
      key: "p2p:peer-1:screen",
      peerId: "peer-1",
      userId: "user-1",
      source: "screen",
      track,
    },
    "sfu",
  );

  assert.equal(handoff.count("p2p"), 1);
  assert.equal([...handoff.entries("p2p")][0].key, "remote:user-1:screen");
  assert.equal(
    calls.some(
      (call) => call[0] === "remove" && call[1] === "remote:peer-1:screen",
    ),
    true,
  );
});

test("an inactive staged track ending cannot remove the active provider feed", () => {
  const { handoff, calls } = harness();
  handoff.stage(
    {
      provider: "p2p",
      key: "p2p:peer-1:camera",
      userId: "user-1",
      source: "camera",
      track: {},
    },
    "p2p",
  );
  const staged = {
    provider: "sfu",
    key: "producer-42",
    userId: "user-1",
    source: "camera",
    track: {},
  };
  handoff.stage(staged, "p2p");
  handoff.remove(staged);

  assert.equal(calls.filter((call) => call[0] === "remove").length, 0);
  assert.equal(handoff.count("p2p"), 1);
});

test("an inactive screen probe cannot replace the active screen feed", () => {
  const activeTrack = { id: "sfu-screen", kind: "video", enabled: true };
  const probeTrack = { id: "p2p-screen", kind: "video", enabled: true };
  const tracks = [activeTrack];
  const stream = {
    getTracks: () => [...tracks],
    removeTrack: (track) => tracks.splice(tracks.indexOf(track), 1),
    addTrack: (track) => tracks.push(track),
  };
  const videoFeeds = { value: new Map() };
  const registry = new RemoteMediaRegistry({
    audioFeeds: { value: new Map() },
    videoFeeds,
    getVolume: () => 1,
    getOutputDevice: () => null,
    isDeafened: () => false,
    isBroadcastMode: () => false,
    onSpeaking: () => {},
  });
  const handoff = new RemoteMediaHandoff(registry);
  const activeEntry = {
    provider: "sfu",
    key: "producer-1",
    userId: "user-1",
    source: "screen",
    track: activeTrack,
    stream,
  };
  const probeEntry = {
    provider: "p2p",
    key: "p2p:peer-1:screen",
    userId: "user-1",
    source: "screen",
    track: probeTrack,
    stream: {
      getTracks: () => [probeTrack],
      removeTrack: () => {},
      addTrack: () => {},
    },
  };
  const feedKey = "remote:user-1:screen";

  handoff.stage(activeEntry, "sfu");
  registry.setVideoReceiving(feedKey, true);
  handoff.stage(probeEntry, "sfu");
  handoff.remove(probeEntry);

  assert.equal(videoFeeds.value.get(feedKey).provider, "sfu");
  assert.equal(videoFeeds.value.get(feedKey).track, activeTrack);
  assert.equal(videoFeeds.value.get(feedKey).receiving, true);
  assert.deepEqual(tracks, [activeTrack]);
});

test("video handoff replaces the track without replacing the logical stream", () => {
  const oldTrack = { id: "p2p-track" };
  const newTrack = { id: "sfu-track" };
  const tracks = [oldTrack];
  const stream = {
    getTracks: () => [...tracks],
    removeTrack: (track) => tracks.splice(tracks.indexOf(track), 1),
    addTrack: (track) => tracks.push(track),
  };

  assert.equal(replaceMediaStreamTrack(stream, newTrack), stream);
  assert.deepEqual(tracks, [newTrack]);
});

test("video registry keeps the rendered stream while its provider changes", () => {
  const oldTrack = { id: "p2p-track", kind: "video" };
  const newTrack = { id: "sfu-track", kind: "video" };
  const tracks = [oldTrack];
  const stream = {
    getTracks: () => [...tracks],
    removeTrack: (track) => tracks.splice(tracks.indexOf(track), 1),
    addTrack: (track) => tracks.push(track),
  };
  const videoFeeds = { value: new Map() };
  const registry = new RemoteMediaRegistry({
    audioFeeds: { value: new Map() },
    videoFeeds,
    getVolume: () => 1,
    getOutputDevice: () => null,
    isDeafened: () => false,
    isBroadcastMode: () => false,
    onSpeaking: () => {},
  });

  registry.bind({
    key: "remote:user-1:screen",
    provider: "p2p",
    track: oldTrack,
    stream,
  });
  registry.bind({
    key: "remote:user-1:screen",
    provider: "sfu",
    track: newTrack,
    stream: {},
  });

  assert.equal(videoFeeds.value.get("remote:user-1:screen").stream, stream);
  assert.equal(videoFeeds.value.get("remote:user-1:screen").provider, "sfu");
  assert.deepEqual(tracks, [newTrack]);
});

test("registry ignores a late retired-provider removal after replacement", () => {
  const oldTrack = { id: "p2p-track", kind: "video" };
  const newTrack = { id: "sfu-track", kind: "video" };
  const tracks = [oldTrack];
  const stream = {
    getTracks: () => [...tracks],
    removeTrack: (track) => tracks.splice(tracks.indexOf(track), 1),
    addTrack: (track) => tracks.push(track),
  };
  const videoFeeds = { value: new Map() };
  const registry = new RemoteMediaRegistry({
    audioFeeds: { value: new Map() },
    videoFeeds,
    getVolume: () => 1,
    getOutputDevice: () => null,
    isDeafened: () => false,
    isBroadcastMode: () => false,
    onSpeaking: () => {},
  });
  const key = "remote:user-1:screen";
  registry.bind({ key, provider: "p2p", track: oldTrack, stream });
  registry.bind({ key, provider: "sfu", track: newTrack, stream: {} });

  registry.remove(key, { provider: "p2p", track: oldTrack });

  assert.equal(videoFeeds.value.get(key).provider, "sfu");
  assert.equal(videoFeeds.value.get(key).track, newTrack);
});

test("remote screen video requires an explicit receiving choice", () => {
  const track = { id: "screen-track", kind: "video", enabled: true };
  const stream = {
    getTracks: () => [track],
    removeTrack: () => {},
    addTrack: () => {},
  };
  const videoFeeds = { value: new Map() };
  const registry = new RemoteMediaRegistry({
    audioFeeds: { value: new Map() },
    videoFeeds,
    getVolume: () => 1,
    getOutputDevice: () => null,
    isDeafened: () => false,
    isBroadcastMode: () => false,
    onSpeaking: () => {},
  });
  const key = "remote:user-1:screen";

  registry.bind({ key, provider: "sfu", source: "screen", track, stream });
  assert.equal(track.enabled, false);
  assert.equal(videoFeeds.value.get(key).receiving, false);

  assert.equal(registry.setVideoReceiving(key, true), true);
  assert.equal(track.enabled, true);
  assert.equal(videoFeeds.value.get(key).receiving, true);
});

test("native remote screen video also requires an explicit receiving choice", () => {
  const changes = [];
  const videoFeeds = { value: new Map() };
  const registry = new RemoteMediaRegistry({
    audioFeeds: { value: new Map() },
    videoFeeds,
    getVolume: () => 1,
    getOutputDevice: () => null,
    isDeafened: () => false,
    isBroadcastMode: () => false,
    onSpeaking: () => {},
    onVideoReceivingChange: (entry, receiving) =>
      changes.push([entry.source, receiving]),
  });
  const key = "remote:user-1:screen";

  registry.bind({
    key,
    provider: "sfu",
    source: "screen",
    kind: "video",
    native: true,
  });

  assert.equal(videoFeeds.value.get(key).receiving, false);
  assert.deepEqual(changes, [["screen", false]]);
});

test("native paired screen audio follows viewer consent", () => {
  const changes = [];
  const audioFeeds = { value: new Map() };
  const videoFeeds = { value: new Map() };
  const registry = new RemoteMediaRegistry({
    audioFeeds,
    videoFeeds,
    getVolume: () => 1,
    getOutputDevice: () => null,
    isDeafened: () => false,
    isBroadcastMode: () => false,
    onSpeaking: () => {},
    onVideoReceivingChange: (entry, receiving) =>
      changes.push([entry.source, receiving]),
  });
  const screenKey = "remote:user-1:screen";
  const audioKey = "remote:user-1:screen-audio";

  registry.bind({
    key: screenKey,
    provider: "sfu",
    source: "screen",
    kind: "video",
    userId: "user-1",
    native: true,
  });
  registry.bind({
    key: audioKey,
    provider: "sfu",
    source: "screen-audio",
    ownerSource: "screen",
    kind: "audio",
    userId: "user-1",
    receiving: true,
    native: true,
  });

  assert.equal(audioFeeds.value.get(audioKey).receiving, false);
  assert.equal(registry.setVideoReceiving(screenKey, true), true);
  assert.equal(audioFeeds.value.get(audioKey).receiving, true);
  assert.deepEqual(changes.slice(-2), [
    ["screen", true],
    ["screen-audio", true],
  ]);
});

test("native standalone system audio still starts automatically", () => {
  const audioFeeds = { value: new Map() };
  const registry = new RemoteMediaRegistry({
    audioFeeds,
    videoFeeds: { value: new Map() },
    getVolume: () => 1,
    getOutputDevice: () => null,
    isDeafened: () => false,
    isBroadcastMode: () => false,
    onSpeaking: () => {},
  });
  const key = "remote:user-1:screen-audio";

  registry.bind({
    key,
    provider: "sfu",
    source: "screen-audio",
    ownerSource: "system-audio",
    kind: "audio",
    userId: "user-1",
    native: true,
  });

  assert.equal(audioFeeds.value.get(key).receiving, true);
});

test("late paired screen audio resumes after prior viewer consent", () => {
  const changes = [];
  const audioFeeds = { value: new Map() };
  const videoFeeds = { value: new Map() };
  const registry = new RemoteMediaRegistry({
    audioFeeds,
    videoFeeds,
    getVolume: () => 1,
    getOutputDevice: () => null,
    isDeafened: () => false,
    isBroadcastMode: () => false,
    onSpeaking: () => {},
    onVideoReceivingChange: (entry, receiving) =>
      changes.push([entry.source, receiving]),
  });
  registry.createAudioElement = () => {};
  const screenTrack = { kind: "video", enabled: true };
  const audioTrack = { kind: "audio", enabled: true };
  const screenKey = "remote:user-1:screen";
  const audioKey = "remote:user-1:screen-audio";

  registry.bind({
    key: screenKey,
    provider: "sfu",
    source: "screen",
    userId: "user-1",
    track: screenTrack,
    stream: {
      getTracks: () => [screenTrack],
      addTrack() {},
      removeTrack() {},
    },
  });
  registry.setVideoReceiving(screenKey, true);
  registry.bind({
    key: audioKey,
    provider: "sfu",
    source: "screen-audio",
    ownerSource: "screen",
    userId: "user-1",
    track: audioTrack,
  });

  assert.equal(audioTrack.enabled, true);
  assert.equal(audioFeeds.value.get(audioKey).receiving, true);
  assert.deepEqual(changes.at(-1), ["screen-audio", true]);
});

test("remote screen video keeps an explicit stopped state during handoff", () => {
  const oldTrack = { id: "p2p-screen", kind: "video", enabled: true };
  const newTrack = { id: "sfu-screen", kind: "video", enabled: true };
  const tracks = [oldTrack];
  const stream = {
    getTracks: () => [...tracks],
    removeTrack: (track) => tracks.splice(tracks.indexOf(track), 1),
    addTrack: (track) => tracks.push(track),
  };
  const videoFeeds = { value: new Map() };
  const registry = new RemoteMediaRegistry({
    audioFeeds: { value: new Map() },
    videoFeeds,
    getVolume: () => 1,
    getOutputDevice: () => null,
    isDeafened: () => false,
    isBroadcastMode: () => false,
    onSpeaking: () => {},
  });
  const key = "remote:user-1:screen";

  registry.bind({
    key,
    provider: "p2p",
    source: "screen",
    track: oldTrack,
    stream,
  });
  registry.setVideoReceiving(key, false);
  registry.bind({
    key,
    provider: "sfu",
    source: "screen",
    track: newTrack,
    stream: {},
  });

  assert.equal(newTrack.enabled, false);
  assert.equal(videoFeeds.value.get(key).receiving, false);
  assert.equal(videoFeeds.value.get(key).stream, stream);
});

test("remote screen receiving choice survives a temporary handoff gap", () => {
  const firstTrack = { id: "p2p-screen", kind: "video", enabled: true };
  const replacementTrack = { id: "sfu-screen", kind: "video", enabled: true };
  const stream = {
    tracks: [firstTrack],
    getTracks() {
      return [...this.tracks];
    },
    removeTrack(track) {
      this.tracks.splice(this.tracks.indexOf(track), 1);
    },
    addTrack(track) {
      this.tracks.push(track);
    },
  };
  const videoFeeds = { value: new Map() };
  const registry = new RemoteMediaRegistry({
    audioFeeds: { value: new Map() },
    videoFeeds,
    getVolume: () => 1,
    getOutputDevice: () => null,
    isDeafened: () => false,
    isBroadcastMode: () => false,
    onSpeaking: () => {},
  });
  const key = "remote:user-1:screen";

  registry.bind({
    key,
    provider: "p2p",
    source: "screen",
    track: firstTrack,
    stream,
  });
  registry.setVideoReceiving(key, true);
  registry.remove(key);
  registry.bind({
    key,
    provider: "sfu",
    source: "screen",
    track: replacementTrack,
    stream: {},
  });

  assert.equal(replacementTrack.enabled, true);
  assert.equal(videoFeeds.value.get(key).receiving, true);
});

test("background suspension restores camera and explicit screen choices", () => {
  const originalMediaStream = globalThis.MediaStream;
  globalThis.MediaStream = class {
    constructor(tracks) {
      this.tracks = tracks;
    }

    getTracks() {
      return this.tracks;
    }

    addTrack(track) {
      this.tracks.push(track);
    }

    removeTrack(track) {
      this.tracks = this.tracks.filter((candidate) => candidate !== track);
    }
  };
  const changes = [];
  const videoFeeds = { value: new Map() };
  const registry = new RemoteMediaRegistry({
    audioFeeds: { value: new Map() },
    videoFeeds,
    getVolume: () => 1,
    getOutputDevice: () => "",
    isDeafened: () => false,
    isBroadcastMode: () => false,
    isAnyoneSpeaking: () => false,
    onSpeaking: () => {},
    onVideoReceivingChange: (entry, receiving) =>
      changes.push([entry.source, receiving]),
  });
  const cameraTrack = { enabled: true, kind: "video" };
  const screenTrack = { enabled: true, kind: "video" };
  registry.bind({
    key: "remote:user:camera",
    source: "camera",
    track: cameraTrack,
    userId: "user",
  });
  registry.bind({
    key: "remote:user:screen",
    source: "screen",
    track: screenTrack,
    userId: "user",
  });
  registry.setVideoReceiving("remote:user:screen", true);

  registry.setDocumentHidden(true);
  assert.equal(cameraTrack.enabled, false);
  assert.equal(screenTrack.enabled, false);

  registry.setDocumentHidden(false);
  assert.equal(cameraTrack.enabled, true);
  assert.equal(screenTrack.enabled, true);
  assert.deepEqual(changes.slice(-2), [
    ["camera", true],
    ["screen", true],
  ]);
  globalThis.MediaStream = originalMediaStream;
});

test("a fully ended share clears its receiving choice", () => {
  const { handoff, calls } = harness();
  const entry = {
    provider: "sfu",
    key: "producer-1",
    userId: "user-1",
    source: "screen",
    track: {},
  };
  handoff.stage(entry, "sfu");
  handoff.remove(entry);

  assert.deepEqual(calls.at(-1), ["clear-receiving", "remote:user-1:screen"]);
});
