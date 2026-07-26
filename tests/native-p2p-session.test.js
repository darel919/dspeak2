import assert from "node:assert/strict";
import test from "node:test";
import {
  applyOpusAudioProfile,
  isP2pLivenessExpired,
  mediaFlowSnapshot,
  NativeP2pMesh,
  selectedPairSnapshot,
} from "../app/shared/native-p2p.js";

test("active P2P media stalls do not replace transport health", () => {
  assert.equal(isP2pLivenessExpired(1000, 61000, 20000), true);
  assert.equal(
    /media-flow-stopped|stats-unavailable/.test(
      NativeP2pMesh.prototype.startHealthChecks.toString(),
    ),
    false,
  );
});

test("P2P receiving preferences disable the remote sender encoding", async () => {
  const mesh = new NativeP2pMesh({ iceServers: [], sendSignal() {} });
  const parameters = { encodings: [{}] };
  const state = {
    sourceReceiving: new Map(),
    senders: new Map([
      [
        "screen",
        {
          getParameters: () => parameters,
          setParameters: async () => {},
        },
      ],
    ]),
  };

  await mesh.setSenderReceiving(state, "screen", false);

  assert.equal(state.sourceReceiving.get("screen"), false);
  assert.equal(parameters.encodings[0].active, false);
});

test("local microphone gating preserves the remote receiving preference", async () => {
  const parameters = { encodings: [{}] };
  const mesh = new NativeP2pMesh({ iceServers: [], sendSignal() {} });
  const state = {
    sourceReceiving: new Map([["audio", false]]),
    senders: new Map([
      [
        "audio",
        {
          getParameters: () => parameters,
          setParameters: async () => {},
        },
      ],
    ]),
  };
  mesh.connections.set("peer-2", state);

  await mesh.setSourceTransmission("audio", false);
  await mesh.setSourceTransmission("audio", true);

  assert.equal(state.sourceReceiving.get("audio"), false);
  assert.equal(parameters.encodings[0].active, false);
});

test("P2P sender parameter updates are serialized per sender", async () => {
  const parameters = { encodings: [{}] };
  let releaseFirst;
  let markFirstStarted;
  const firstStarted = new Promise((resolve) => {
    markFirstStarted = resolve;
  });
  let activeUpdates = 0;
  let maximumConcurrentUpdates = 0;
  let updateCount = 0;
  const sender = {
    getParameters: () => structuredClone(parameters),
    async setParameters(next) {
      updateCount += 1;
      activeUpdates += 1;
      maximumConcurrentUpdates = Math.max(
        maximumConcurrentUpdates,
        activeUpdates,
      );
      if (updateCount === 1) {
        markFirstStarted();
        await new Promise((resolve) => {
          releaseFirst = resolve;
        });
      }
      Object.assign(parameters, next);
      activeUpdates -= 1;
    },
  };
  const mesh = new NativeP2pMesh({
    iceServers: [],
    sendSignal() {},
    getSenderOptions: () => ({ encodings: [{ maxBitrate: 48000 }] }),
  });

  const configuring = mesh.configureSender(sender, "audio", {});
  await firstStarted;
  const gating = mesh.setSenderActive(sender, false);
  releaseFirst();
  await Promise.all([configuring, gating]);

  assert.equal(maximumConcurrentUpdates, 1);
  assert.equal(parameters.encodings[0].maxBitrate, 48000);
  assert.equal(parameters.encodings[0].active, false);
});

test("P2P screen receiving signals video and shared audio together", () => {
  const signals = [];
  const mesh = new NativeP2pMesh({
    iceServers: [],
    sendSignal: (signal) => signals.push(signal),
  });
  mesh.epoch = 7;

  mesh.setRemoteReceiving("peer-2", "screen", false);

  assert.deepEqual(
    signals.map((message) => message.signal.sourceReceiving),
    [
      { source: "screen", receiving: false },
      { source: "screen-audio", receiving: false },
    ],
  );
});

