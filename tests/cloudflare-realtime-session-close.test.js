import assert from "node:assert/strict";
import test from "node:test";
import { CloudflareRealtimeSession } from "../app/shared/cloudflare-realtime-session.js";

class FakePeerConnection {
  constructor() {
    this.connectionState = "new";
  }

  addEventListener() {}

  close() {
    this.connectionState = "closed";
  }
}

class EmptyEncodingPeerConnection extends FakePeerConnection {
  constructor() {
    super();
    this.localDescription = null;
    this.sender = {
      id: "audio-sender",
      getParameters: () => ({ encodings: [] }),
      setParameters: async (parameters) => {
        this.parameters = parameters;
      },
    };
  }

  addTrack() {
    return this.sender;
  }

  getTransceivers() {
    return [{ sender: this.sender, mid: "audio-mid" }];
  }

  async createOffer() {
    return { type: "offer", sdp: "offer" };
  }

  async setLocalDescription(description) {
    this.localDescription = description;
  }
}

test("Cloudflare session closure marks pending requests as cancellation", async () => {
  const client = new CloudflareRealtimeSession({
    send: () => true,
    iceServers: [],
  });
  const request = client.request("tracks-close");

  client.closeMedia();

  await assert.rejects(
    request,
    (error) =>
      error?.code === "MEDIA_SESSION_CLOSED" &&
      error.message === "Cloudflare session closed",
  );
});

test("Cloudflare source removal reports session cancellation after teardown", async () => {
  const client = new CloudflareRealtimeSession({
    send: () => true,
    iceServers: [],
  });
  client.producers.set("audio", {
    mid: "audio-mid",
    sender: {},
  });

  await assert.rejects(
    client.removeSource("audio"),
    (error) =>
      error?.code === "MEDIA_SESSION_CLOSED" &&
      error.message === "Cloudflare session closed",
  );
});

test("Cloudflare audio publication normalizes an empty encoding list", async () => {
  let client;
  client = new CloudflareRealtimeSession({
    send(message) {
      queueMicrotask(() =>
        client.handle("cloudflare-response", {
          requestId: message.data.requestId,
          result: {},
        }),
      );
      return true;
    },
    iceServers: [],
  });
  client.peerConnection = new EmptyEncodingPeerConnection();
  client.sessionId = "cloudflare-session";
  client.initializing = Promise.resolve();

  await client.addSource({
    source: "audio",
    track: { kind: "audio" },
    stream: {},
  });

  assert.equal(client.peerConnection.parameters.encodings.length, 1);
  assert.equal(client.peerConnection.parameters.encodings[0].maxBitrate, 96000);
  client.closeMedia();
});

test("Cloudflare initialization can retry after a failed request", async () => {
  const previousPeerConnection = globalThis.RTCPeerConnection;
  const requests = [];
  let attempt = 0;
  let client;
  globalThis.RTCPeerConnection = FakePeerConnection;
  client = new CloudflareRealtimeSession({
    send(message) {
      requests.push(message);
      const request = message.data;
      queueMicrotask(() =>
        client.handle("cloudflare-response", {
          requestId: request.requestId,
          ...(attempt++ === 0
            ? { error: "Cloudflare unavailable" }
            : { result: { sessionId: "retry-session" } }),
        }),
      );
      return true;
    },
    iceServers: [],
  });

  try {
    await assert.rejects(client.initialize(), /Cloudflare unavailable/);
    assert.equal(client.initializing, null);
    await client.initialize();
    assert.equal(client.sessionId, "retry-session");
    assert.equal(
      requests.filter((message) => message.data.operation === "new-session")
        .length,
      2,
    );
  } finally {
    client.closeMedia();
    globalThis.RTCPeerConnection = previousPeerConnection;
  }
});
