import assert from "node:assert/strict";
import test from "node:test";
import { ref } from "vue";
import { createHybridMediaTopologyController } from "../app/shared/hybrid-media-topology-controller.ts";
import {
  emptyVideoCodecCapabilities,
  type ParticipantMediaCapabilities,
} from "../app/shared/types/video-codec-capabilities.ts";

function topologyControllerHarness({
  activeProvider: initialActiveProvider = "p2p",
  providerSocket: initialProviderSocket = null,
  sendResult = () => true,
} = {}) {
  let activeProvider = initialActiveProvider;
  let providerSocket = initialProviderSocket;
  let sfu = null;
  let p2pMesh = {
    applyTopology: async () => {},
    closeAll() {},
    isMediaReady: () => true,
    publishSource: async () => {},
  };
  let selectedProvider = "mediasoup";
  let initializeCalls = 0;
  const sent = [];

  class FakeSfuSession {
    provider = "mediasoup";
    providerId = "provider-1";

    initialize() {
      if (!providerSocket)
        return Promise.reject(new Error("provider socket unavailable"));
      initializeCalls += 1;
      return Promise.resolve();
    }

    addSource() {
      return Promise.resolve();
    }

    startSubscriptions() {
      return Promise.resolve();
    }

    connectionState() {
      return {
        ready: true,
        sendRequired: false,
        receiveRequired: false,
        send: "new",
        recv: "new",
      };
    }

    mediaReadiness() {
      return Promise.resolve({ ready: true });
    }

    handle() {
      return Promise.resolve();
    }

    setJitterBufferConfig() {}
  }

  class FakeProviderSocket {
    connect() {
      return Promise.resolve();
    }

    send() {
      return true;
    }

    close() {}
  }

  const topologyState = ref({
    mode: "idle",
    epoch: 0,
    sourceRevision: 0,
    peers: [],
    activeTransport: null,
    targetTransport: null,
  });
  const mediaConnectionState = ref("ready-no-active-media");
  const transportReady = ref(false);
  const iceConnectedBoth = ref(false);
  const error = ref(null);
  const currentJitterBufferConfig = ref({ minDelayMs: 0, targetDelayMs: 20 });
  const peerConnectionMetrics = ref({});
  const sfuRoundTripTime = ref(null);
  const reportedSfuFailureState = ref(null);
  const localSources = new Map();
  const handoff = {
    activateProvider() {},
    bind() {},
    clear() {},
    count: () => 0,
    entries: () => [],
    hasExpectedFeeds: () => true,
    pruneExpectedFeeds() {},
    remove() {},
    retire() {},
    stage() {},
  };
  const mediaGeneration = {
    capture: () => 1,
    assert() {},
    retire: () => 1,
  };

  const controller = createHybridMediaTopologyController({
    CloudflareRealtimeSession: FakeSfuSession,
    MediasoupClientSession: FakeSfuSession,
    MediasoupProviderSocket: FakeProviderSocket,
    NativeP2pMesh: class {},
    buildP2pVideoSenderOptions: () => ({}),
    buildVoiceProducerOptions: () => ({}),
    closeSocket: () => providerSocket?.close(),
    currentJitterBufferConfig,
    error,
    failSession() {},
    getActiveProvider: () => activeProvider,
    getAudioStereo: () => false,
    getEffectiveAudioBitrate: () => null,
    getIceServers: () => [],
    getConnectionEpoch: () => 1,
    getLocalPeerId: () => "local",
    getMessageHandler: () => undefined,
    getProviderSocket: () => providerSocket,
    getRequestedVideoSettings: () => ({
      frameRate: 30,
      qualityPriority: "framerate",
      resolution: "original",
    }),
    getSelectedSfuProvider: () => selectedProvider,
    getSfu: () => sfu,
    getP2pMesh: () => p2pMesh,
    handoff,
    iceConnectedBoth,
    localSources,
    mediaConnectionState,
    mediaGeneration,
    mediaReadinessPollMs: 1,
    mediaHandoffTimeoutMs: 100,
    onRemotePublication: () => [],
    peerConnectionMetrics,
    publishLocalSources: async () => {},
    refreshPublicMaps() {},
    refreshTopologyGraph() {},
    reportedSfuFailureState,
    replayCloudflarePublications: async () => {},
    send: (message) => {
      sent.push(message);
      return sendResult(message);
    },
    sfuRoundTripTime,
    setActiveProvider: (provider) => {
      activeProvider = provider;
    },
    setP2pMesh: (mesh) => {
      p2pMesh = mesh;
    },
    setProviderSocket: (socket) => {
      providerSocket = socket;
    },
    setSelectedSfuProvider: (provider) => {
      selectedProvider = provider;
    },
    setSfu: (session) => {
      sfu = session;
    },
    setConnectionPhase() {},
    setRouteConnectionState() {},
    shouldAcceptTopologyEvent: () => true,
    topologyEventKey: (data) =>
      `${data.epoch}:${data.mode}:${data.target || ""}:${data.sourceRevision || 0}`,
    topologyState,
    transportReady,
    updateP2pStats() {},
    waitForMediaTimeoutMs: () => 100,
  });

  return {
    controller,
    getActiveProvider: () => activeProvider,
    getInitializeCalls: () => initializeCalls,
    getSfu: () => sfu,
    sent,
    topologyState,
    setProviderSocket: (socket) => {
      providerSocket = socket;
    },
  };
}

