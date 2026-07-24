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

test("timed out signaling requests clean up and ignore late responses", async () => {
  const sent = [];
  const client = new MediasoupClientSession({
    send: (message) => sent.push(message),
    iceServers: [],
    requestTimeoutMs: 5,
  });
  client.sendTransport = {
    id: "send-transport",
    on(event, handler) {
      if (event === "connect") this.connectHandler = handler;
    },
  };
  client.bindSendTransport();

  let timeoutError;
  client.sendTransport.connectHandler(
    { dtlsParameters: {} },
    () => {},
    (error) => {
      timeoutError = error;
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 15));

  const requestId = sent[0].data.requestId;
  assert.match(timeoutError.message, /timed out/);
  assert.equal(client.pending.has(requestId), false);
  await client.handle("transport-connected", { requestId });
  assert.equal(client.pending.size, 0);
});

test("an existing SFU source replaces its track without recreating the producer", async () => {
  const client = session();
  const previousTrack = {
    stopped: false,
    stop() {
      this.stopped = true;
    },
  };
  const replacementTrack = {
    stopped: false,
    stop() {
      this.stopped = true;
    },
  };
  const captureTrack = {
    clone() {
      return replacementTrack;
    },
  };
  const replacements = [];
  const producer = {
    async replaceTrack(options) {
      replacements.push(options.track);
    },
  };
  client.producers.set("audio", {
    producer,
    track: previousTrack,
    source: "audio",
  });

  const result = await client.addSource({
    source: "audio",
    track: captureTrack,
  });

  assert.equal(result, producer);
  assert.deepEqual(replacements, [replacementTrack]);
  assert.equal(previousTrack.stopped, true);
  assert.equal(client.producers.get("audio").track, replacementTrack);
});

test("failed SFU track replacement preserves its previous source ownership", async () => {
  const client = session();
  const previousSource = { source: "audio", track: { id: "capture-old" } };
  const replacementClone = {
    stopped: false,
    stop() {
      this.stopped = true;
    },
  };
  client.sources.set("audio", previousSource);
  client.producers.set("audio", {
    producer: {
      async replaceTrack() {
        throw new Error("replacement rejected");
      },
    },
    track: { stop() {} },
    source: "audio",
  });

  await assert.rejects(
    client.addSource({
      source: "audio",
      track: { clone: () => replacementClone },
    }),
    /replacement rejected/,
  );

  assert.equal(client.sources.get("audio"), previousSource);
  assert.equal(replacementClone.stopped, true);
});

