import assert from "node:assert/strict";
import test from "node:test";
import { RemoteMediaRegistry } from "../app/shared/remote-media-registry.js";

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

  close() {
    return Promise.resolve();
  }

  resume() {
    this.state = "running";
    return Promise.resolve();
  }
}

function createRegistry() {
  return new RemoteMediaRegistry({
    audioFeeds: { value: new Map() },
    videoFeeds: { value: new Map() },
    getVolume: () => 1,
    getOutputDevice: () => "",
    isDeafened: () => false,
    isBroadcastMode: () => false,
    onSpeaking: () => {},
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
