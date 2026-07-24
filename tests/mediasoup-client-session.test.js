import assert from "node:assert/strict";
import test from "node:test";
import { MediasoupClientSession } from "../app/shared/mediasoup-client-session.js";

function session() {
  return new MediasoupClientSession({ send() {}, iceServers: [] });
}

function report(type, bytesField, bytes, timestamp) {
  return new Map([["rtp", { type, [bytesField]: bytes, timestamp }]]);
}

test("SFU readiness requires every expected inbound and outbound stream", async () => {
  const client = session();
  client.sendTransport = {};
  client.recvTransport = {};
  client.transportStates.set("send", "connected");
  client.transportStates.set("recv", "connected");
  client.sources.set("audio", {});
  let outboundBytes = 100;
  let inboundBytes = 200;
  let timestamp = 1000;
  client.producers.set("audio", {
    producer: {
      id: "producer-1",
      getStats: async () =>
        report("outbound-rtp", "bytesSent", outboundBytes, timestamp),
    },
  });
  client.consumers.set("consumer-1", {
    receiving: true,
    consumer: {
      id: "consumer-1",
      getStats: async () =>
        report("inbound-rtp", "bytesReceived", inboundBytes, timestamp),
    },
  });

  assert.equal((await client.mediaReadiness(1)).ready, false);
  outboundBytes += 10;
  inboundBytes += 10;
  timestamp += 100;
  assert.equal((await client.mediaReadiness(1)).ready, true);
  timestamp += 100;
  assert.equal((await client.mediaReadiness(1)).ready, false);
  assert.equal((await client.mediaReadiness(2)).ready, false);
});

test("server errors reject only matching correlated requests", async () => {
  const client = session();
  const produceError = new Promise((resolve) =>
    client.pendingProduce.set("produce-2", { reject: resolve }),
  );
  const transportError = new Promise((resolve) => {
    client.pending.set("connect-1", { reject: resolve });
  });

  client.handleServerError({
    requestType: "produce",
    requestId: "produce-2",
    message: "produce rejected",
  });
  client.handleServerError({
    requestType: "connect-transport",
    requestId: "connect-1",
    transportId: "transport-1",
    message: "connect rejected",
  });

  assert.equal((await produceError).message, "produce rejected");
  assert.equal((await transportError).message, "connect rejected");
});

test("reordered producer responses resolve their matching requests", async () => {
  const client = session();
  const results = [];
  client.pendingProduce.set("produce-1", {
    resolve: (value) => results.push(["microphone", value.id]),
  });
  client.pendingProduce.set("produce-2", {
    resolve: (value) => results.push(["camera", value.id]),
  });

  await client.handle("producer-id", {
    requestId: "produce-2",
    id: "camera-producer",
  });
  await client.handle("producer-id", {
    requestId: "produce-1",
    id: "microphone-producer",
  });

  assert.deepEqual(results, [
    ["camera", "camera-producer"],
    ["microphone", "microphone-producer"],
  ]);
});

test("transport objects are not ready before required directions connect", () => {
  const client = session();
  client.sendTransport = {};
  client.recvTransport = {};
  client.sources.set("audio", {});
  client.requestedConsumers.add("remote-audio");

  assert.equal(client.connectionState().ready, false);
  client.transportStates.set("send", "connected");
  assert.equal(client.connectionState().ready, false);
  client.transportStates.set("recv", "connected");
  assert.equal(client.connectionState().ready, true);
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

test("remote screen video and audio consumers pause and resume after acknowledgements", async () => {
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

  const pausing = client.setRemoteReceiving("user-1", "screen", false);
  assert.deepEqual(
    sent.map((message) => message.type),
    ["pause-consumer", "pause-consumer"],
  );
  for (const message of sent)
    await client.handle("consumer-paused", {
      ...message.data,
      requestId: message.data.requestId,
    });
  await pausing;
  assert.equal(
    entries.every((entry) => entry.track.enabled === false),
    true,
  );

  sent.length = 0;
  const resuming = client.setRemoteReceiving("user-1", "screen", true);
  assert.deepEqual(
    sent.map((message) => message.type),
    ["resume-consumer", "resume-consumer"],
  );
  for (const message of sent)
    await client.handle("consumer-resumed", {
      ...message.data,
      requestId: message.data.requestId,
    });
  await resuming;
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
