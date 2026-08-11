import assert from "node:assert/strict";
import test from "node:test";
import { RemoteMediaRegistry } from "../app/shared/remote-media-registry.ts";

class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.destination = {};
    this.state = "suspended";
  }

  createGain() {
    return {
      connect() {},
      disconnect() {},
      gain: {
        value: 1,
        cancelScheduledValues() {},
        setValueAtTime() {},
        linearRampToValueAtTime() {},
      },
    };
  }

  createMediaElementSource() {
    return { connect() {}, disconnect() {} };
  }

  createMediaStreamSource() {
    return { connect() {}, disconnect() {} };
  }

  close() {
    return Promise.resolve();
  }

  resume() {
    this.state = "running";
    return Promise.resolve();
  }
}

function createRegistry(overrides = {}) {
  return new RemoteMediaRegistry({
    audioFeeds: { value: new Map() },
    videoFeeds: { value: new Map() },
    getVolume: () => 1,
    getOutputDevice: () => "",
    isDeafened: () => false,
    isBroadcastMode: () => false,
    isAnyoneSpeaking: () => false,
    onSpeaking: () => {},
    ...overrides,
  });
}

test("remote participants share one room Web Audio context", () => {
  const container = { appendChild() {}, querySelectorAll: () => [] };
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  globalThis.window = { AudioContext: FakeAudioContext };
  globalThis.document = {
    body: { appendChild() {} },
    createElement: (tag) =>
      tag === "audio"
        ? {
            dataset: {},
            pause() {},
            play: () => Promise.resolve(),
            remove() {},
          }
        : container,
    getElementById: () => container,
  };

  try {
    const registry = createRegistry();
    const first = registry.getOrCreateGraph("person-a");
    const same = registry.getOrCreateGraph("person-a");
    const second = registry.getOrCreateGraph("person-b");
    assert.equal(first, same);
    assert.equal(first.context, second.context);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test("remote audio is pulled directly into the Web Audio output", () => {
  const originalDocument = globalThis.document;
  const originalMediaStream = globalThis.MediaStream;
  const originalWindow = globalThis.window;
  const connections = [];
  const context = new FakeAudioContext();
  context.createMediaElementSource = () => ({
    connect: (target) => connections.push(["source", target]),
    disconnect() {},
  });
  context.createGain = () => {
    const gain = {
      connect: (target) => connections.push(["gain", target]),
      disconnect() {},
      gain: {
        value: 1,
        cancelScheduledValues() {},
        setValueAtTime() {},
        linearRampToValueAtTime() {},
      },
    };
    return gain;
  };
  globalThis.window = {
    AudioContext: class {
      constructor() {
        return context;
      }
    },
  };
  globalThis.MediaStream = class {
    constructor(tracks) {
      this.tracks = tracks;
    }
  };
  const container = { appendChild() {} };
  globalThis.document = {
    body: { appendChild() {} },
    createElement: () => ({
      dataset: {},
      pause() {},
      play: () => Promise.resolve(),
      remove() {},
    }),
    getElementById: () => container,
  };

  try {
    const registry = createRegistry();
    registry.bind({
      key: "person-a:audio",
      provider: "sfu",
      source: "audio",
      track: { kind: "audio" },
      userId: "person-a",
    });
    assert.equal(connections[1][1], context.destination);
  } finally {
    globalThis.document = originalDocument;
    globalThis.MediaStream = originalMediaStream;
    globalThis.window = originalWindow;
  }
});

test("participant gain accepts a 200 percent target", () => {
  const registry = createRegistry();
  const values = [];
  const graph = { context: { currentTime: 5 } };
  const track = {
    active: true,
    audio: { volume: 1 },
    entry: { source: "audio", userId: "person-a" },
    gain: {
      gain: {
        value: 1,
        cancelScheduledValues() {},
        setValueAtTime() {},
        linearRampToValueAtTime: (value) => values.push(value),
      },
    },
  };
  registry.applyTrackGain(graph, track, false, 2);
  assert.deepEqual(values, [2]);
});

test("attenuation is applied through the Web Audio gain", () => {
  const registry = createRegistry({
    getAttenuation: () => ({
      enabled: true,
      reductionPercent: 100,
      attackMs: 0,
    }),
    isAnyoneSpeaking: () => true,
  });
  const graph = { context: { currentTime: 5 } };
  const applied = [];
  const track = {
    active: true,
    audio: { volume: 1 },
    entry: { source: "screen-audio", userId: "person-a" },
    gain: {
      gain: {
        value: 1,
        cancelScheduledValues() {},
        setValueAtTime(value) {
          applied.push(value);
        },
        linearRampToValueAtTime() {},
      },
    },
  };

  registry.applyTrackGain(graph, track, true);

  assert.equal(track.audio.volume, 1);
  assert.equal(applied.at(-1), 0);
});

test("unchanged attenuation does not restart an active volume fade", () => {
  const registry = createRegistry({
    getAttenuation: () => ({
      enabled: true,
      reductionPercent: 70,
      attackMs: 900,
      releaseMs: 2200,
    }),
    isAnyoneSpeaking: () => true,
  });
  const ramps = [];
  const graph = { context: { currentTime: 5 } };
  const track = {
    active: true,
    audio: { volume: 1 },
    entry: { source: "screen-audio", userId: "person-a" },
    gain: {
      gain: {
        value: 1,
        cancelScheduledValues() {},
        setValueAtTime() {},
        linearRampToValueAtTime(value, time) {
          ramps.push([value, time]);
        },
      },
    },
  };

  registry.applyTrackGain(graph, track);
  registry.applyTrackGain(graph, track);
  assert.equal(ramps.length, 1);
  assert.ok(Math.abs(ramps[0][0] - 0.3) < 0.000001);
  assert.equal(ramps[0][1], 5.9);
});

test("audio-only system sharing can stop and resume remote transmission", () => {
  const changes = [];
  const audioFeeds = {
    value: new Map([
      [
        "remote:user:screen-audio",
        {
          key: "remote:user:screen-audio",
          source: "screen-audio",
          ownerSource: "system-audio",
          userId: "user",
          track: { enabled: true },
        },
      ],
    ]),
  };
  const registry = createRegistry({
    audioFeeds,
    onVideoReceivingChange: (entry, receiving) =>
      changes.push([entry.source, receiving]),
  });

  assert.equal(
    registry.setAudioReceiving("remote:user:screen-audio", false),
    true,
  );
  assert.equal(
    audioFeeds.value.get("remote:user:screen-audio").receiving,
    false,
  );
  assert.equal(
    audioFeeds.value.get("remote:user:screen-audio").track.enabled,
    false,
  );
  assert.equal(
    registry.setAudioReceiving("remote:user:screen-audio", true),
    true,
  );
  assert.deepEqual(changes, [
    ["screen-audio", false],
    ["screen-audio", true],
  ]);
  assert.equal(
    audioFeeds.value.get("remote:user:screen-audio").track.enabled,
    true,
  );
});

test("system audio respects stream attenuation while anyone speaks", () => {
  const registry = createRegistry({
    getAttenuation: () => ({
      enabled: true,
      reductionPercent: 65,
      attackMs: 120,
      releaseMs: 650,
    }),
    isAnyoneSpeaking: () => true,
  });

  assert.equal(registry.attenuatedVolume("screen-audio", 1), 0.35);
  assert.ok(
    Math.abs(registry.attenuatedVolume("system-audio", 0.8) - 0.28) <
      Number.EPSILON,
  );
  assert.equal(registry.attenuatedVolume("audio", 1), 1);
});

test("disabled stream attenuation preserves system audio volume", () => {
  const registry = createRegistry({
    getAttenuation: () => ({
      enabled: false,
      reductionPercent: 65,
    }),
    isAnyoneSpeaking: () => true,
  });

  assert.equal(registry.attenuatedVolume("screen-audio", 1), 1);
});

test("local speaking transitions immediately apply stream attenuation", () => {
  const registry = createRegistry({
    getAttenuation: () => ({
      enabled: true,
      reductionPercent: 100,
    }),
  });

  registry.setExternalSpeaking("local-user", true);
  assert.equal(registry.attenuatedVolume("screen-audio", 1), 0);
  registry.setExternalSpeaking("local-user", false);
  assert.equal(registry.attenuatedVolume("screen-audio", 1), 1);
});

test("remote microphone VAD analyses the received track directly", () => {
  const originalMediaStream = globalThis.MediaStream;
  const receivedTracks = [];
  const detectionSource = { connect() {}, disconnect() {} };
  const registry = createRegistry();
  globalThis.MediaStream = class {
    constructor(tracks) {
      this.tracks = tracks;
    }
  };
  registry.audioContext = {
    createAnalyser: () => ({
      connect() {},
      disconnect() {},
      fftSize: 0,
    }),
    createMediaStreamSource: (stream) => {
      receivedTracks.push(...stream.tracks);
      return detectionSource;
    },
  };
  registry.participantAudio.set("person-a", {
    tracks: new Map([["person-a:audio", {}]]),
  });

  try {
    const track = { kind: "audio" };
    registry.startVoiceDetection({
      key: "person-a:audio",
      source: "audio",
      track,
      userId: "person-a",
    });
    assert.deepEqual(receivedTracks, [track]);
    assert.equal(
      registry.voiceDetectors.get("person-a:audio").source,
      detectionSource,
    );
  } finally {
    registry.participantAudio.clear();
    registry.stopVoiceDetection("person-a:audio");
    globalThis.MediaStream = originalMediaStream;
  }
});

test("remote playback is unlocked before delayed tracks arrive", async () => {
  const originalWindow = globalThis.window;
  globalThis.window = { AudioContext: FakeAudioContext };

  try {
    const registry = createRegistry();
    assert.equal(await registry.preparePlayback(), true);
    assert.equal(registry.audioContext.state, "running");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("a transient first playback failure schedules recovery", async () => {
  const registry = createRegistry();
  registry.audioContext = new FakeAudioContext();
  let scheduled = null;
  registry.scheduleGraphResume = (graph) => {
    scheduled = graph;
  };
  const receivedTrack = { id: "shared-audio" };
  const graph = {
    context: registry.audioContext,
    resumeAttempt: 0,
    resumePromise: null,
    resumeTimer: null,
    tracks: new Map([
      [
        "remote:user:screen-audio",
        {
          audio: {
            play: async () => {
              throw new Error("media element is not ready");
            },
            srcObject: { getAudioTracks: () => [receivedTrack] },
          },
          entry: { track: receivedTrack },
        },
      ],
    ]),
    userId: "user",
  };

  assert.equal(await registry.resumeGraph(graph), false);
  assert.equal(scheduled, graph);
  assert.equal(graph.resumePromise, null);
});

test("a stale audio context close cannot report after a new context is created", async () => {
  const originalWindow = globalThis.window;
  const closeControls = [];
  const states = [];
  class DeferredCloseAudioContext extends FakeAudioContext {
    close() {
      return new Promise((resolve, reject) =>
        closeControls.push({ reject, resolve }),
      );
    }
  }
  globalThis.window = { AudioContext: DeferredCloseAudioContext };

  try {
    const registry = createRegistry({
      onPlaybackState: (state) => states.push(state),
    });
    registry.getAudioContext();
    registry.clear();
    registry.getAudioContext();
    closeControls[0].reject(new Error("old context close failed"));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(
      states.some((state) => state.state === "context-close-failed"),
      false,
    );
    registry.clear();
    closeControls[1].resolve();
  } finally {
    globalThis.window = originalWindow;
  }
});

test("a graph teardown cancels an in-flight playback resume", async () => {
  const resumeControls = [];
  const states = [];
  const context = new FakeAudioContext();
  context.resume = () =>
    new Promise((resolve) => resumeControls.push({ resolve }));
  const registry = createRegistry({
    onPlaybackState: (state) => states.push(state),
  });
  registry.audioContext = context;
  const track = {
    audio: {
      pause() {},
      play: () => Promise.resolve(),
      remove() {},
      srcObject: null,
    },
    entry: { key: "remote:user:audio", track: {} },
    gain: { disconnect() {} },
    source: { disconnect() {} },
  };
  const graph = {
    closed: false,
    context,
    resumeAttempt: 0,
    resumeGeneration: 0,
    resumePromise: null,
    resumeTimer: null,
    tracks: new Map([["remote:user:audio", track]]),
    userId: "user",
  };
  registry.participantAudio.set("user", graph);

  const pendingResume = registry.resumeGraph(graph);
  registry.closeGraph(graph);
  resumeControls[0].resolve();

  assert.equal(await pendingResume, false);
  assert.equal(states.length, 0);
});
