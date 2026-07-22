import assert from "node:assert/strict";
import test from "node:test";
import { RemoteMediaRegistry } from "../app/shared/remote-media-registry.js";

class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
  }

  createMediaStreamDestination() {
    return { disconnect() {}, stream: {} };
  }

  close() {
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

test("remote participants own independent Web Audio contexts", () => {
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
    assert.notEqual(first.context, second.context);
  } finally {
    globalThis.document = originalDocument;
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
