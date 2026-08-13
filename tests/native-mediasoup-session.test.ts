import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MEDIA_SIGNALING_CLIENT_PROTOCOL } from "../shared/media-signaling-protocol.ts";
import { NativeMediasoupSfuSession } from "../app/shared/native-mediasoup-session.ts";

const serverHello = {
  protocolVersion: 919,
  contractRevision: 3,
  heartbeatIntervalMs: 5000,
  heartbeatTimeoutMs: 20000,
  serverTime: Date.now(),
  mediaSessionId: "native-session",
};

function createSocketHarness() {
  const sockets = [];
  class FakeWebSocket {
    static OPEN = 1;
    static CLOSED = 3;

    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      this.listeners = new Map();
      sockets.push(this);
      queueMicrotask(() => {
        this.readyState = FakeWebSocket.OPEN;
        this.dispatch("open");
      });
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    dispatch(type, event = {}) {
      this[`on${type}`]?.(event);
      for (const listener of this.listeners.get(type) || []) listener(event);
    }

    send(payload) {
      this.sent.push(JSON.parse(payload));
    }

    close(code = 1000, reason = "") {
      this.readyState = FakeWebSocket.CLOSED;
      this.dispatch("close", { code, reason, wasClean: code === 1000 });
    }

    receive(message) {
      this.dispatch("message", { data: JSON.stringify(message) });
    }
  }
  return { FakeWebSocket, sockets };
}

function findMessage(socket, type) {
  return socket.sent.find((message) => message.type === type);
}

function createControlSignaling(session, messages, { stop } = {}) {
  return {
    send(message) {
      messages.push(message);
      if (
        message.type === "resume-consumer" ||
        message.type === "pause-consumer"
      ) {
        queueMicrotask(() =>
          session.handle(
            message.type === "resume-consumer"
              ? "consumer-resumed"
              : "consumer-paused",
            {
              requestId: message.data.requestId,
              consumerId: message.data.consumerId,
            },
          ),
        );
      }
      return true;
    },
    ...(stop ? { stop } : {}),
  };
}