test("SFU activation keeps P2P active until the provider ticket is ready", async () => {
  const harness = topologyControllerHarness({
    providerSocket: {
      close() {},
      send() {
        return true;
      },
    },
  });

  await harness.controller.queueTopology({
    mode: "sfu",
    provider: "mediasoup",
    providerId: "provider-1",
    epoch: 2,
    sourceRevision: 3,
    peers: [],
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.getActiveProvider(), "p2p");
  assert.equal(harness.getSfu(), null);
  assert.equal(harness.getInitializeCalls(), 0);
  assert.equal(harness.topologyState.value.activeTransport, "p2p");
  assert.equal(harness.topologyState.value.targetTransport, "sfu");
});

test("SFU activation promotes an initialized transport after P2P teardown", async () => {
  const harness = topologyControllerHarness();
  await harness.controller.handleProviderTicket({
    provider: "mediasoup",
    providerId: "provider-1",
    epoch: 2,
    sourceRevision: 3,
    signalingUrl: "wss://media.test/socket",
    ticket: "ticket",
  });

  await harness.controller.queueTopology({
    mode: "sfu",
    provider: "mediasoup",
    providerId: "provider-1",
    epoch: 2,
    sourceRevision: 3,
    peers: [],
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.getActiveProvider(), "sfu");
  assert.notEqual(harness.getSfu(), null);
  assert.equal(harness.getInitializeCalls(), 1);
});

test("SFU preparation waits for a mediasoup provider ticket before initializing", async () => {
  const harness = topologyControllerHarness();
  harness.controller.queueTopology({
    mode: "switching",
    target: "sfu",
    provider: "mediasoup",
    providerId: "provider-1",
    epoch: 2,
    sourceRevision: 3,
    peers: [],
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.getInitializeCalls(), 0);
  assert.equal(harness.getActiveProvider(), "p2p");

  await harness.controller.handleProviderTicket({
    provider: "mediasoup",
    providerId: "provider-1",
    epoch: 2,
    sourceRevision: 3,
    signalingUrl: "wss://media.test/socket",
    ticket: "ticket",
  });
  for (
    let attempt = 0;
    attempt < 10 &&
    !harness.sent.some((message) => message.type === "topology-ready");
    attempt++
  )
    await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.getInitializeCalls(), 1);
  assert.equal(harness.getActiveProvider(), "p2p");
  assert.equal(
    harness.sent.some((message) => message.type === "topology-ready"),
    true,
  );
});

test("failed SFU handoff cleans its staged session without retiring P2P", async () => {
  const harness = topologyControllerHarness({
    sendResult: (message) => message.type !== "topology-ready",
  });
  await harness.controller.handleProviderTicket({
    provider: "mediasoup",
    providerId: "provider-1",
    epoch: 2,
    sourceRevision: 3,
    signalingUrl: "wss://media.test/socket",
    ticket: "ticket",
  });

  harness.controller.queueTopology({
    mode: "switching",
    target: "sfu",
    provider: "mediasoup",
    providerId: "provider-1",
    epoch: 2,
    sourceRevision: 3,
    peers: [],
  });
  for (
    let attempt = 0;
    attempt < 10 &&
    !harness.sent.some((message) => message.type === "provider-failure");
    attempt++
  )
    await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.getActiveProvider(), "p2p");
  assert.equal(harness.getSfu(), null);
  assert.equal(
    harness.sent.some((message) => message.type === "provider-failure"),
    true,
  );
});

test("SFU provider failure retires the active provider before recovery", async () => {
  let activeProvider = "sfu";
  let socket = { close() {} };
  let sfu = {
    provider: "cloudflare-realtime",
    providerId: "cloudflare-primary",
    closeMedia() {},
  };
  let closedSocket = false;
  let activeProviderAfterFailure = null;
  const topologyState = ref({ epoch: 4, sourceRevision: 2 });
  const mediaConnectionState = ref("media-flowing");
  const transportReady = ref(true);
  const iceConnectedBoth = ref(true);

  const controller = createHybridMediaTopologyController({
    closeSocket: () => {
      closedSocket = true;
      socket?.close();
    },
    getActiveProvider: () => activeProvider,
    getSelectedSfuProvider: () => "cloudflare-realtime",
    getProviderSocket: () => socket,
    getSfu: () => sfu,
    handoff: { retire() {} },
    iceConnectedBoth,
    mediaConnectionState,
    setActiveProvider: (value) => {
      activeProvider = value;
      activeProviderAfterFailure = value;
    },
    setProviderSocket: (value) => {
      socket = value;
    },
    setSfu: (value) => {
      sfu = value;
    },
    setConnectionPhase() {},
    topologyState,
    transportReady,
  });

  controller.handleProviderFailure({
    provider: "cloudflare-realtime",
    providerId: "cloudflare-secondary",
    epoch: 4,
    sourceRevision: 2,
    reason: "other-provider-failed",
  });

  assert.equal(activeProvider, "sfu");
  assert.equal(sfu.providerId, "cloudflare-primary");

  controller.handleProviderFailure({
    provider: "cloudflare-realtime",
    providerId: "cloudflare-primary",
    epoch: 4,
    sourceRevision: 2,
    reason: "provider-failed",
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(closedSocket, true);
  assert.equal(activeProviderAfterFailure, null);
  assert.equal(activeProvider, null);
  assert.equal(socket, null);
  assert.equal(sfu, null);
  assert.equal(transportReady.value, false);
  assert.equal(iceConnectedBoth.value, false);
  assert.equal(mediaConnectionState.value, "recovering");
});

test("failed provider tickets do not leave a stale mediasoup socket", async () => {
  let providerSocket = null;
  let closed = false;
  const error = ref(null);
  class FakeProviderSocket {
    constructor(options) {
      this.options = options;
    }

    connect() {
      return Promise.reject(new Error("provider unavailable"));
    }

    close() {
      closed = true;
    }
  }

  const controller = createHybridMediaTopologyController({
    CloudflareRealtimeSession: class {},
    MediasoupClientSession: class {},
    MediasoupProviderSocket: FakeProviderSocket,
    error,
    getActiveProvider: () => null,
    getProviderSocket: () => providerSocket,
    getSelectedSfuProvider: () => "mediasoup",
    getSfu: () => null,
    send: () => true,
    setProviderSocket: (value) => {
      providerSocket = value;
    },
    setSelectedSfuProvider() {},
    setSfu() {},
    topologyState: ref({ epoch: 0, sourceRevision: 0 }),
  });

  const result = await controller.handleProviderTicket({
    provider: "mediasoup",
    epoch: 1,
    sourceRevision: 0,
    signalingUrl: "wss://media.test/socket",
    ticket: "ticket",
  });

  assert.equal(result, false);
  assert.equal(closed, true);
  assert.equal(providerSocket, null);
  assert.equal(error.value, "provider unavailable");
});

test("direct browser mediasoup provider receives the full codec capability matrix", async () => {
  let providerSocket = null;
  let connectedOptions = null;
  const error = ref(null);
  const videoCodecs = emptyVideoCodecCapabilities();
  videoCodecs.H264.encode = {
    supported: true,
    acceleration: "hardware",
    implementation: "browser-test",
    realtimeEfficiency: "excellent",
  };
  videoCodecs.H264.decode = {
    supported: true,
    acceleration: "hardware",
    implementation: "browser-test",
    realtimeEfficiency: "excellent",
  };
  const mediaCapabilities: ParticipantMediaCapabilities = {
    videoCodecs,
    concurrentEncode: {
      supported: true,
      maxHardwareSessions: 1,
      confidence: "conservative-default",
    },
    source: "browser-probe",
  };

  class FakeProviderSocket {
    connect(options) {
      connectedOptions = options;
      return Promise.resolve();
    }

    send() {
      return true;
    }

    close() {}
  }

  const controller = createHybridMediaTopologyController({
    CloudflareRealtimeSession: class {},
    MediasoupClientSession: class {},
    MediasoupProviderSocket: FakeProviderSocket,
    error,
    getActiveProvider: () => null,
    getMediaCapabilities: () => mediaCapabilities,
    getProviderSocket: () => providerSocket,
    getSelectedSfuProvider: () => "mediasoup",
    getSfu: () => null,
    send: () => true,
    setProviderSocket: (value) => {
      providerSocket = value;
    },
    setSelectedSfuProvider() {},
    setSfu() {},
    topologyState: ref({ epoch: 0, sourceRevision: 0 }),
  });

  const result = await controller.handleProviderTicket({
    provider: "mediasoup",
    epoch: 1,
    sourceRevision: 0,
    signalingUrl: "wss://media.test/socket",
    ticket: "ticket",
  });

  assert.equal(result, undefined);
  assert.equal(connectedOptions.mediaCapabilities, mediaCapabilities);
  assert.equal(connectedOptions.capabilityProtocol, "video-codec-matrix-v1");
});
