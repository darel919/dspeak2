import assert from "node:assert/strict";
import test from "node:test";
import { MediasoupProviderSocket } from "../app/shared/mediasoup-provider-socket.ts";

class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor() {
    this.readyState = FakeWebSocket.CONNECTING;
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }

  send() {}

  close(code, reason) {
    this.readyState = FakeWebSocket.CLOSED;
    this.closeRequest = { code, reason };
    this.emit("close", { wasClean: code === 1000, code, reason });
  }
}

test("provider message handler failures reach onFailure without an unhandled rejection", async () => {
  const previousWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket;
  const failures = [];
  try {
    const provider = new MediasoupProviderSocket({
      onMessage: async () => {
        throw new Error("consumer negotiation failed");
      },
      onFailure: async (error) => {
        failures.push(error);
        throw new Error("failure observer failed");
      },
    });
    const opening = provider.connect({
      signalingUrl: "wss://provider.example",
      ticket: "ticket",
    });
    const socket = provider.socket;
    socket.readyState = FakeWebSocket.OPEN;
    socket.emit("message", { data: JSON.stringify({ type: "hi919" }) });
    await opening;
    socket.emit("message", {
      data: JSON.stringify({ type: "consumer-params", data: {} }),
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(failures.length, 1);
    assert.match(failures[0].message, /consumer negotiation failed/);
    assert.deepEqual(socket.closeRequest, {
      code: 1011,
      reason: "Provider message handling failed",
    });
  } finally {
    globalThis.WebSocket = previousWebSocket;
  }
});

test("provider handshake send failures reject the connection safely", async () => {
  const previousWebSocket = globalThis.WebSocket;
  class ThrowingWebSocket extends FakeWebSocket {
    send() {
      throw new Error("socket send failed");
    }
  }
  globalThis.WebSocket = ThrowingWebSocket;
  const failures = [];
  try {
    const provider = new MediasoupProviderSocket({
      onMessage: () => {},
      onFailure: (error) => failures.push(error),
    });
    const opening = provider.connect({
      signalingUrl: "wss://provider.example",
      ticket: "ticket",
    });
    const socket = provider.socket;
    socket.readyState = FakeWebSocket.OPEN;
    socket.emit("open");

    await assert.rejects(opening, /socket send failed/);
    assert.equal(failures.length, 1);
  } finally {
    globalThis.WebSocket = previousWebSocket;
  }
});

test("provider clean closes before the handshake reject the connection", async () => {
  const previousWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket;
  const failures = [];
  try {
    const provider = new MediasoupProviderSocket({
      onMessage: () => {},
      onFailure: (error) => failures.push(error),
    });
    const opening = provider.connect({
      signalingUrl: "wss://provider.example",
      ticket: "ticket",
    });
    const socket = provider.socket;
    socket.close(1000, "provider closed");

    await assert.rejects(opening, /provider closed/);
    assert.equal(failures.length, 1);
  } finally {
    globalThis.WebSocket = previousWebSocket;
  }
});

test("provider error responses are offered to the request handler before escalation", async () => {
  const previousWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket;
  const failures = [];
  const messages = [];
  try {
    const provider = new MediasoupProviderSocket({
      onMessage: async (type, data) => {
        messages.push([type, data]);
        return true;
      },
      onFailure: (error) => failures.push(error),
    });
    const opening = provider.connect({
      signalingUrl: "wss://provider.example",
      ticket: "ticket",
    });
    const socket = provider.socket;
    socket.readyState = FakeWebSocket.OPEN;
    socket.emit("message", { data: JSON.stringify({ type: "hi919" }) });
    await opening;
    socket.emit("message", {
      data: JSON.stringify({
        type: "error919",
        error: "Transport not found",
        requestId: "connect-1",
        data: {
          message: "Transport not found",
          requestId: "connect-1",
          requestType: "connect-transport",
          transportId: "transport-1",
        },
      }),
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(messages, [
      [
        "error",
        {
          message: "Transport not found",
          requestId: "connect-1",
          requestType: "connect-transport",
          transportId: "transport-1",
        },
      ],
    ]);
    assert.equal(failures.length, 0);
  } finally {
    globalThis.WebSocket = previousWebSocket;
  }
});