test("concurrent publication of one SFU source creates one producer", async () => {
  const client = session();
  let releaseProduce;
  let produceCalls = 0;
  const producer = {
    paused: false,
    on() {},
  };
  client.sendTransport = {
    produce() {
      produceCalls += 1;
      return new Promise((resolve) => {
        releaseProduce = () => resolve(producer);
      });
    },
  };
  const clonedTracks = [];
  const entry = {
    source: "audio",
    track: {
      kind: "audio",
      clone() {
        const track = {
          kind: "audio",
          getSettings: () => ({}),
          stop() {},
        };
        clonedTracks.push(track);
        return track;
      },
    },
  };

  const first = client.publish(entry);
  const second = client.publish(entry);

  assert.equal(produceCalls, 1);
  assert.equal(clonedTracks.length, 1);
  releaseProduce();
  assert.equal(await first, producer);
  assert.equal(await second, producer);
  assert.equal(client.producers.get("audio").producer, producer);
  assert.equal(client.sourcePublications.size, 0);
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

test("server transport states update readiness and normalize completed ICE", async () => {
  const states = [];
  const client = new MediasoupClientSession({
    send() {},
    iceServers: [],
    onStateChange: (direction, state, summary) =>
      states.push({ direction, state, summary }),
  });
  client.sources.set("audio", {});
  client.requestedConsumers.add("remote-audio");

  await client.handle("transport-state", {
    direction: "send",
    state: "completed",
  });
  await client.handle("transport-state", {
    direction: "recv",
    state: "connected",
  });

  assert.equal(client.connectionState().ready, true);
  assert.deepEqual(
    states.map(({ direction, state }) => [direction, state]),
    [
      ["send", "connected"],
      ["recv", "connected"],
    ],
  );
});

test("duplicate terminal transport events schedule only one ICE recovery", async () => {
  const client = session();
  client.sendTransport = { close() {}, closed: false };
  let restarts = 0;
  client.restartTransportIce = async () => {
    restarts += 1;
  };

  await client.handle("transport-state", {
    direction: "send",
    state: "failed",
  });
  await client.handle("transport-state", {
    direction: "send",
    state: "failed",
  });
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(restarts, 1);
  client.close();
});

test("ICE restart applies only its correlated acknowledgement", async () => {
  const sent = [];
  const applied = [];
  const client = new MediasoupClientSession({
    send: (message) => sent.push(message),
    iceServers: [],
    requestTimeoutMs: 20,
  });
  client.sendTransport = {
    id: "send-transport",
    closed: false,
    restartIce: async ({ iceParameters }) => applied.push(iceParameters),
  };

  const restart = client.restartTransportIce("send");
  const requestId = sent[0].data.requestId;
  await client.handle("ice-restarted", {
    requestId: "stale-restart",
    iceParameters: { usernameFragment: "stale" },
  });
  assert.deepEqual(applied, []);
  await client.handle("ice-restarted", {
    requestId,
    iceParameters: { usernameFragment: "fresh" },
  });

  assert.equal(await restart, true);
  assert.deepEqual(applied, [{ usernameFragment: "fresh" }]);
  assert.equal(client.pending.size, 0);
});

test("ICE restart rejection and timeout clean exactly one pending request", async () => {
  const rejectedClient = new MediasoupClientSession({
    send() {},
    iceServers: [],
    requestTimeoutMs: 20,
  });
  rejectedClient.sendTransport = {
    id: "send-transport",
    closed: false,
    restartIce: async () => {},
  };
  const rejected = rejectedClient.restartTransportIce("send");
  const rejectedRequestId = [...rejectedClient.pending.keys()][0];
  rejectedClient.handleServerError({
    requestType: "restart-ice",
    requestId: rejectedRequestId,
    message: "ICE restart rejected",
  });
  await assert.rejects(rejected, /ICE restart rejected/);
  assert.equal(rejectedClient.pending.size, 0);

  const timedOutClient = new MediasoupClientSession({
    send() {},
    iceServers: [],
    requestTimeoutMs: 5,
  });
  timedOutClient.recvTransport = {
    id: "recv-transport",
    closed: false,
    restartIce: async () => {},
  };
  await assert.rejects(
    timedOutClient.restartTransportIce("recv"),
    /ICE restart timed out/,
  );
  assert.equal(timedOutClient.pending.size, 0);
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

test("remote consumer lifecycle refreshes active media connection state", async () => {
  const originalMediaStream = globalThis.MediaStream;
  globalThis.MediaStream = class {
    constructor(tracks) {
      this.tracks = tracks;
    }
  };
  const states = [];
  const client = new MediasoupClientSession({
    send() {},
    iceServers: [],
    onStateChange: (direction, state, summary) =>
      states.push({ direction, state, summary }),
  });
  client.transportStates.set("recv", "connected");
  let transportClose;
  client.recvTransport = {
    consume: async ({ id, producerId, kind, appData }) => ({
      id,
      producerId,
      track: { kind },
      on(event, handler) {
        if (event === "transportclose") transportClose = handler;
      },
      close() {},
      appData,
    }),
  };
  client.setConsumerReceiving = async (entry, receiving) => {
    entry.receiving = receiving;
    return true;
  };

  try {
    await client.createConsumer({
      id: "consumer-1",
      producerId: "producer-1",
      kind: "audio",
      source: "screen-audio",
      userId: "user-1",
      rtpParameters: {},
    });

    assert.equal(states[0].direction, "consumer");
    assert.equal(states[0].state, "connected");
    assert.equal(states[0].summary.receiveRequired, true);
    assert.equal(states[0].summary.ready, true);

    transportClose();
    assert.equal(states[1].direction, "consumer");
    assert.equal(states[1].summary.receiveRequired, false);
    assert.equal(states[1].summary.ready, true);
  } finally {
    globalThis.MediaStream = originalMediaStream;
  }
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

test("consumer control retries once after a dropped acknowledgement", async () => {
  const sent = [];
  const client = new MediasoupClientSession({
    send: (message) => sent.push(message),
    iceServers: [],
    consumerControlTimeoutMs: 5,
  });
  const entry = {
    track: { enabled: false },
    consumer: { id: "consumer-1" },
  };

  const resuming = client.setConsumerReceiving(entry, true);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(sent.length, 2);
  await client.handle("consumer-resumed", sent[1].data);

  assert.equal(await resuming, true);
  assert.equal(entry.track.enabled, true);
  assert.equal(entry.receiving, true);
  assert.equal(client.pending.size, 0);
});

test("permanent consumer control failure disables the track and reports failure", async () => {
  const states = [];
  const client = new MediasoupClientSession({
    send() {},
    iceServers: [],
    consumerControlTimeoutMs: 5,
    onStateChange: (direction, state) => states.push([direction, state]),
  });
  const entry = {
    track: { enabled: true },
    consumer: { id: "consumer-1" },
  };

  await assert.rejects(
    client.setConsumerReceiving(entry, true),
    /consumer resume timed out/,
  );
  assert.equal(entry.track.enabled, false);
  assert.equal(entry.receiving, false);
  assert.equal(client.pending.size, 0);
  assert.deepEqual(states, [["consumer", "failed"]]);
});

test("new remote screen video waits for viewing while shared audio starts", () => {
  const client = session();

  assert.equal(client.shouldReceive("user-1", "screen"), false);
  assert.equal(client.shouldReceive("user-1", "screen-audio"), true);
  assert.equal(client.shouldReceive("user-1", "camera"), true);
  assert.equal(client.shouldReceive("user-1", "audio"), true);
});