test("late P2P source identity reclassifies a generic track with a different browser ID", async () => {
  const originalMediaStream = globalThis.MediaStream;
  globalThis.MediaStream = class {
    constructor(tracks) {
      this.tracks = tracks;
    }
  };
  const bound = [];
  const ended = [];
  const mesh = new NativeP2pMesh({
    iceServers: [],
    sendSignal: () => {},
    onRemoteTrack: (entry) =>
      bound.push({ key: entry.key, source: entry.source }),
    onRemoteTrackEnded: (entry) =>
      ended.push({ key: entry.key, source: entry.source }),
  });
  mesh.epoch = 7;
  const track = {
    id: "screen-track",
    kind: "video",
    readyState: "live",
    addEventListener: () => {},
  };
  const state = {
    peerId: "peer-2",
    userId: "user-2",
    pc: {},
    remoteTracks: new Map(),
  };
  mesh.connections.set("peer-2", state);

  try {
    mesh.handleTrack(state, { track });
    await mesh.receiveSignal({
      fromPeerId: "peer-2",
      epoch: 7,
      signal: {
        source: { trackId: "sender-screen-track", source: "screen" },
      },
    });

    assert.deepEqual(ended, [{ key: "p2p:peer-2:video", source: "video" }]);
    assert.deepEqual(bound, [
      { key: "p2p:peer-2:video", source: "video" },
      { key: "p2p:peer-2:screen", source: "screen" },
    ]);
    assert.equal(state.remoteTracks.has("video"), false);
    assert.equal(state.remoteTracks.get("screen").track, track);
  } finally {
    globalThis.MediaStream = originalMediaStream;
  }
});

test("P2P resolves a uniquely signaled screen when browser track IDs differ", () => {
  const bound = [];
  const originalMediaStream = globalThis.MediaStream;
  globalThis.MediaStream = class {
    constructor(tracks) {
      this.tracks = tracks;
    }
  };
  const mesh = new NativeP2pMesh({
    iceServers: [],
    sendSignal: () => {},
    onRemoteTrack: (entry) => bound.push(entry),
  });
  const state = {
    peerId: "peer-2",
    userId: "user-2",
    remoteTracks: new Map(),
  };
  const track = {
    id: "receiver-generated-track-id",
    kind: "video",
    addEventListener: () => {},
  };
  mesh.remoteSources.set("peer-2:sender-track-id", "screen");

  try {
    mesh.handleTrack(state, { track });
    assert.equal(bound[0].source, "screen");
    assert.equal(state.remoteTracks.get("screen").track, track);
  } finally {
    globalThis.MediaStream = originalMediaStream;
  }
});

test("P2P source toggles reuse their sender instead of accumulating transceivers", async () => {
  const signals = [];
  const replacements = [];
  const sender = {
    replaceTrack(track) {
      replacements.push(track);
      return Promise.resolve();
    },
  };
  const mesh = new NativeP2pMesh({
    iceServers: [],
    sendSignal: (signal) => signals.push(signal),
  });
  const connection = {
    peerId: "peer-2",
    senders: new Map([["camera", sender]]),
    sourceReceiving: new Map(),
    pc: {
      addTrack: () => {
        throw new Error("must reuse existing sender");
      },
    },
  };
  mesh.connections.set(connection.peerId, connection);
  mesh.localSources.set("camera", { track: { id: "old" }, stream: {} });

  mesh.unpublishSource("camera");
  const replacement = { id: "new" };
  await mesh.publishSource("camera", replacement, {});

  assert.equal(connection.senders.get("camera"), sender);
  assert.deepEqual(replacements, [null, replacement]);
  assert.deepEqual(signals, [
    {
      targetPeerId: "peer-2",
      epoch: 0,
      signal: { sourceRemoved: { source: "camera" } },
    },
    {
      targetPeerId: "peer-2",
      epoch: 0,
      signal: { sourceRestored: { source: "camera" } },
    },
  ]);
});

test("P2P identifies a new source before negotiation can deliver its track", async () => {
  const operations = [];
  const mesh = new NativeP2pMesh({
    iceServers: [],
    sendSignal: ({ signal }) =>
      operations.push(`signal:${signal.source?.source}`),
  });
  const state = {
    peerId: "peer-2",
    senders: new Map(),
    sourceReceiving: new Map(),
    pc: {
      addTrack() {
        operations.push("add-track");
        return {};
      },
    },
  };

  await mesh.attachSource(state, "screen-audio", {
    stream: {},
    track: { id: "system-audio" },
  });

  assert.deepEqual(operations, ["signal:screen-audio", "add-track"]);
});

test("a new topology epoch resends an outstanding offer and source identity", () => {
  const signals = [];
  const mesh = new NativeP2pMesh({
    iceServers: [],
    sendSignal: (message) => signals.push(message),
  });
  mesh.epoch = 9;
  mesh.mode = "probing";
  mesh.localPeerId = "peer-1";
  mesh.startHealthChecks = () => {};
  mesh.startQualificationTimeout = () => {};
  mesh.emitSnapshot = () => {};
  const cameraTrack = { id: "camera-track" };
  mesh.localSources.set("camera", { track: cameraTrack, stream: {} });
  mesh.connections.set("peer-2", {
    peerId: "peer-2",
    userId: "user-2",
    pc: {
      signalingState: "have-local-offer",
      localDescription: { type: "offer", sdp: "camera-offer" },
    },
    senders: new Map([["camera", { track: cameraTrack }]]),
    remoteTracks: new Map(),
    sourceReceiving: new Map(),
  });

  mesh.applyTopology({
    mode: "probing",
    epoch: 10,
    localPeerId: "peer-1",
    peers: [
      { peerId: "peer-1", userId: "user-1", sources: ["camera"] },
      { peerId: "peer-2", userId: "user-2", sources: [] },
    ],
  });

  assert.deepEqual(signals, [
    {
      targetPeerId: "peer-2",
      epoch: 10,
      signal: {
        source: { trackId: "camera-track", source: "camera" },
      },
    },
    {
      targetPeerId: "peer-2",
      epoch: 10,
      signal: {
        description: { type: "offer", sdp: "camera-offer" },
      },
    },
  ]);
});