describe("NativeMediasoupSfuSession", () => {
  it("retains active Cloudflare publications for transport reconstruction", async () => {
    const forwarded = [];
    const session = new NativeMediasoupSfuSession({
      invoke: async () => undefined,
    });
    session.cloudflareSession = {
      closed: false,
      handleMessage: async (type, data) => forwarded.push([type, data]),
    };
    const publication = {
      trackName: "track-1",
      peerId: "peer-1",
      source: "screen",
    };

    await session.messageHandlers.get("cloudflare-publication-available")(
      publication,
    );

    assert.equal(
      session.pendingCloudflarePublications.get("track-1"),
      publication,
    );
    assert.deepEqual(forwarded, [
      ["cloudflare-publication-available", publication],
    ]);

    const replacement = { ...publication, trackName: "track-2" };
    await session.messageHandlers.get("cloudflare-publication-available")(
      replacement,
    );
    await session.messageHandlers.get("cloudflare-publication-available")({
      ...publication,
      closed: true,
    });
    assert.equal(
      session.pendingCloudflarePublications.get("track-2"),
      replacement,
    );
  });

  it("publishes browser-compatible media kinds for every native source", async () => {
    const calls = [];
    const session = new NativeMediasoupSfuSession({
      invoke: async (command, payload) => {
        calls.push([command, payload]);
        return { id: `producer-${payload.appData.source}` };
      },
    });
    session.closed = false;
    session.sendTransport = { id: "send-transport", handle: 21 };

    await session.addSource({ source: "audio", track: { kind: "audio" } });
    await session.addSource({ source: "camera", track: { kind: "video" } });
    await session.addSource({ source: "screen", track: { kind: "video" } });
    await session.addSource({
      source: "screen-audio",
      track: { kind: "audio" },
    });

    assert.deepEqual(
      calls.map(([, payload]) => [payload.kind, payload.appData.source]),
      [
        ["audio", "audio"],
        ["video", "camera"],
        ["video", "screen"],
        ["audio", "screen-audio"],
      ],
    );
    assert.equal(session.producers.get("camera").kind, "video");
    assert.equal(session.producers.get("screen").kind, "video");
    assert.equal(calls[0][1].appData.encodings[0].priority, "high");
    assert.equal(calls[2][1].appData.encodings[0].maxFramerate, 60);
  });

  it("passes the provider signaling URL under the provider socket contract", async () => {
    const previousWebSocket = globalThis.WebSocket;
    const harness = createSocketHarness();
    globalThis.WebSocket = harness.FakeWebSocket;
    const session = new NativeMediasoupSfuSession({
      invoke: async () => undefined,
    });
    const controlMessages = [];
    session.signaling = {
      send(message) {
        controlMessages.push(message);
        return true;
      },
    };
    session._startNegotiation = async () => undefined;

    try {
      const pending = session._handleProviderTicket({
        provider: "mediasoup",
        providerId: "sfu-singapore",
        epoch: 1,
        sourceRevision: 0,
        signalingUrl: "wss://sfu.example.com/v1/ws",
        ticket: "ticket",
      });
      await new Promise((resolve) => queueMicrotask(resolve));
      harness.sockets[0].receive({ type: "hi919" });
      await pending;
      assert.equal(harness.sockets[0].url, "wss://sfu.example.com/v1/ws");
      assert.deepEqual(controlMessages.at(-1), {
        type: "provider-ready",
        data: {
          provider: "mediasoup",
          providerId: "sfu-singapore",
          epoch: 1,
          sourceRevision: 0,
        },
      });
    } finally {
      session.providerSignaling?.close();
      globalThis.WebSocket = previousWebSocket;
    }
  });

  it("ignores provider tickets older than the current topology", async () => {
    const session = new NativeMediasoupSfuSession({
      invoke: async () => undefined,
    });
    session.topologyState = { epoch: 4, sourceRevision: 2 };

    const handled = await session._handleProviderTicket({
      provider: "mediasoup",
      epoch: 3,
      sourceRevision: 2,
      signalingUrl: "wss://sfu.example.com/v1/ws",
      ticket: "stale-ticket",
    });

    assert.equal(handled, false);
    assert.equal(session.providerSignaling, null);
  });

  it("reports a native Cloudflare activation failure to the control plane", async () => {
    const messages = [];
    const session = new NativeMediasoupSfuSession({
      invoke: async () => undefined,
    });
    session.topologyState = { epoch: 4, sourceRevision: 2 };
    session.activateProvider = async () => {
      throw new Error("native Cloudflare unavailable");
    };
    session.signaling = {
      send(message) {
        messages.push(message);
        return true;
      },
    };

    await assert.rejects(
      session._handleProviderTicket({
        provider: "cloudflare-realtime",
        providerId: "cloudflare-primary",
        epoch: 4,
        sourceRevision: 2,
      }),
      /native Cloudflare unavailable/,
    );

    assert.equal(messages[0]?.type, "provider-failure");
    assert.equal(messages[0]?.data.epoch, 4);
    assert.equal(messages[0]?.data.sourceRevision, 2);
    assert.equal(messages[0]?.data.providerId, "cloudflare-primary");
  });

  it("does not attribute a pending provider failure to the active SFU", () => {
    const session = new NativeMediasoupSfuSession({
      invoke: async () => undefined,
    });
    session.activeSfuProvider = "cloudflare-realtime";
    session.selectedProvider = "mediasoup";
    session.messageHandlers.get("provider-failure")({
      provider: "mediasoup",
      epoch: 4,
      reason: "pending-provider-failed",
    });

    assert.equal(session.mediaConnectionState, "disconnected");
    assert.equal(session.connectionPhase, "idle");
  });

  it("attaches native local video frames to the camera feed", async () => {
    const session = new NativeMediasoupSfuSession({
      invoke: async (command, payload) => {
        if (command === "media_create_capture_producer")
          return { id: `producer-${payload.source}` };
        return undefined;
      },
    });
    session.closed = false;
    session.sendTransport = { id: "send-transport", handle: 21 };

    await session.addSource({ source: "camera", track: { kind: "video" } });

    assert.equal(
      session.handleReceiveEvent({
        kind: 5,
        eventId: 12,
        id: "camera",
        payload: {
          source: "camera",
          width: 640,
          height: 360,
          pixelFormat: "rgba",
        },
        data: new Uint8Array([1, 2, 3, 4]),
      }),
      true,
    );
    assert.deepEqual(session.localVideoFeeds.get("camera").frame, {
      source: "camera",
      width: 640,
      height: 360,
      pixelFormat: "rgba",
      data: new Uint8Array([1, 2, 3, 4]),
      eventId: 12,
    });
  });

  it("recreates a native local video feed if transport state cleared its map", async () => {
    const session = new NativeMediasoupSfuSession({
      invoke: async (command, payload) => {
        if (command === "media_create_capture_producer")
          return { id: `producer-${payload.source}` };
        return undefined;
      },
    });
    session.closed = false;
    session.sendTransport = { id: "send-transport", handle: 21 };

    await session.addSource({ source: "camera", track: { kind: "video" } });
    session.localVideoFeeds.clear();

    assert.equal(
      session.handleReceiveEvent({
        kind: 5,
        eventId: 13,
        id: "camera",
        payload: {
          source: "camera",
          width: 640,
          height: 360,
          pixelFormat: "rgba",
        },
        data: new Uint8Array([1, 2, 3, 4]),
      }),
      true,
    );
    assert.equal(session.localVideoFeeds.get("camera").native, true);
    assert.equal(session.localVideoFeeds.get("camera").frame.eventId, 13);
  });

  it("uses the shared audio and screen video producer policy", async () => {
    const calls = [];
    const session = new NativeMediasoupSfuSession({
      invoke: async (command, payload) => {
        calls.push([command, payload]);
        return { id: `producer-${payload.appData.source}` };
      },
      getAudioBitrate: () => 96000,
      getAudioStereo: () => true,
      getVideoSettings: () => ({
        width: 2560,
        height: 1440,
        frameRate: 30,
        qualityPriority: "resolution",
        maxBitrate: 2400000,
      }),
    });
    session.closed = false;
    session.sendTransport = { id: "send-transport", handle: 21 };

    await session.addSource({ source: "audio", track: { kind: "audio" } });
    await session.addSource({ source: "screen", track: { kind: "video" } });

    assert.equal(calls[0][1].appData.encodings[0].maxBitrate, 96000);
    assert.equal(calls[0][1].appData.codecOptions.opusStereo, true);
    assert.equal(calls[1][1].appData.encodings[0].maxBitrate, 2400000);
    assert.equal(calls[1][1].appData.encodings[0].maxFramerate, 30);
    assert.equal(
      calls[1][1].appData.degradationPreference,
      "maintain-resolution",
    );
  });

  it("preserves explicit native capture preferences over picker defaults", async () => {
    const calls = [];
    const session = new NativeMediasoupSfuSession({
      invoke: async (command, payload) => {
        calls.push([command, payload]);
        return { id: "producer-screen" };
      },
      getVideoSettings: () => ({
        resolution: "720p",
        frameRate: 30,
        qualityPriority: "resolution",
        maxBitrate: 2400000,
      }),
    });
    session.closed = false;
    session.sendTransport = { id: "send-transport", handle: 21 };

    await session.addSource({
      source: "screen",
      track: { kind: "video" },
      captureSelection: {
        bounds: { width: 2560, height: 1440 },
        video: { resolution: "original", frameRate: 60 },
      },
    });

    assert.equal(calls[0][1].appData.encodings[0].maxFramerate, 30);
    assert.equal(calls[0][1].appData.encodings[0].scaleResolutionDownBy, 1);
    assert.equal(
      calls[0][1].appData.degradationPreference,
      "maintain-resolution",
    );
  });

  it("negotiates the native device and both transports without browser WebRTC", async () => {
    const previousWebSocket = globalThis.WebSocket;
    const harness = createSocketHarness();
    globalThis.WebSocket = harness.FakeWebSocket;
    const calls = [];
    const session = new NativeMediasoupSfuSession({
      invoke: async (command, payload) => {
        calls.push([command, payload]);
        if (command === "media_create_device")
          return { handle: 11, rtpCapabilities: { codecs: [] } };
        if (command === "media_create_send_transport") return { handle: 21 };
        if (command === "media_create_recv_transport") return { handle: 22 };
        return undefined;
      },
      buildUrl: () => "ws://example.test/socket?channelId=channel-native",
    });

    try {
      const connecting = session.connect("channel-native");
      await new Promise((resolve) => setImmediate(resolve));
      const socket = harness.sockets[0];
      socket.receive({ type: "hi919", data: serverHello });
      await new Promise((resolve) => setImmediate(resolve));
      socket.receive({
        type: "connected",
        data: { peerId: "peer-native", userId: "user-native" },
      });
      await new Promise((resolve) => setImmediate(resolve));
      const capabilityRequest = findMessage(socket, "get-rtp-capabilities");
      assert.ok(capabilityRequest);
      socket.receive({
        type: "rtp-capabilities",
        data: { requestId: capabilityRequest.data.requestId, codecs: [] },
      });
      await new Promise((resolve) => setImmediate(resolve));
      const transportRequests = socket.sent.filter(
        (message) => message.type === "create-transport",
      );
      assert.equal(transportRequests.length, 2);
      for (const request of transportRequests) {
        socket.receive({
          type: "transport-params",
          data: {
            requestId: request.data.requestId,
            direction: request.data.type,
            id: `${request.data.type}-transport`,
            iceParameters: {},
            iceCandidates: [],
            dtlsParameters: {},
          },
        });
      }
      await connecting;

      assert.equal(session.connected, true);
      assert.equal(session.joinReady, true);
      assert.equal(session.sendTransport.id, "send-transport");
      assert.equal(session.recvTransport.id, "recv-transport");
      assert.deepEqual(
        calls.map(([command]) => command),
        [
          "media_create_device",
          "media_create_send_transport",
          "media_create_recv_transport",
        ],
      );
      assert.equal(
        findMessage(socket, "client-rtp-capabilities").type,
        "client-rtp-capabilities",
      );
    } finally {
      await session.disconnect();
      globalThis.WebSocket = previousWebSocket;
    }
  });

  it("hydrates membership from the native connected handshake", async () => {
    const members = [];
    const session = new NativeMediasoupSfuSession({
      invoke: async () => undefined,
      onCurrentlyInChannel: (data) => members.push(data),
    });
    session.signaling = { markReady() {}, send: () => true };
    session._startNegotiation = async () => undefined;

    await session.handle("connected", {
      peerId: "peer-native",
      inRoom: ["user-native", "user-browser"],
      profiles: [{ id: "user-browser", name: "Browser User" }],
      participantStates: [
        {
          userId: "user-browser",
          muted: false,
          deafened: false,
          cameraEnabled: false,
          screenSharing: false,
        },
      ],
    });

    assert.deepEqual(members, [
      {
        peerId: "peer-native",
        inRoom: ["user-native", "user-browser"],
        profiles: [{ id: "user-browser", name: "Browser User" }],
        participantStates: [
          {
            userId: "user-browser",
            muted: false,
            deafened: false,
            cameraEnabled: false,
            screenSharing: false,
          },
        ],
      },
    ]);
    await session.disconnect();
  });

  it("keeps native media alive across transient signaling loss", async () => {
    let releaseTeardown;
    const teardown = new Promise((resolve) => {
      releaseTeardown = resolve;
    });
    const calls = [];
    const sent = [];
    const session = new NativeMediasoupSfuSession({
      invoke: async (command) => {
        calls.push(command);
        if (command === "media_leave") await teardown;
        return undefined;
      },
    });
    session.signaling = {
      send(message) {
        sent.push(message);
        return true;
      },
    };

    session._handleSignalingClose({ code: 1006, reason: "connection lost" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, []);
    assert.equal(session.mediaConnectionState, "recovering");

    const negotiation = session._startNegotiation();
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(findMessage({ sent }, "get-rtp-capabilities"));

    releaseTeardown();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(findMessage({ sent }, "get-rtp-capabilities"));
    session.readyReject?.(new Error("test complete"));
    await negotiation.catch(() => undefined);
  });

  it("stops native P2P before protocol teardown leaves native media", async () => {
    const order = [];
    const session = new NativeMediasoupSfuSession({
      invoke: async (command) => {
        order.push(command);
      },
      onBeforeNativeTeardown: async () => {
        order.push("p2p-shutdown");
      },
    });

    session._handleSignalingClose({
      code: MEDIA_SIGNALING_CLIENT_PROTOCOL.closeCode,
      reason: "upgrade required",
    });
    await session.nativeTeardownPromise;

    assert.deepEqual(order, ["p2p-shutdown", "media_leave"]);
  });

  it("acknowledges signaling heartbeats without restarting the native SFU", async () => {
    const acknowledgements = [];
    const topologyStates = [];
    const session = new NativeMediasoupSfuSession({
      invoke: async () => undefined,
      onStateChange: (state) => topologyStates.push(state.topologyState),
    });
    session.closed = false;
    session.signaling = {
      acknowledgeHeartbeat(sequence, acknowledgedAt) {
        acknowledgements.push([sequence, acknowledgedAt]);
      },
    };

    assert.equal(await session.handle("heartbeat-ack", { sequence: 4 }), true);
    assert.equal(
      await session.handle("heartbeat-nack", {
        sequence: 5,
        topology: { mode: "sfu", epoch: 2 },
      }),
      true,
    );
    assert.equal(acknowledgements.length, 2);
    assert.deepEqual(
      acknowledgements.map(([sequence]) => sequence),
      [4, 5],
    );
    assert.deepEqual(topologyStates.at(-1), {
      mode: "sfu",
      epoch: 2,
      localPeerId: "",
    });
  });

  it("correlates native connect and produce actions with signaling acknowledgements", async () => {
    const harness = createSocketHarness();
    const previousWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = harness.FakeWebSocket;
    const calls = [];
    const session = new NativeMediasoupSfuSession({
      invoke: async (command, payload) => {
        calls.push([command, payload]);
        return undefined;
      },
    });
    session.connected = true;
    session.closed = false;
    session.sendTransport = { id: "send-transport", handle: 21 };
    session.recvTransport = { id: "recv-transport", handle: 22 };
    session.transportPointers.set(301, "send");
    session.transportPointers.set(302, "recv");
    const socket = {
      sent: [],
      send(payload) {
        this.sent.push(JSON.parse(payload));
      },
    };
    session.signaling = {
      send: (message) => (socket.sent.push(message), true),
    };

    try {
      const connecting = session.handleNativeAction({
        kind: 1,
        transportPtr: 301,
        actionId: 4,
        params: { id: "dtls", fingerprints: [] },
      });
      await new Promise((resolve) => setImmediate(resolve));
      const connect = findMessage(socket, "connect-transport");
      assert.equal(connect.data.transportId, "send-transport");
      await session.handle("transport-connected", {
        requestId: connect.data.requestId,
        transportId: "send-transport",
      });
      await connecting;

      const producing = session.handleNativeAction({
        kind: 2,
        transportPtr: 301,
        actionId: 77,
        params: {
          kind: "audio",
          rtpParameters: { codecs: [] },
          appData: { source: "audio" },
        },
      });
      await new Promise((resolve) => setImmediate(resolve));
      const produce = findMessage(socket, "produce");
      assert.equal(produce.data.kind, "audio");
      await session.handle("producer-id", {
        requestId: produce.data.requestId,
        id: "producer-native",
      });
      await producing;

      assert.deepEqual(calls, [
        ["media_complete_connect", { transportPtr: 301 }],
        [
          "media_complete_produce",
          { actionId: 77, producerId: "producer-native" },
        ],
      ]);
    } finally {
      await session.disconnect();
      globalThis.WebSocket = previousWebSocket;
    }
  });

  it("handles native consumer lifecycle actions from the ABI", async () => {
    const calls = [];
    const session = new NativeMediasoupSfuSession({
      invoke: async (command, payload) => {
        calls.push([command, payload]);
      },
    });
    session.closed = false;
    const entry = {
      consumerId: "consumer-native",
      producerId: "producer-remote",
      key: "remote:user-remote:camera",
      userId: "user-remote",
      source: "camera",
      kind: "video",
      closed: false,
    };
    session.consumers.set(entry.consumerId, entry);
    session.remoteVideoFeeds.set(entry.key, entry);

    await session.handleNativeAction({
      kind: 4,
      params: {
        event: "consumer-closed",
        consumerId: entry.consumerId,
        producerId: entry.producerId,
      },
    });

    assert.equal(session.consumers.has(entry.consumerId), false);
    assert.deepEqual(calls, [
      ["media_close_consumer", { consumerId: entry.consumerId }],
    ]);
  });

  it("applies native transport state actions after JSON decoding", async () => {
    const session = new NativeMediasoupSfuSession({
      invoke: async () => undefined,
    });
    session.closed = false;
    session.transportPointers.set(22, "recv");

    await session.handleNativeAction({
      kind: 0,
      transportPtr: 22,
      state: JSON.stringify("connected"),
    });

    assert.equal(session.transportStates.get("recv"), "connected");
    assert.equal(session.mediaConnectionState, "transport-connecting");
  });

  it("does not report native media readiness before required transports connect", () => {
    const session = new NativeMediasoupSfuSession({
      invoke: async () => undefined,
    });
    session.connected = true;
    session.closed = false;
    session.sendTransport = { id: "send" };
    session.recvTransport = { id: "recv" };
    session.sources.set("audio", {});
    session.consumers.set("remote-audio", {});

    assert.equal(session.connectionState().ready, false);
    assert.equal(session.joinReady, false);

    session.transportStates.set("send", "connected");
    session.transportStates.set("recv", "connected");

    assert.equal(session.connectionState().ready, true);
    assert.equal(session.joinReady, true);
  });

  it("correlates receive frames and closes the exact native consumer", async () => {
    const calls = [];
    const ended = [];
    const session = new NativeMediasoupSfuSession({
      invoke: async (command, payload) => {
        calls.push([command, payload]);
        if (command === "media_consume")
          return {
            id: "consumer-native",
            producerId: "producer-remote",
            kind: "video",
          };
        return undefined;
      },
      onRemoteTrackEnded: (entry) => ended.push(entry.consumerId),
    });
    session.connected = true;
    session.closed = false;
    session.recvTransport = { id: "recv-transport", handle: 22 };
    session.signaling = createControlSignaling(session, []);

    await session.handle("consumer-params", {
      id: "consumer-native",
      producerId: "producer-remote",
      kind: "video",
      rtpParameters: { codecs: [] },
      userId: "user-remote",
      source: "camera",
    });
    const entry = session.consumers.get("consumer-native");
    assert.equal(entry.key, "remote:user-remote:camera");
    assert.equal(session.remoteVideoFeeds.has(entry.key), true);

    assert.equal(
      session.handleReceiveEvent({
        kind: 2,
        eventId: 9,
        id: "consumer-native",
        payload: {
          width: 2,
          height: 1,
        },
        data: "AQIDBA==",
      }),
      true,
    );
    assert.equal(
      session.remoteVideoFeeds.get(entry.key).frame.data,
      "AQIDBA==",
    );
    assert.equal(
      session.handleReceiveEvent({
        kind: 2,
        eventId: 10,
        id: "consumer-native",
        payload: {
          consumerId: "consumer-native",
          producerId: "stale-producer",
          kind: "video",
        },
        data: "BQYH",
      }),
      false,
    );

    assert.equal(
      session.handleReceiveEvent({
        kind: 3,
        eventId: 11,
        id: "consumer-native",
        payload: {
          consumerId: "consumer-native",
          producerId: "producer-remote",
          kind: "video",
        },
      }),
      true,
    );
    assert.equal(session.consumers.has("consumer-native"), false);
    assert.equal(session.remoteVideoFeeds.has(entry.key), false);
    assert.deepEqual(ended, ["consumer-native"]);
    assert.deepEqual(calls.at(-1), [
      "media_close_consumer",
      { consumerId: "consumer-native" },
    ]);
    assert.equal(
      session.handleReceiveEvent({
        kind: 2,
        eventId: 12,
        id: "consumer-native",
        payload: {
          consumerId: "consumer-native",
          producerId: "producer-remote",
          kind: "video",
        },
        data: "CAkK",
      }),
      false,
    );
  });

  it("routes native consumer controls to the decoded consumer", async () => {
    const calls = [];
    const messages = [];
    const session = new NativeMediasoupSfuSession({
      invoke: async (command, payload) => {
        calls.push([command, payload]);
        if (command === "media_consume")
          return {
            id: "consumer-native",
            producerId: "producer-remote",
            kind: "audio",
          };
        return undefined;
      },
    });
    session.connected = true;
    session.closed = false;
    session.recvTransport = { id: "recv-transport", handle: 22 };
    session.signaling = createControlSignaling(session, messages);

    await session.handle("consumer-params", {
      id: "consumer-native",
      producerId: "producer-remote",
      kind: "audio",
      rtpParameters: { codecs: [] },
      userId: "user-remote",
      source: "audio",
    });
    const entry = session.consumers.get("consumer-native");
    assert.equal(entry.receiving, true);
    await session.setConsumerVolume("user-remote", "audio", 0.4);

    assert.deepEqual(calls.slice(1), [
      [
        "media_set_consumer_enabled",
        { consumerId: "consumer-native", enabled: true },
      ],
      [
        "media_set_consumer_jitter_buffer",
        {
          consumerId: "consumer-native",
          minDelayMs: 0,
          targetDelayMs: 20,
        },
      ],
      [
        "media_set_consumer_volume",
        { consumerId: "consumer-native", volume: 0.4 },
      ],
    ]);
  });

  it("creates, pauses, resumes, closes consumers, and tears down on disconnect", async () => {
    const calls = [];
    const messages = [];
    const session = new NativeMediasoupSfuSession({
      invoke: async (command, payload) => {
        calls.push([command, payload]);
        if (command === "media_consume")
          return {
            id: "consumer-native",
            producerId: "producer-remote",
            kind: "audio",
          };
        return undefined;
      },
    });
    session.connected = true;
    session.closed = false;
    session.recvTransport = { id: "recv-transport", handle: 22 };
    session.transportPointers.set(302, "recv");
    session.signaling = createControlSignaling(session, messages, {
      stop() {},
    });

    await session.handle("consumer-params", {
      requestId: "consume-1",
      id: "consumer-native",
      producerId: "producer-remote",
      kind: "audio",
      rtpParameters: { codecs: [] },
      userId: "user-remote",
      source: "audio",
    });
    assert.equal(session.consumers.get("consumer-native").receiving, true);

    const pause = session.setConsumerReceiving(
      session.consumers.get("consumer-native"),
      false,
    );
    await pause;
    assert.equal(session.consumers.get("consumer-native").receiving, false);

    const resume = session.setConsumerReceiving(
      session.consumers.get("consumer-native"),
      true,
    );
    await resume;
    assert.equal(session.consumers.get("consumer-native").receiving, true);

    await session.handle("producer-closed", { producerId: "producer-remote" });
    assert.equal(session.consumers.has("consumer-native"), false);
    await session.disconnect();
    assert.ok(calls.some(([command]) => command === "media_leave"));
  });

  it("replaces a live native producer track without recreating the producer", async () => {
    const calls = [];
    const session = new NativeMediasoupSfuSession({
      invoke: async (command, payload) => {
        calls.push([command, payload]);
        if (command === "media_create_capture_producer")
          return { id: "producer-camera" };
        return undefined;
      },
    });
    session.closed = false;
    session.sendTransport = { id: "send-transport" };

    await session.addSource({
      source: "camera",
      track: { kind: "video" },
      videoSettings: { width: 640, height: 360 },
    });
    const producer = await session.addSource({
      source: "camera",
      track: { kind: "video" },
      videoSettings: { width: 1280, height: 720 },
    });

    assert.equal(producer.id, "producer-camera");
    assert.deepEqual(
      calls.map(([command]) => command),
      ["media_create_capture_producer", "media_replace_producer_track"],
    );
    assert.equal(session.sources.get("camera").videoSettings.width, 1280);
  });

  it("deduplicates concurrent native source publication", async () => {
    let resolveProducer;
    let creates = 0;
    const session = new NativeMediasoupSfuSession({
      invoke: async (command) => {
        if (command !== "media_create_capture_producer") return undefined;
        creates += 1;
        return new Promise((resolve) => {
          resolveProducer = () => resolve({ id: "producer-audio" });
        });
      },
    });
    session.closed = false;
    session.sendTransport = { id: "send-transport" };
    const entry = { source: "audio", track: { kind: "audio" } };

    const first = session.publish(entry);
    const second = session.publish(entry);
    await Promise.resolve();
    resolveProducer();

    assert.equal((await first).id, "producer-audio");
    assert.equal((await second).id, "producer-audio");
    assert.equal(creates, 1);
  });

  it("restarts a native transport with correlated server ICE parameters", async () => {
    const calls = [];
    const messages = [];
    const session = new NativeMediasoupSfuSession({
      invoke: async (command, payload) => {
        calls.push([command, payload]);
        return undefined;
      },
      recoveryTimeoutMs: 100,
    });
    session.closed = false;
    session.sendTransport = { id: "send-transport", handle: 21 };
    session.transportStates.set("send", "disconnected");
    session.signaling = {
      send(message) {
        messages.push(message);
        return true;
      },
    };

    const first = session.restartTransportIce("send");
    const second = session.restartTransportIce("send");
    await new Promise((resolve) => setImmediate(resolve));
    const request = messages.find((message) => message.type === "restart-ice");
    assert.ok(request);
    await session.handle("ice-restarted", {
      requestId: request.data.requestId,
      iceParameters: { usernameFragment: "next", password: "secret" },
    });
    await Promise.all([first, second]);

    assert.deepEqual(calls, [
      [
        "media_restart_send_transport_ice",
        {
          iceParameters: {
            usernameFragment: "next",
            password: "secret",
          },
        },
      ],
    ]);
    session._closeMedia(false);
  });

  it("retries a failed native consumer request without failing the session", async () => {
    const messages = [];
    const session = new NativeMediasoupSfuSession({
      consumerRetryDelayMs: 0,
      invoke: async () => undefined,
    });
    session.closed = false;
    session.recvTransport = { id: "recv-transport" };
    session.device = {};
    session.signaling = {
      send(message) {
        messages.push(message);
        return true;
      },
    };

    session.requestConsumer("producer-remote");
    const first = messages.at(-1);
    await session.handle("error", {
      requestType: "consume",
      requestId: first.data.requestId,
      producerId: "producer-remote",
      message: "producer is not ready",
    });
    await new Promise((resolve) => setTimeout(resolve, 5));

    const consumeRequests = messages.filter(
      (message) => message.type === "consume",
    );
    assert.equal(consumeRequests.length, 2);
    assert.equal(session.error, null);
    session._closeMedia(false);
  });

  it("reports native transport stats and requires increasing RTP bytes", async () => {
    let timestamp = 1000;
    let outboundBytes = 100;
    let inboundBytes = 200;
    const session = new NativeMediasoupSfuSession({
      invoke: async (command) => {
        if (command === "media_get_transport_stats")
          return {
            stats: [
              {
                type: "candidate-pair",
                state: "succeeded",
                currentRoundTripTime: 0.05,
              },
            ],
          };
        if (command === "media_get_producer_stats")
          return {
            stats: [
              {
                type: "outbound-rtp",
                bytesSent: outboundBytes,
                timestamp,
              },
            ],
          };
        if (command === "media_get_consumer_stats")
          return {
            stats: [
              {
                type: "inbound-rtp",
                bytesReceived: inboundBytes,
                timestamp,
              },
            ],
          };
        return undefined;
      },
    });
    session.connected = true;
    session.closed = false;
    session.sendTransport = { id: "send-transport" };
    session.recvTransport = { id: "recv-transport" };
    session.transportStates.set("send", "connected");
    session.transportStates.set("recv", "connected");
    session.sources.set("audio", { source: "audio", kind: "audio" });
    session.producers.set("audio", {
      id: "producer-audio",
      source: "audio",
      kind: "audio",
    });
    session.consumers.set("consumer-audio", {
      consumerId: "consumer-audio",
      userId: "user-remote",
      source: "audio",
      receiving: true,
    });

    const transports = await session.stats();
    assert.equal(transports[0].rttMs, 50);
    assert.equal((await session.mediaReadiness(1)).ready, false);
    outboundBytes += 10;
    inboundBytes += 10;
    timestamp += 100;
    assert.equal((await session.mediaReadiness(1)).ready, true);
    session._closeMedia(false);
  });
});
