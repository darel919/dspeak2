import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NativeMediasoupSfuSession } from "../app/shared/native-mediasoup-session.js";

const serverHello = {
  protocolVersion: 919,
  contractRevision: 2,
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
      sockets.push(this);
      queueMicrotask(() => {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.();
      });
    }

    send(payload) {
      this.sent.push(JSON.parse(payload));
    }

    close(code = 1000, reason = "") {
      this.readyState = FakeWebSocket.CLOSED;
      this.onclose?.({ code, reason });
    }

    receive(message) {
      this.onmessage?.({ data: JSON.stringify(message) });
    }
  }
  return { FakeWebSocket, sockets };
}

function findMessage(socket, type) {
  return socket.sent.find((message) => message.type === type);
}

describe("NativeMediasoupSfuSession", () => {
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
        ["media_complete_connect", { transport_ptr: 301 }],
        [
          "media_complete_produce",
          { action_id: 77, producer_id: "producer-native" },
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
      ["media_close_consumer", { consumer_id: entry.consumerId }],
    ]);
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
    session.signaling = { send: () => true };

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
          consumerId: "consumer-native",
          producerId: "producer-remote",
          kind: "video",
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
      { consumer_id: "consumer-native" },
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
    session.signaling = {
      send: (message) => (messages.push(message), true),
    };

    await session.handle("consumer-params", {
      id: "consumer-native",
      producerId: "producer-remote",
      kind: "audio",
      rtpParameters: { codecs: [] },
      userId: "user-remote",
      source: "audio",
    });
    const entry = session.consumers.get("consumer-native");
    const resume = session.setConsumerReceiving(entry, true);
    await new Promise((resolve) => setImmediate(resolve));
    await session.handle("consumer-resumed", {
      requestId: messages.at(-1).data.requestId,
      consumerId: entry.consumerId,
    });
    await resume;
    await session.setConsumerVolume("user-remote", "audio", 0.4);

    assert.deepEqual(calls.slice(1), [
      [
        "media_set_consumer_enabled",
        { consumer_id: "consumer-native", enabled: true },
      ],
      [
        "media_set_consumer_volume",
        { consumer_id: "consumer-native", volume: 0.4 },
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
    session.signaling = {
      send: (message) => (messages.push(message), true),
      stop() {},
    };

    await session.handle("consumer-params", {
      requestId: "consume-1",
      id: "consumer-native",
      producerId: "producer-remote",
      kind: "audio",
      rtpParameters: { codecs: [] },
      userId: "user-remote",
      source: "audio",
    });
    assert.equal(session.consumers.get("consumer-native").receiving, false);

    const resume = session.setConsumerReceiving(
      session.consumers.get("consumer-native"),
      true,
    );
    await new Promise((resolve) => setImmediate(resolve));
    const resumeMessage = messages.at(-1);
    await session.handle("consumer-resumed", {
      requestId: resumeMessage.data.requestId,
      consumerId: "consumer-native",
    });
    await resume;
    assert.equal(session.consumers.get("consumer-native").receiving, true);

    await session.handle("producer-closed", { producerId: "producer-remote" });
    assert.equal(session.consumers.has("consumer-native"), false);
    await session.disconnect();
    assert.ok(calls.some(([command]) => command === "media_leave"));
  });
});