test("a new topology epoch repeats source removal for a reused sender", () => {
  const signals = [];
  const mesh = new NativeP2pMesh({
    iceServers: [],
    sendSignal: (message) => signals.push(message),
  });
  mesh.epoch = 10;
  mesh.connections.set("peer-2", {
    peerId: "peer-2",
    pc: { signalingState: "stable", localDescription: null },
    senders: new Map([["camera", { track: null }]]),
  });

  mesh.resynchronizeEpoch();

  assert.deepEqual(signals, [
    {
      targetPeerId: "peer-2",
      epoch: 10,
      signal: { sourceRemoved: { source: "camera" } },
    },
  ]);
});

test("P2P source restoration republishes the preserved remote receiver track", async () => {
  const restored = [];
  const mesh = new NativeP2pMesh({
    iceServers: [],
    sendSignal() {},
    onRemoteTrack: (entry) => restored.push(entry),
  });
  const entry = { source: "camera", track: { readyState: "live" } };
  mesh.connections.set("peer-2", {
    peerId: "peer-2",
    userId: "user-2",
    remoteTracks: new Map([["camera", entry]]),
  });

  await mesh.receiveSignal({
    fromPeerId: "peer-2",
    epoch: 0,
    signal: { sourceRestored: { source: "camera" } },
  });

  assert.deepEqual(restored, [entry]);
});

test("P2P source removal retires the retained remote receiver track", async () => {
  const retired = [];
  const mesh = new NativeP2pMesh({
    iceServers: [],
    sendSignal() {},
    onRemoteTrackEnded: (entry) => retired.push(entry),
  });
  const entry = {
    key: "p2p:peer-2:camera",
    peerId: "peer-2",
    userId: "user-2",
    source: "camera",
    track: { readyState: "live" },
  };
  const state = {
    peerId: "peer-2",
    userId: "user-2",
    remoteTracks: new Map([["camera", entry]]),
  };
  mesh.connections.set("peer-2", state);
  mesh.remoteSources.set("peer-2:camera-track", "camera");

  await mesh.receiveSignal({
    fromPeerId: "peer-2",
    epoch: 0,
    signal: { sourceRemoved: { source: "camera" } },
  });

  assert.deepEqual(retired, [entry]);
  assert.equal(state.remoteTracks.has("camera"), false);
  assert.equal(mesh.remoteSources.has("peer-2:camera-track"), false);
});

test("topology identity reconciles an early signaling connection", () => {
  const restaged = [];
  const mesh = new NativeP2pMesh({
    iceServers: [],
    sendSignal() {},
    onRemoteTrack: (entry) => restaged.push({ ...entry }),
  });
  const entry = {
    source: "screen",
    userId: "peer-2",
    track: { readyState: "live" },
  };
  const state = {
    peerId: "peer-2",
    userId: "peer-2",
    remoteTracks: new Map([["screen", entry]]),
  };
  mesh.connections.set("peer-2", state);

  assert.equal(mesh.ensureConnection("peer-2", "user-2"), state);
  assert.equal(state.userId, "user-2");
  assert.equal(entry.userId, "user-2");
  assert.deepEqual(
    restaged.map((candidate) => candidate.userId),
    ["user-2"],
  );
});

