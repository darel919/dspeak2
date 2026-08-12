import assert from "node:assert/strict";
import test from "node:test";
import {
  closeMediaSignalingForRecovery,
  createMediaSignalingSocket,
  mediaSignalingUrl,
} from "../app/shared/media-signaling-socket.ts";
import { MEDIA_SIGNALING_CLIENT_PROTOCOL } from "../shared/media-signaling-protocol.ts";

class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances = [];
  static constructionError = null;

  constructor(url) {
    if (FakeWebSocket.constructionError) throw FakeWebSocket.constructionError;
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

function resetFakeWebSocket() {
  FakeWebSocket.instances = [];
  FakeWebSocket.constructionError = null;
}

test("media signaling URL preserves the configured endpoint and channel", () => {
  assert.equal(
    mediaSignalingUrl("/socket", "room & one", {
      protocol: "https:",
      host: "voice.example",
    }),
    "/socket?channelId=room%20%26%20one",
  );
});

test("media signaling URL carries a desktop access token without dropping endpoint parameters", () => {
  assert.equal(
    mediaSignalingUrl(
      "wss://voice.example/socket?region=one",
      "room one",
      { protocol: "https:", host: "voice.example" },
      "desktop token",
    ),
    "wss://voice.example/socket?region=one&channelId=room+one&accessToken=desktop+token",
  );
});

test("media signaling recovery closes the poisoned socket", () => {
  const socket = new FakeWebSocket("wss://example.test/socket");
  closeMediaSignalingForRecovery(socket);
  assert.deepEqual(socket.closeRequest, {
    code: 4000,
    reason: "Media signaling session recovery required",
  });
});

test("media signaling connection attempts are single-flight", async () => {
  const originalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket;
  resetFakeWebSocket();
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

test("media signaling includes a control ticket in the hello payload", async () => {
  const originalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket;
  resetFakeWebSocket();
  try {
    const signaling = harness({
      buildClientHelloData: ({ mediaSessionId }) => ({
        mediaSessionId,
        ticket: "control-ticket",
      }),
    });
    const opening = signaling.open();
    const candidate = FakeWebSocket.instances[0];
    candidate.readyState = FakeWebSocket.OPEN;

    assert.equal(
      signaling.acceptServerHello({
        protocolVersion: 919,
        contractRevision: 3,
        mediaSessionId: "session-1",
        heartbeatIntervalMs: 30000,
        heartbeatTimeoutMs: 90000,
        serverTime: Date.now(),
      }),
      true,
    );

    assert.deepEqual(JSON.parse(candidate.lastMessage), {
      type: "hello919",
      data: {
        mediaSessionId: "session-1",
        ticket: "control-ticket",
        protocolVersion: 919,
        contractRevision: 3,
      },
    });
    candidate.onclose({ code: 4000, reason: "test" });
    await assert.rejects(opening, /connection closed/);
    signaling.stop();
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

test("media signaling errors close through the owned socket lifecycle", async () => {
  const originalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket;
  resetFakeWebSocket();
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
  resetFakeWebSocket();
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
  resetFakeWebSocket();
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

test("a signaling send while the socket is not writable closes the candidate", async () => {
  const originalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket;
  resetFakeWebSocket();
  try {
    const signaling = harness();
    const opening = signaling.open();
    const candidate = FakeWebSocket.instances[0];

    assert.equal(signaling.send({ type: "heartbeat" }), false);
    assert.deepEqual(candidate.closeRequest, {
      code: 4000,
      reason: "Media signaling socket is not writable",
    });
    candidate.onclose(candidate.closeRequest);
    await assert.rejects(opening, /connection closed/);
    signaling.stop();
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

test("a successful manual reopen cancels the stale automatic retry", async () => {
  const originalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket;
  resetFakeWebSocket();
  let reconnects = 0;
  try {
    const signaling = harness({
      onReconnect: () => {
        reconnects += 1;
      },
      reconnectBaseDelayMs: 1,
      reconnectJitterMs: 0,
      reconnectMaxDelayMs: 1,
    });
    const firstOpening = signaling.open();
    const first = FakeWebSocket.instances[0];
    first.onclose({ code: 4000, reason: "network changed" });
    await assert.rejects(firstOpening, /connection closed/);

    const secondOpening = signaling.open();
    const second = FakeWebSocket.instances[1];
    second.readyState = FakeWebSocket.OPEN;
    assert.equal(signaling.markReady(), true);
    await secondOpening;
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(reconnects, 0);
    assert.equal(FakeWebSocket.instances.length, 2);
    signaling.stop();
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

test("a connection timeout schedules recovery even without a close event", async () => {
  const originalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket;
  resetFakeWebSocket();
  let intentionalClose = false;
  let reconnects = 0;
  try {
    const signaling = harness({
      connectionTimeoutMs: 2,
      isIntentionalClose: () => intentionalClose,
      onReconnect: () => {
        reconnects += 1;
      },
      reconnectBaseDelayMs: 1,
      reconnectJitterMs: 0,
      reconnectMaxDelayMs: 1,
    });

    await assert.rejects(signaling.open(), /connection timed out/);
    await new Promise((resolve) => setTimeout(resolve, 8));

    assert.ok(reconnects >= 1);
    assert.ok(FakeWebSocket.instances.length >= 2);
    intentionalClose = true;
    signaling.stop();
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

test("a synchronous WebSocket construction failure schedules recovery", async () => {
  const originalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket;
  resetFakeWebSocket();
  let intentionalClose = false;
  let reconnects = 0;
  try {
    FakeWebSocket.constructionError = new Error("browser socket unavailable");
    const signaling = harness({
      isIntentionalClose: () => intentionalClose,
      onReconnect: () => {
        reconnects += 1;
      },
      reconnectBaseDelayMs: 1,
      reconnectJitterMs: 0,
      reconnectMaxDelayMs: 1,
    });

    await assert.rejects(signaling.open(), /browser socket unavailable/);
    await new Promise((resolve) => setTimeout(resolve, 8));

    assert.ok(reconnects >= 1);
    intentionalClose = true;
    signaling.stop();
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

test("a reconnect callback failure does not reopen with stale credentials", async () => {
  const originalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket;
  resetFakeWebSocket();
  const errors = [];
  let intentionalClose = false;
  try {
    const signaling = harness({
      isIntentionalClose: () => intentionalClose,
      onError: (error) => errors.push(error.message),
      onReconnect: () => {
        throw new Error("UI reconnect callback failed");
      },
      reconnectBaseDelayMs: 1,
      reconnectJitterMs: 0,
      reconnectMaxDelayMs: 1,
    });
    const opening = signaling.open();
    const first = FakeWebSocket.instances[0];
    first.onclose({ code: 4000, reason: "network changed" });
    await assert.rejects(opening, /connection closed/);
    await new Promise((resolve) => setTimeout(resolve, 8));

    assert.ok(errors.includes("UI reconnect callback failed"));
    assert.equal(FakeWebSocket.instances.length, 1);
    intentionalClose = true;
    signaling.stop();
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

test("media signaling waits for asynchronous reconnect preparation", async () => {
  const originalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket;
  resetFakeWebSocket();
  const events = [];
  let intentionalClose = false;
  try {
    const signaling = harness({
      isIntentionalClose: () => intentionalClose,
      onReconnect: async () => {
        events.push("refresh-start");
        await new Promise((resolve) => setTimeout(resolve, 3));
        events.push("refresh-end");
      },
      reconnectBaseDelayMs: 1,
      reconnectJitterMs: 0,
      reconnectMaxDelayMs: 1,
    });
    const opening = signaling.open();
    FakeWebSocket.instances[0].onclose({
      code: 4000,
      reason: "network changed",
    });
    await assert.rejects(opening, /connection closed/);
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.deepEqual(events, ["refresh-start", "refresh-end"]);
    assert.equal(FakeWebSocket.instances.length, 2);
    intentionalClose = true;
    signaling.stop();
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

test("message handler failures close the socket through recovery lifecycle", async () => {
  const originalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket;
  resetFakeWebSocket();
  const errors = [];
  try {
    const signaling = harness({
      handleMessage: () => {
        throw new Error("message state corrupted");
      },
      onError: (error) => errors.push(error.message),
    });
    const opening = signaling.open();
    const candidate = FakeWebSocket.instances[0];

    candidate.onmessage({ data: "{}" });

    assert.deepEqual(errors, ["message state corrupted"]);
    assert.deepEqual(candidate.closeRequest, {
      code: 4000,
      reason: "Media signaling message handler failed",
    });
    candidate.onclose(candidate.closeRequest);
    await assert.rejects(opening, /connection closed/);
    signaling.stop();
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});
