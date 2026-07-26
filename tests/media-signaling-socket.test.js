import assert from "node:assert/strict";
import test from "node:test";
import { createMediaSignalingSocket } from "../app/shared/media-signaling-socket.js";
import { MEDIA_SIGNALING_CLIENT_PROTOCOL } from "../shared/media-signaling-protocol.js";

class FakeWebSocket {
  static OPEN = 1;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    FakeWebSocket.instances.push(this);
  }

  close(code, reason) {
    this.readyState = 3;
    this.closeRequest = { code, reason };
  }

  send(message) {
    if (this.sendError) throw this.sendError;
    this.lastMessage = message;
  }
}

function harness(options = {}) {
  return createMediaSignalingSocket({
    buildHeartbeatData: (sequence) => ({ sequence }),
    buildUrl: () => "wss://example.test/socket",
    connectionTimeoutMs: 20,
    defaultHeartbeatIntervalMs: 5000,
    defaultHeartbeatTimeoutMs: 20000,
    handleMessage() {},
    isIntentionalClose: () => false,
    onClose() {},
    onError() {},
    onOpen() {},
    onProtocolRejected() {},
    onReconnect() {},
    protocol: MEDIA_SIGNALING_CLIENT_PROTOCOL,
    ...options,
  });
}

test("media signaling connection attempts are single-flight", async () => {
  const originalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket;
  FakeWebSocket.instances = [];
  try {
    const signaling = harness();
    const first = signaling.open();
    const second = signaling.open();

    assert.equal(first, second);
    assert.equal(FakeWebSocket.instances.length, 1);
    const candidate = FakeWebSocket.instances[0];
    candidate.onclose({ code: 4000, reason: "test" });
    await assert.rejects(first, /connection closed/);
    signaling.stop();
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

test("media signaling errors close through the owned socket lifecycle", async () => {
  const originalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket;
  FakeWebSocket.instances = [];
  try {
    const signaling = harness();
    const opening = signaling.open();
    const candidate = FakeWebSocket.instances[0];

    candidate.onerror();

    assert.deepEqual(candidate.closeRequest, {
      code: 4000,
      reason: "Media signaling connection failed",
    });
    assert.equal(FakeWebSocket.instances.length, 1);
    candidate.onclose(candidate.closeRequest);
    await assert.rejects(opening, /connection closed/);
    signaling.stop();
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

test("stopping signaling rejects and closes an in-flight connection", async () => {
  const originalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket;
  FakeWebSocket.instances = [];
  try {
    const signaling = harness();
    const opening = signaling.open();
    const candidate = FakeWebSocket.instances[0];

    signaling.stop();

    await assert.rejects(opening, /connection stopped/);
    assert.deepEqual(candidate.closeRequest, {
      code: 1000,
      reason: "Media signaling stopped",
    });
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

test("a signaling send race closes the socket instead of throwing", async () => {
  const originalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket;
  FakeWebSocket.instances = [];
  try {
    const signaling = harness();
    const opening = signaling.open();
    const candidate = FakeWebSocket.instances[0];
    candidate.readyState = FakeWebSocket.OPEN;
    candidate.sendError = new Error("socket closed during send");

    assert.equal(signaling.send({ type: "heartbeat" }), false);
    assert.deepEqual(candidate.closeRequest, {
      code: 4000,
      reason: "Media signaling send failed",
    });
    candidate.onclose(candidate.closeRequest);
    await assert.rejects(opening, /connection closed/);
    signaling.stop();
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});