test("polite glare rollback answers before sender reconfiguration can fail", async () => {
  const operations = [];
  const signals = [];
  const failures = [];
  const pc = {
    signalingState: "have-local-offer",
    remoteDescription: null,
    localDescription: null,
    async setLocalDescription(description) {
      operations.push(`local:${description.type}`);
      this.localDescription =
        description.type === "rollback" ? null : description;
      this.signalingState =
        description.type === "rollback" ? "stable" : this.signalingState;
    },
    async setRemoteDescription(description) {
      operations.push(`remote:${description.type}`);
      this.remoteDescription = description;
      this.signalingState = "have-remote-offer";
    },
    async createAnswer() {
      operations.push("create-answer");
      return { type: "answer", sdp: "v=0\r\n" };
    },
    getTransceivers: () => [],
  };
  const mesh = new NativeP2pMesh({
    iceServers: [],
    sendSignal: (signal) => signals.push(signal),
    onFailure: (failure) => failures.push(failure),
    getSenderOptions: () => ({ encodings: [{}] }),
  });
  mesh.mode = "probing";
  mesh.epoch = 4;
  mesh.connections.set("peer-2", {
    peerId: "peer-2",
    polite: true,
    makingOffer: true,
    settingRemoteAnswer: false,
    ignoreOffer: false,
    pc,
    candidates: [],
    senders: new Map([
      [
        "screen",
        {
          getParameters: () => {
            throw new Error("sender rolled back");
          },
          setParameters: async () => {},
        },
      ],
    ]),
  });
  mesh.localSources.set("screen", { track: { kind: "video" } });

  await mesh.receiveSignal({
    fromPeerId: "peer-2",
    epoch: 4,
    signal: { description: { type: "offer", sdp: "v=0\r\n" } },
  });

  assert.deepEqual(operations, [
    "local:rollback",
    "remote:offer",
    "create-answer",
    "local:answer",
  ]);
  assert.equal(signals.at(-1).signal.description.type, "answer");
  assert.equal(failures.at(-1).reason, "sender-configuration-failed");
});

test("P2P SDP requests stereo low-latency Opus with loss protection", () => {
  const sdp =
    "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=20;useinbandfec=0\r\n";
  const result = applyOpusAudioProfile(sdp);
  assert.match(
    result,
    /a=fmtp:111 minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;usedtx=0/,
  );
  assert.match(result, /a=ptime:10/);
});

test("P2P video sender preserves frame cadence and applies its bitrate policy", async () => {
  let applied = null;
  const sender = {
    getParameters: () => ({ encodings: [{}], transactionId: "one" }),
    setParameters: async (parameters) => {
      applied = parameters;
    },
  };
  const mesh = new NativeP2pMesh({
    iceServers: [],
    sendSignal() {},
    getSenderOptions: () => ({
      encodings: [
        {
          maxBitrate: 12_000_000,
          maxFramerate: 60,
          priority: "high",
          networkPriority: "high",
        },
      ],
      degradationPreference: "maintain-framerate",
    }),
  });

  await mesh.configureSender(sender, "screen", { kind: "video" });

  assert.equal(applied.degradationPreference, "maintain-framerate");
  assert.deepEqual(applied.encodings[0], {
    maxBitrate: 12_000_000,
    maxFramerate: 60,
    priority: "high",
    networkPriority: "high",
  });
});

test("P2P outbound source stats are read from its RTP sender", async () => {
  const report = new Map([
    ["audio", { type: "outbound-rtp", bytesSent: 1000 }],
  ]);
  const mesh = new NativeP2pMesh({ iceServers: [], sendSignal() {} });
  mesh.connections.set("peer-2", {
    senders: new Map([["screen-audio", { getStats: async () => report }]]),
  });

  assert.equal(await mesh.getOutboundTrackStats("screen-audio"), report);
  assert.equal(await mesh.getOutboundTrackStats("missing"), null);
});

test("P2P health collectors can share one browser statistics report", async () => {
  let reads = 0;
  const report = new Map([
    [
      "transport",
      { id: "transport", type: "transport", selectedCandidatePairId: "pair" },
    ],
    [
      "pair",
      {
        id: "pair",
        type: "candidate-pair",
        state: "succeeded",
        nominated: true,
        localCandidateId: "local",
        remoteCandidateId: "remote",
      },
    ],
    [
      "local",
      {
        id: "local",
        type: "local-candidate",
        candidateType: "host",
        protocol: "udp",
      },
    ],
    [
      "remote",
      {
        id: "remote",
        type: "remote-candidate",
        candidateType: "srflx",
        protocol: "udp",
      },
    ],
    ["outbound", { id: "outbound", type: "outbound-rtp", bytesSent: 1200 }],
    ["inbound", { id: "inbound", type: "inbound-rtp", bytesReceived: 900 }],
  ]);
  const pc = {
    async getStats() {
      reads += 1;
      return report;
    },
  };

  const sharedReport = await pc.getStats();
  const pair = await selectedPairSnapshot(pc, sharedReport);
  const flow = await mediaFlowSnapshot(pc, sharedReport);

  assert.equal(reads, 1);
  assert.equal(pair.local.candidateType, "host");
  assert.equal(pair.remote.candidateType, "srflx");
  assert.deepEqual(flow, {
    outboundCount: 1,
    inboundCount: 1,
    outboundBytes: 1200,
    inboundBytes: 900,
  });
});
