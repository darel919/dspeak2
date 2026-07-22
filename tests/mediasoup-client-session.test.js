import assert from "node:assert/strict";
import test from "node:test";
import { MediasoupClientSession } from "../app/shared/mediasoup-client-session.js";

function session() {
  return new MediasoupClientSession({ send() {}, iceServers: [] });
}

function report(type, bytesField, bytes) {
  return new Map([["rtp", { type, [bytesField]: bytes }]]);
}

test("SFU readiness requires every expected inbound and outbound stream", async () => {
  const client = session();
  client.sendTransport = {};
  client.recvTransport = {};
  client.sources.set("audio", {});
  client.producers.set("audio", {
    producer: {
      getStats: async () => report("outbound-rtp", "bytesSent", 100),
    },
  });
  client.consumers.set("consumer-1", {
    consumer: {
      getStats: async () => report("inbound-rtp", "bytesReceived", 200),
    },
  });

  assert.equal((await client.mediaReadiness(1)).ready, true);
  assert.equal((await client.mediaReadiness(2)).ready, false);
});

test("server errors reject matching produce and transport requests immediately", async () => {
  const client = session();
  const produceError = new Promise((resolve) => {
    client.pendingProduce.push({
      timer: setTimeout(() => {}, 1000),
      reject: resolve,
    });
  });
  const transportError = new Promise((resolve) => {
    client.pending.set("connect:transport-1", { reject: resolve });
  });

  client.handleServerError({
    requestType: "produce",
    message: "produce rejected",
  });
  client.handleServerError({
    requestType: "connect-transport",
    transportId: "transport-1",
    message: "connect rejected",
  });

  assert.equal((await produceError).message, "produce rejected");
  assert.equal((await transportError).message, "connect rejected");
});

test("duplicate consumer requests stay deduplicated until a response or error", () => {
  const sent = [];
  const client = new MediasoupClientSession({
    send: (message) => sent.push(message),
    iceServers: [],
  });
  client.recvTransport = { id: "recv" };
  client.device = { loaded: true, rtpCapabilities: {} };

  client.requestConsumer("producer-1");
  client.requestConsumer("producer-1");
  assert.equal(sent.filter((message) => message.type === "consume").length, 1);

  client.handleServerError({
    requestType: "consume",
    producerId: "producer-1",
    message: "consume rejected",
  });
  client.requestConsumer("producer-1");
  assert.equal(sent.filter((message) => message.type === "consume").length, 2);
});

test("closing SFU media explicitly retires consumers without waiting for trackended", () => {
  const client = session();
  let consumerClosed = 0;
  let feedRetired = 0;
  client.consumers.set("consumer-1", {
    consumer: {
      close: () => {
        consumerClosed += 1;
      },
    },
    close: () => {
      feedRetired += 1;
    },
  });

  client.closeMedia();
  assert.equal(consumerClosed, 1);
  assert.equal(feedRetired, 1);
  assert.equal(client.consumers.size, 0);
});

test("remote screen video and audio consumers pause and resume together", () => {
  const sent = [];
  const client = new MediasoupClientSession({
    send: (message) => sent.push(message),
    iceServers: [],
  });
  const entries = ["screen", "screen-audio"].map((source, index) => ({
    userId: "user-1",
    source,
    track: { enabled: true },
    consumer: { id: `consumer-${index + 1}` },
  }));
  entries.forEach((entry) => client.consumers.set(entry.consumer.id, entry));

  client.setRemoteReceiving("user-1", "screen", false);
  assert.deepEqual(
    sent.map((message) => message.type),
    ["pause-consumer", "pause-consumer"],
  );
  assert.equal(
    entries.every((entry) => entry.track.enabled === false),
    true,
  );

  sent.length = 0;
  client.setRemoteReceiving("user-1", "screen", true);
  assert.deepEqual(
    sent.map((message) => message.type),
    ["resume-consumer", "resume-consumer"],
  );
  assert.equal(
    entries.every((entry) => entry.track.enabled === true),
    true,
  );
});

test("new remote screen sources remain paused until explicitly watched", () => {
  const client = session();

  assert.equal(client.shouldReceive("user-1", "screen"), false);
  assert.equal(client.shouldReceive("user-1", "screen-audio"), false);
  assert.equal(client.shouldReceive("user-1", "camera"), true);
  assert.equal(client.shouldReceive("user-1", "audio"), true);
});
