import assert from "node:assert/strict";
import test from "node:test";
import { ref } from "vue";
import { createHybridMediaTopologyController } from "../app/shared/hybrid-media-topology-controller.ts";
import {
  emptyVideoCodecCapabilities,
  type ParticipantMediaCapabilities,
} from "../app/shared/types/video-codec-capabilities.ts";

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
