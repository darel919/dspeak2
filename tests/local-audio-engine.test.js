import assert from "node:assert/strict";
import test from "node:test";
import { createLocalAudioEngine } from "../app/shared/local-audio-engine.js";

function createEngine({ context, p2pMesh, sfu }) {
  return createLocalAudioEngine({
    authStore: { getUserData: () => ({ id: "local-user" }) },
    automaticGateThreshold: () => -40,
    capture: { stop() {} },
    collectOutboundAudioStats: () => ({ stats: null, sample: null }),
    createNoiseFloorEstimator: () => ({ noiseFloorDb: -60 }),
    getActiveProvider: () => "sfu",
    getAudioStereo: () => true,
    getEffectiveAudioBitrate: () => 128000,
    getP2pMesh: () => p2pMesh,
    getRequestedVideoSettings: () => ({}),
    getSfu: () => sfu,
    localSources: new Map(),
    microphoneLevelDb: () => -60,
    settingsStore: {
      microphoneGate: { enabled: false },
      sharedAudioVolume: 100,
      systemAudioBitrate: 128,
    },
    sharedAudioStats: { value: {} },
    updateNoiseFloor() {},
    voiceStore: { updateUserSpeaking() {} },
  });
}

test("shared audio publishes the gain-processed destination track", () => {
  const originalMediaStream = globalThis.MediaStream;
  const originalWindow = globalThis.window;
  const destinationTrack = { id: "processed", kind: "audio" };
  const context = {
    currentTime: 0,
    state: "running",
    createAnalyser: () => ({
      connect() {},
      disconnect() {},
      fftSize: 0,
    }),
    createGain: () => ({
      connect() {},
      disconnect() {},
      gain: {
        value: 1,
        cancelScheduledValues() {},
        setValueAtTime() {},
      },
    }),
    createMediaStreamDestination: () => ({
      stream: { getAudioTracks: () => [destinationTrack] },
    }),
    createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
    resume: () => Promise.resolve(),
  };
  globalThis.MediaStream = class {
    constructor(tracks) {
      this.tracks = tracks;
    }

    getAudioTracks() {
      return this.tracks;
    }
  };
  globalThis.window = {
    AudioContext: class {
      constructor() {
        return context;
      }
    },
  };

  try {
    const captureTrack = { id: "capture", kind: "audio" };
    const engine = createEngine({ context });
    const entry = engine.createSharedAudioSource({
      source: "screen-audio",
      stream: new MediaStream([captureTrack]),
      track: captureTrack,
    });
    assert.equal(entry.track, destinationTrack);
    assert.equal(entry.captureTrack, captureTrack);
  } finally {
    globalThis.MediaStream = originalMediaStream;
    globalThis.window = originalWindow;
  }
});

test("zero shared volume immediately mutes gain and both transports", async () => {
  const values = [];
  const transmissions = [];
  const context = {
    currentTime: 7,
    state: "running",
    createAnalyser: () => ({
      connect() {},
      disconnect() {},
      fftSize: 0,
    }),
    createGain: () => ({
      connect() {},
      disconnect() {},
      gain: {
        value: 1,
        cancelScheduledValues: (time) => values.push(["cancel", time]),
        setValueAtTime: (value, time) => values.push(["value", value, time]),
      },
    }),
    createMediaStreamDestination: () => ({
      stream: { getAudioTracks: () => [{ id: "processed", kind: "audio" }] },
    }),
    createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
    resume: () => Promise.resolve(),
  };
  const originalMediaStream = globalThis.MediaStream;
  const originalWindow = globalThis.window;
  globalThis.MediaStream = class {
    constructor(tracks) {
      this.tracks = tracks;
    }

    getAudioTracks() {
      return this.tracks;
    }
  };
  globalThis.window = {
    AudioContext: class {
      constructor() {
        return context;
      }
    },
  };

  try {
    const transport = (name) => ({
      setSourceTransmission: async (source, enabled) =>
        transmissions.push([name, source, enabled]),
    });
    const engine = createEngine({
      context,
      p2pMesh: transport("p2p"),
      sfu: transport("sfu"),
    });
    engine.createSharedAudioSource({
      source: "screen-audio",
      stream: new MediaStream([{ id: "capture", kind: "audio" }]),
      track: { id: "capture", kind: "audio" },
    });
    transmissions.length = 0;
    engine.setSharedAudioVolume(0);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(values.slice(-2), [
      ["cancel", 7],
      ["value", 0, 7],
    ]);
    assert.deepEqual(transmissions, [
      ["p2p", "screen-audio", false],
      ["sfu", "screen-audio", false],
    ]);
  } finally {
    globalThis.MediaStream = originalMediaStream;
    globalThis.window = originalWindow;
  }
});
