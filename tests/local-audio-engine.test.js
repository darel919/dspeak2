import assert from "node:assert/strict";
import test from "node:test";
import { createLocalAudioEngine } from "../app/shared/local-audio-engine.js";

function createEngine({ context, p2pMesh, sfu, sharedAudioDucking }) {
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
    sharedAudioDucking,
    sharedAudioStats: { value: {} },
    updateNoiseFloor() {},
    voiceStore: { updateUserSpeaking() {} },
  });
}

test("shared audio publishes the gain-processed destination track", async () => {
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
    const entry = await engine.createSharedAudioSource({
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

test("shared audio waits for its processing clock before publication", async () => {
  const originalMediaStream = globalThis.MediaStream;
  const originalWindow = globalThis.window;
  let clockReads = 0;
  const destinationTrack = { id: "processed", kind: "audio" };
  const context = {
    baseLatency: 0.01,
    get currentTime() {
      clockReads += 1;
      return clockReads * 0.01;
    },
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
    const entry = await createEngine({ context }).createSharedAudioSource({
      source: "screen-audio",
      stream: new MediaStream([captureTrack]),
      track: captureTrack,
    });
    assert.equal(entry.track, destinationTrack);
    assert.ok(clockReads >= 4);
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
    await engine.createSharedAudioSource({
      source: "screen-audio",
      stream: new MediaStream([{ id: "capture", kind: "audio" }]),
      track: { id: "capture", kind: "audio" },
    });
    transmissions.length = 0;
    engine.setSharedAudioVolume(0);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(values.slice(-3), [
      ["cancel", 7],
      ["value", 1, 7],
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

test("speech priority attenuates the processed outbound track", async () => {
  const ramps = [];
  const sharedAudioDucking = { value: null };
  const gainParameter = {
    value: 1,
    cancelScheduledValues() {},
    setValueAtTime(value) {
      this.value = value;
    },
    linearRampToValueAtTime(value, time) {
      ramps.push([value, time]);
      this.value = value;
    },
  };
  const context = {
    currentTime: 5,
    state: "running",
    createAnalyser: () => ({
      connect() {},
      disconnect() {},
      fftSize: 0,
    }),
    createGain: () => ({
      connect() {},
      disconnect() {},
      gain: gainParameter,
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
    const engine = createEngine({ context, sharedAudioDucking });
    await engine.createSharedAudioSource({
      source: "screen-audio",
      stream: new MediaStream([{ id: "capture", kind: "audio" }]),
      track: { id: "capture", kind: "audio" },
    });
    engine.setSharedAudioAttenuation(true, {
      enabled: true,
      reductionPercent: 100,
      attackMs: 120,
      releaseMs: 650,
    });
    assert.deepEqual(sharedAudioDucking.value, {
      active: true,
      effectivePercent: 0,
    });
    engine.setSharedAudioAttenuation(false, {
      enabled: true,
      reductionPercent: 100,
      attackMs: 120,
      releaseMs: 650,
    });
    assert.deepEqual(sharedAudioDucking.value, {
      active: false,
      effectivePercent: 100,
    });

    assert.deepEqual(ramps, [
      [0, 5.12],
      [1, 5.65],
    ]);
  } finally {
    globalThis.MediaStream = originalMediaStream;
    globalThis.window = originalWindow;
  }
});

test("shared audio waits for its processing context before publication", async () => {
  const originalMediaStream = globalThis.MediaStream;
  const originalWindow = globalThis.window;
  const destinationTrack = { id: "processed", kind: "audio", stop() {} };
  let resumed = 0;
  const context = {
    currentTime: 0,
    state: "suspended",
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
    async resume() {
      resumed += 1;
      this.state = "running";
    },
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
    const engine = createEngine({ context });
    const publication = engine.createSharedAudioSource({
      source: "screen-audio",
      stream: new MediaStream([{ id: "capture", kind: "audio" }]),
      track: { id: "capture", kind: "audio" },
    });
    assert.equal(typeof publication.then, "function");
    assert.equal((await publication).track, destinationTrack);
    assert.equal(resumed, 1);
  } finally {
    globalThis.MediaStream = originalMediaStream;
    globalThis.window = originalWindow;
  }
});
