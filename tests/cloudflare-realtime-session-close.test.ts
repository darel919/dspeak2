import assert from "node:assert/strict";
import test from "node:test";
import { CloudflareRealtimeSession } from "../app/shared/cloudflare-realtime-session.ts";

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

class GatheringPeerConnection {
  remoteDescription?: { sdp?: string };

  constructor(mid = "audio-mid") {
    this.connectionState = "connected";
    this.iceGatheringState = "gathering";
    this.localDescription = null;
    this.listeners = new Map();
    this.sender = { id: "gathering-sender" };
    this.mid = mid;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }

  addTrack() {
    return this.sender;
  }

  getTransceivers() {
    return [{ sender: this.sender, mid: this.mid }];
  }

  async createOffer() {
    return { type: "offer", sdp: "offer-before-gathering" };
  }

  async setLocalDescription(description) {
    this.localDescription = description;
  }

  async setRemoteDescription(description) {
    this.remoteDescription = description;
  }

  completeIceGathering() {
    this.iceGatheringState = "complete";
    this.localDescription = {
      ...this.localDescription,
      sdp: "offer-after-gathering",
    };
    this.listeners.get("icegatheringstatechange")?.();
  }

  removeTrack() {}

  close() {
    this.connectionState = "closed";
  }
}

class FailingAnswerPeerConnection extends GatheringPeerConnection {
  failNextAnswer: boolean;

  constructor(mid = "audio-mid") {
    super(mid);
    this.failNextAnswer = true;
  }

  async createAnswer() {
    if (this.failNextAnswer) {
      this.failNextAnswer = false;
      throw new Error("answer failed");
    }
    return { type: "answer", sdp: "answer" };
  }
}

class BlockingOfferPeerConnection extends GatheringPeerConnection {
  blockNextOffer = true;
  offerStarted: Promise<void>;
  private resolveOfferStarted: (() => void) | null = null;
  private resolveOffer: (() => void) | null = null;
  private offerGate: Promise<void>;

  constructor(mid = "audio-mid") {
    super(mid);
    this.offerStarted = new Promise((resolve) => {
      this.resolveOfferStarted = resolve;
    });
    this.offerGate = new Promise((resolve) => {
      this.resolveOffer = resolve;
    });
  }

  async createOffer() {
    if (this.blockNextOffer) {
      this.blockNextOffer = false;
      this.resolveOfferStarted?.();
      await this.offerGate;
    }
    return super.createOffer();
  }

  releaseOffer() {
    this.resolveOffer?.();
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

test("Cloudflare waits for complete ICE before publishing a local offer", async () => {
  const requests = [];
  let client;
  const peerConnection = new GatheringPeerConnection();
  client = new CloudflareRealtimeSession({
    send(message) {
      requests.push(message);
      if (message.data.operation === "tracks-new")
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
  client.peerConnection = peerConnection;
  client.sessionId = "cloudflare-session";
  client.initializing = Promise.resolve();

  const adding = client.addSource({
    source: "audio",
    track: { kind: "audio" },
    stream: {},
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    requests.some((message) => message.data.operation === "tracks-new"),
    false,
  );

  peerConnection.completeIceGathering();
  await adding;
  const request = requests.find(
    (message) => message.data.operation === "tracks-new",
  );
  assert.equal(
    request.data.body.sessionDescription.sdp,
    "offer-after-gathering",
  );
  client.closeMedia();
});

test("Cloudflare compensates a created track when publication registration fails", async () => {
  const requests = [];
  let client;
  const peerConnection = new EmptyEncodingPeerConnection();
  peerConnection.connectionState = "connected";
  peerConnection.signalingState = "stable";
  peerConnection.iceGatheringState = "complete";
  peerConnection.localDescription = { type: "offer", sdp: "offer" };
  peerConnection.setRemoteDescription = async (description) => {
    peerConnection.remoteDescription = description;
  };
  client = new CloudflareRealtimeSession({
    send(message) {
      requests.push(message);
      if (message.type === "cloudflare-publication") return false;
      if (message.type !== "cloudflare-request") return true;
      const { requestId, operation, body } = message.data;
      queueMicrotask(() =>
        client.handle("cloudflare-response", {
          requestId,
          result:
            operation === "tracks-new"
              ? {
                  tracks: [
                    {
                      trackName: body.tracks[0].trackName,
                      mid: "audio-mid",
                    },
                  ],
                  sessionDescription: { type: "answer", sdp: "answer" },
                }
              : { sessionDescription: { type: "answer", sdp: "close" } },
        }),
      );
      return true;
    },
    iceServers: [],
  });
  client.peerConnection = peerConnection;
  client.sessionId = "cloudflare-session";
  client.initializing = Promise.resolve();

  await assert.rejects(
    client.addSource({
      source: "audio",
      track: { kind: "audio", enabled: true },
      stream: {},
    }),
    /Media control is unavailable/,
  );

  const closeRequest = requests.find(
    (message) =>
      message.type === "cloudflare-request" &&
      message.data.operation === "tracks-close",
  );
  assert.ok(closeRequest);
  assert.deepEqual(closeRequest.data.body.tracks, [{ mid: "audio-mid" }]);
  assert.equal(peerConnection.remoteDescription?.sdp, "close");
  assert.equal(client.producers.size, 0);
});

test("Cloudflare recovery closes and re-pulls the exact remote publication", async () => {
  const requests = [];
  const ended = [];
  let client;
  const peerConnection = new GatheringPeerConnection();
  peerConnection.connectionState = "connected";
  peerConnection.signalingState = "stable";
  peerConnection.iceGatheringState = "complete";
  peerConnection.localDescription = { type: "offer", sdp: "offer" };
  client = new CloudflareRealtimeSession({
    send(message) {
      requests.push(message);
      if (message.type !== "cloudflare-request") return true;
      const { requestId, operation } = message.data;
      queueMicrotask(() =>
        client.handle("cloudflare-response", {
          requestId,
          result:
            operation === "tracks-close"
              ? { sessionDescription: { type: "answer", sdp: "close" } }
              : {
                  tracks: [{ trackName: "remote-track", mid: "remote-mid-2" }],
                  sessionDescription: { type: "answer", sdp: "subscribe" },
                },
        }),
      );
      return true;
    },
    iceServers: [],
    onRemoteTrackEnded(entry) {
      ended.push(entry);
    },
  });
  client.peerConnection = peerConnection;
  client.sessionId = "local-session";
  client.initializing = Promise.resolve();
  client.sessionGeneration = 1;
  const publication = {
    trackName: "remote-track",
    sessionId: "remote-session",
    source: "camera",
    userId: "user-1",
    generation: 1,
  };
  client.publications.set("remote-track", publication);
  client.consumers.set("remote-track", {
    trackName: "remote-track",
    mid: "remote-mid",
    track: { stop() {} },
    receiverIncarnationId: "old-token",
  });
  client.remoteByMid.set("remote-mid", publication);
  client.subscribedTrackNames.add("remote-track");

  assert.equal(
    await client.recoverRemotePublication("remote-track", "old-token", 1),
    true,
  );
  assert.deepEqual(
    requests
      .filter((message) => message.type === "cloudflare-request")
      .map((message) => message.data.operation),
    ["tracks-close", "tracks-new"],
  );
  assert.deepEqual(requests[0].data.body.tracks, [{ mid: "remote-mid" }]);
  assert.equal(ended.length, 1);
  assert.equal(client.remoteByMid.get("remote-mid-2"), publication);
  client.closeMedia();
});

test("Cloudflare queued recovery cannot retire a replacement consumer", async () => {
  const requests = [];
  const ended = [];
  let client;
  let runQueued;
  const peerConnection = new GatheringPeerConnection("remote-mid");
  client = new CloudflareRealtimeSession({
    send(message) {
      requests.push(message);
      return true;
    },
    iceServers: [],
    onRemoteTrackEnded(entry) {
      ended.push(entry);
    },
  });
  client.peerConnection = peerConnection;
  client.sessionId = "local-session";
  client.initializing = Promise.resolve();
  client.sessionGeneration = 1;
  client.enqueueNegotiation = (operation) =>
    new Promise((resolve, reject) => {
      runQueued = () => operation().then(resolve, reject);
    });
  const publication = {
    trackName: "remote-track",
    sessionId: "remote-session",
    source: "camera",
    userId: "user-1",
    generation: 1,
  };
  const oldConsumer = {
    trackName: "remote-track",
    mid: "remote-mid",
    track: { stop() {} },
    receiverIncarnationId: "old-token",
  };
  client.publications.set("remote-track", publication);
  client.consumers.set("remote-track", oldConsumer);
  client.remoteByMid.set("remote-mid", publication);
  client.subscribedTrackNames.add("remote-track");

  const recovery = client.recoverRemotePublication(
    "remote-track",
    "old-token",
    1,
  );
  let replacementStopped = false;
  const replacementConsumer = {
    trackName: "remote-track",
    mid: "remote-mid-2",
    track: {
      stop() {
        replacementStopped = true;
      },
    },
    receiverIncarnationId: "new-token",
  };
  client.consumers.set("remote-track", replacementConsumer);
  client.remoteByMid.delete("remote-mid");
  client.remoteByMid.set("remote-mid-2", publication);
  runQueued();

  assert.equal(await recovery, false);
  assert.equal(client.consumers.get("remote-track"), replacementConsumer);
  assert.equal(replacementStopped, false);
  assert.equal(ended.length, 0);
  assert.equal(
    requests.some((message) => message.data?.operation === "tracks-close"),
    false,
  );
  client.closeMedia();
});

test("Cloudflare queued recovery cannot use a replaced publication", async () => {
  const requests = [];
  let client;
  let runQueued;
  const peerConnection = new GatheringPeerConnection("remote-mid");
  client = new CloudflareRealtimeSession({
    send(message) {
      requests.push(message);
      return true;
    },
    iceServers: [],
  });
  client.peerConnection = peerConnection;
  client.sessionId = "local-session";
  client.initializing = Promise.resolve();
  client.sessionGeneration = 1;
  client.enqueueNegotiation = (operation) =>
    new Promise((resolve, reject) => {
      runQueued = () => operation().then(resolve, reject);
    });
  const publication = {
    trackName: "remote-track",
    sessionId: "remote-session",
    source: "camera",
    userId: "user-1",
    generation: 1,
  };
  const consumer = {
    trackName: "remote-track",
    mid: "remote-mid",
    track: { stop() {} },
    receiverIncarnationId: "old-token",
  };
  client.publications.set("remote-track", publication);
  client.consumers.set("remote-track", consumer);
  client.remoteByMid.set("remote-mid", publication);
  client.subscribedTrackNames.add("remote-track");

  const recovery = client.recoverRemotePublication(
    "remote-track",
    "old-token",
    1,
  );
  client.publications.set("remote-track", {
    ...publication,
    generation: 2,
  });
  runQueued();

  assert.equal(await recovery, false);
  assert.equal(client.consumers.get("remote-track"), consumer);
  assert.equal(requests.length, 0);
  client.closeMedia();
});

test("Cloudflare recovery stops before applying a close response for a replacement", async () => {
  const requests = [];
  let resolveCloseSent;
  const closeSent = new Promise((resolve) => {
    resolveCloseSent = resolve;
  });
  let client;
  const peerConnection = new GatheringPeerConnection("remote-mid");
  peerConnection.iceGatheringState = "complete";
  peerConnection.localDescription = { type: "offer", sdp: "offer" };
  client = new CloudflareRealtimeSession({
    send(message) {
      requests.push(message);
      if (message.data?.operation === "tracks-close") resolveCloseSent(message);
      return true;
    },
    iceServers: [],
  });
  client.peerConnection = peerConnection;
  client.sessionId = "local-session";
  client.initializing = Promise.resolve();
  client.sessionGeneration = 1;
  const publication = {
    trackName: "remote-track",
    sessionId: "remote-session",
    source: "camera",
    userId: "user-1",
    generation: 1,
  };
  const oldConsumer = {
    trackName: "remote-track",
    mid: "remote-mid",
    track: { stop() {} },
    receiverIncarnationId: "old-token",
  };
  client.publications.set("remote-track", publication);
  client.consumers.set("remote-track", oldConsumer);
  client.remoteByMid.set("remote-mid", publication);
  client.subscribedTrackNames.add("remote-track");

  const recovery = client.recoverRemotePublication(
    "remote-track",
    "old-token",
    1,
  );
  const closeRequest = await closeSent;
  const replacementConsumer = {
    trackName: "remote-track",
    mid: "remote-mid-2",
    track: { stop() {} },
    receiverIncarnationId: "new-token",
  };
  client.consumers.set("remote-track", replacementConsumer);
  client.remoteByMid.delete("remote-mid");
  client.remoteByMid.set("remote-mid-2", publication);
  client.subscribedTrackNames.add("remote-track");
  client.handle("cloudflare-response", {
    requestId: closeRequest.data.requestId,
    result: { sessionDescription: { type: "answer", sdp: "stale-close" } },
  });

  assert.equal(await recovery, false);
  assert.equal(client.consumers.get("remote-track"), replacementConsumer);
  assert.equal(peerConnection.remoteDescription, undefined);
  assert.equal(
    requests.some((message) => message.data?.operation === "tracks-new"),
    false,
  );
  client.closeMedia();
});

test("Cloudflare stale tracks-new compensates with its returned MID", async () => {
  const requests = [];
  let client;
  const peerConnection = new GatheringPeerConnection("remote-mid");
  peerConnection.iceGatheringState = "complete";
  peerConnection.localDescription = { type: "offer", sdp: "offer" };
  const publication = {
    trackName: "remote-track",
    sessionId: "remote-session",
    source: "camera",
    userId: "user-1",
    generation: 1,
  };
  const replacement = { ...publication, generation: 2 };
  client = new CloudflareRealtimeSession({
    send(message) {
      requests.push(message);
      const { requestId, operation } = message.data;
      queueMicrotask(() => {
        if (operation === "tracks-new")
          client.publications.set("remote-track", replacement);
        client.handle("cloudflare-response", {
          requestId,
          result:
            operation === "tracks-new"
              ? {
                  tracks: [{ trackName: "remote-track", mid: "remote-mid-2" }],
                  sessionDescription: { type: "answer", sdp: "subscribe" },
                }
              : { sessionDescription: { type: "answer", sdp: "compensate" } },
        });
      });
      return true;
    },
    iceServers: [],
  });
  client.peerConnection = peerConnection;
  client.sessionId = "local-session";
  client.initializing = Promise.resolve();
  client.sessionGeneration = 1;
  client.publications.set("remote-track", publication);

  assert.equal(await client.subscribePublicationBatch([publication], 1), false);
  assert.deepEqual(
    requests.map((message) => message.data.operation),
    ["tracks-new", "tracks-close"],
  );
  assert.deepEqual(requests[1].data.body.tracks, [{ mid: "remote-mid-2" }]);
  assert.equal(client.remoteByMid.has("remote-mid-2"), false);
  assert.equal(client.pendingRemoteTracks.has("remote-mid-2"), false);
  assert.equal(client.subscribedTrackNames.has("remote-track"), false);
  assert.equal(client.lastReceivedConsumerParams, null);
  assert.equal(client.publications.get("remote-track"), replacement);
  client.closeMedia();
});

test("Cloudflare failed subscription compensates the consumer bound by the batch", async () => {
  const requests = [];
  const ended = [];
  let client;
  let subscribeAttempt = 0;
  const peerConnection = new FailingAnswerPeerConnection("remote-mid-2");
  peerConnection.iceGatheringState = "complete";
  peerConnection.localDescription = { type: "offer", sdp: "offer" };
  const publication = {
    trackName: "remote-track",
    sessionId: "remote-session",
    source: "camera",
    userId: "user-1",
    generation: 1,
  };
  client = new CloudflareRealtimeSession({
    send(message) {
      requests.push(message);
      const { requestId, operation } = message.data;
      queueMicrotask(() =>
        client.handle("cloudflare-response", {
          requestId,
          result:
            operation === "tracks-new"
              ? {
                  tracks: [{ trackName: "remote-track", mid: "remote-mid-2" }],
                  sessionDescription: {
                    type: "offer",
                    sdp: `subscribe-${subscribeAttempt++}`,
                  },
                }
              : { sessionDescription: { type: "answer", sdp: operation } },
        }),
      );
      return true;
    },
    iceServers: [],
    onRemoteTrackEnded(entry) {
      ended.push(entry);
    },
  });
  client.peerConnection = peerConnection;
  client.sessionId = "local-session";
  client.initializing = Promise.resolve();
  client.sessionGeneration = 1;
  client.publications.set("remote-track", publication);
  peerConnection.setRemoteDescription = async (description) => {
    peerConnection.remoteDescription = description;
    if (description.sdp?.startsWith("subscribe-"))
      client.handleRemoteTrack(
        {
          track: {
            id: `remote-track-${subscribeAttempt}`,
            kind: "audio",
            addEventListener() {},
            stop() {},
          },
          transceiver: { mid: "remote-mid-2" },
        },
        publication,
      );
  };

  await assert.rejects(
    client.subscribePublicationBatch([publication], 1),
    /answer failed/,
  );

  assert.deepEqual(
    requests.map((message) => message.data.operation),
    ["tracks-new", "tracks-close"],
  );
  assert.deepEqual(requests[1].data.body.tracks, [{ mid: "remote-mid-2" }]);
  assert.equal(client.consumers.has("remote-track"), false);
  assert.equal(client.remoteByMid.has("remote-mid-2"), false);
  assert.equal(client.subscribedTrackNames.has("remote-track"), false);
  assert.equal(ended.length, 1);

  assert.equal(await client.subscribePublicationBatch([publication], 1), true);
  assert.equal(client.consumers.get("remote-track").mid, "remote-mid-2");
  assert.equal(ended.length, 1);
  client.closeMedia();
});

test("Cloudflare subscription rollback preserves a same-MID replacement consumer", async () => {
  const requests = [];
  const ended = [];
  let client;
  let replacementConsumer;
  let replacementTrackStopped = false;
  const peerConnection = new FailingAnswerPeerConnection("remote-mid-2");
  peerConnection.iceGatheringState = "complete";
  peerConnection.localDescription = { type: "offer", sdp: "offer" };
  const publication = {
    trackName: "remote-track",
    sessionId: "remote-session",
    source: "camera",
    userId: "user-1",
    generation: 1,
  };
  client = new CloudflareRealtimeSession({
    send(message) {
      requests.push(message);
      const { requestId, operation } = message.data;
      queueMicrotask(() =>
        client.handle("cloudflare-response", {
          requestId,
          result:
            operation === "tracks-new"
              ? {
                  tracks: [{ trackName: "remote-track", mid: "remote-mid-2" }],
                  sessionDescription: {
                    type: "offer",
                    sdp: "subscribe-replacement",
                  },
                }
              : { sessionDescription: { type: "answer", sdp: operation } },
        }),
      );
      return true;
    },
    iceServers: [],
    onRemoteTrackEnded(entry) {
      ended.push(entry);
    },
  });
  client.peerConnection = peerConnection;
  client.sessionId = "local-session";
  client.initializing = Promise.resolve();
  client.sessionGeneration = 1;
  client.publications.set("remote-track", publication);
  peerConnection.setRemoteDescription = async (description) => {
    peerConnection.remoteDescription = description;
    client.handleRemoteTrack(
      {
        track: {
          id: "remote-track-old",
          kind: "audio",
          addEventListener() {},
          stop() {},
        },
        transceiver: { mid: "remote-mid-2" },
      },
      publication,
    );
  };
  const originalCreateAnswer = peerConnection.createAnswer.bind(peerConnection);
  peerConnection.createAnswer = async () => {
    const replacementTrack = {
      id: "remote-track-replacement",
      kind: "audio",
      addEventListener() {},
      stop() {
        replacementTrackStopped = true;
      },
    };
    client.handleRemoteTrack(
      {
        track: replacementTrack,
        transceiver: { mid: "remote-mid-2" },
      },
      publication,
    );
    replacementConsumer = client.consumers.get("remote-track");
    return originalCreateAnswer();
  };

  await assert.rejects(
    client.subscribePublicationBatch([publication], 1),
    /answer failed/,
  );

  assert.deepEqual(
    requests.map((message) => message.data.operation),
    ["tracks-new"],
  );
  assert.equal(client.consumers.get("remote-track"), replacementConsumer);
  assert.equal(replacementTrackStopped, false);
  assert.equal(client.remoteByMid.get("remote-mid-2"), publication);
  assert.equal(client.subscribedTrackNames.has("remote-track"), true);
  assert.equal(ended.length, 1);
  client.closeMedia();
});

test("Cloudflare compensation does not close a same-MID replacement during offer creation", async () => {
  const requests = [];
  let client;
  const peerConnection = new BlockingOfferPeerConnection("remote-mid");
  peerConnection.iceGatheringState = "complete";
  peerConnection.localDescription = { type: "offer", sdp: "offer" };
  client = new CloudflareRealtimeSession({
    send(message) {
      requests.push(message);
      return true;
    },
    iceServers: [],
  });
  client.peerConnection = peerConnection;
  client.sessionId = "local-session";
  client.initializing = Promise.resolve();
  client.sessionGeneration = 1;
  const publication = {
    trackName: "remote-track",
    sessionId: "remote-session",
    source: "camera",
    userId: "user-1",
    generation: 1,
  };
  const oldConsumer = {
    trackName: "remote-track",
    mid: "remote-mid",
    track: { stop() {} },
  };
  client.publications.set("remote-track", publication);
  client.consumers.set("remote-track", oldConsumer);
  client.remoteByMid.set("remote-mid", publication);
  client.subscribedTrackNames.add("remote-track");
  const binding = {
    trackName: "remote-track",
    mid: "remote-mid",
    publication,
    consumer: oldConsumer,
  };

  const compensation = client.closePulledRemoteTracksSafely(
    [binding],
    peerConnection,
    1,
  );
  await peerConnection.offerStarted;
  let replacementStopped = false;
  const replacementTrack = {
    id: "replacement-track",
    kind: "audio",
    addEventListener() {},
    stop() {
      replacementStopped = true;
    },
  };
  client.handleRemoteTrack(
    { track: replacementTrack, transceiver: { mid: "remote-mid" } },
    publication,
  );
  peerConnection.releaseOffer();

  assert.equal(await compensation, false);
  assert.equal(client.consumers.get("remote-track").track, replacementTrack);
  assert.equal(replacementStopped, false);
  assert.equal(
    requests.some((message) => message.data?.operation === "tracks-close"),
    false,
  );
  client.closeMedia();
});

test("Cloudflare compensation does not close a remapped publication during offer creation", async () => {
  const requests = [];
  let client;
  const peerConnection = new BlockingOfferPeerConnection("remote-mid");
  peerConnection.iceGatheringState = "complete";
  peerConnection.localDescription = { type: "offer", sdp: "offer" };
  client = new CloudflareRealtimeSession({
    send(message) {
      requests.push(message);
      return true;
    },
    iceServers: [],
  });
  client.peerConnection = peerConnection;
  client.sessionId = "local-session";
  client.initializing = Promise.resolve();
  client.sessionGeneration = 1;
  const publication = {
    trackName: "remote-track",
    sessionId: "remote-session",
    source: "camera",
    userId: "user-1",
    generation: 1,
  };
  const replacement = { ...publication, generation: 2 };
  client.publications.set("remote-track", publication);
  client.remoteByMid.set("remote-mid", publication);
  const binding = {
    trackName: "remote-track",
    mid: "remote-mid",
    publication,
  };

  const compensation = client.closePulledRemoteTracksSafely(
    [binding],
    peerConnection,
    1,
  );
  await peerConnection.offerStarted;
  client.publications.set("remote-track", replacement);
  client.remoteByMid.set("remote-mid", replacement);
  peerConnection.releaseOffer();

  assert.equal(await compensation, false);
  assert.equal(
    requests.some((message) => message.data?.operation === "tracks-close"),
    false,
  );
  assert.equal(client.remoteByMid.get("remote-mid"), replacement);
  client.closeMedia();
});

test("Cloudflare compensation closes only still-owned bindings in a mixed batch", async () => {
  const requests = [];
  let client;
  const peerConnection = new BlockingOfferPeerConnection("remote-mid-a");
  peerConnection.iceGatheringState = "complete";
  peerConnection.localDescription = { type: "offer", sdp: "offer" };
  client = new CloudflareRealtimeSession({
    send(message) {
      requests.push(message);
      if (message.data?.operation === "tracks-close")
        queueMicrotask(() =>
          client.handle("cloudflare-response", {
            requestId: message.data.requestId,
            result: { sessionDescription: { type: "answer", sdp: "close" } },
          }),
        );
      return true;
    },
    iceServers: [],
  });
  client.peerConnection = peerConnection;
  client.sessionId = "local-session";
  client.initializing = Promise.resolve();
  client.sessionGeneration = 1;
  const publicationA = {
    trackName: "remote-track-a",
    sessionId: "remote-session",
    source: "camera",
    userId: "user-1",
    generation: 1,
  };
  const publicationB = {
    trackName: "remote-track-b",
    sessionId: "remote-session",
    source: "screen",
    userId: "user-1",
    generation: 1,
  };
  const replacementB = { ...publicationB, generation: 2 };
  client.publications.set("remote-track-a", publicationA);
  client.publications.set("remote-track-b", publicationB);
  client.remoteByMid.set("remote-mid-a", publicationA);
  client.remoteByMid.set("remote-mid-b", publicationB);
  const bindings = [
    {
      trackName: "remote-track-a",
      mid: "remote-mid-a",
      publication: publicationA,
    },
    {
      trackName: "remote-track-b",
      mid: "remote-mid-b",
      publication: publicationB,
    },
  ];

  const compensation = client.closePulledRemoteTracksSafely(
    bindings,
    peerConnection,
    1,
  );
  await peerConnection.offerStarted;
  client.publications.set("remote-track-b", replacementB);
  client.remoteByMid.set("remote-mid-b", replacementB);
  peerConnection.releaseOffer();

  assert.equal(await compensation, true);
  const closeRequest = requests.find(
    (message) => message.data?.operation === "tracks-close",
  );
  assert.deepEqual(closeRequest.data.body.tracks, [{ mid: "remote-mid-a" }]);
  assert.equal(client.remoteByMid.get("remote-mid-b"), replacementB);
  client.closeMedia();
});

test("Cloudflare stale after-bind recovery compensates before renegotiation completes", async () => {
  const requests = [];
  let client;
  const peerConnection = new GatheringPeerConnection("remote-mid-2");
  peerConnection.iceGatheringState = "complete";
  peerConnection.localDescription = { type: "offer", sdp: "offer" };
  const publication = {
    trackName: "remote-track",
    sessionId: "remote-session",
    source: "camera",
    userId: "user-1",
    generation: 1,
  };
  const replacement = { ...publication, generation: 2 };
  client = new CloudflareRealtimeSession({
    send(message) {
      requests.push(message);
      const { requestId, operation } = message.data;
      queueMicrotask(() =>
        client.handle("cloudflare-response", {
          requestId,
          result:
            operation === "tracks-close"
              ? { sessionDescription: { type: "answer", sdp: "close" } }
              : {
                  tracks: [{ trackName: "remote-track", mid: "remote-mid-2" }],
                  sessionDescription: { type: "answer", sdp: "subscribe" },
                },
        }),
      );
      return true;
    },
    iceServers: [],
  });
  client.peerConnection = peerConnection;
  client.sessionId = "local-session";
  client.initializing = Promise.resolve();
  client.sessionGeneration = 1;
  client.publications.set("remote-track", publication);
  client.consumers.set("remote-track", {
    trackName: "remote-track",
    mid: "remote-mid",
    track: { stop() {} },
    receiverIncarnationId: "old-token",
  });
  client.remoteByMid.set("remote-mid", publication);
  client.subscribedTrackNames.add("remote-track");

  const originalSetRemoteDescription =
    peerConnection.setRemoteDescription.bind(peerConnection);
  peerConnection.setRemoteDescription = async (description) => {
    await originalSetRemoteDescription(description);
    if (description.sdp === "subscribe")
      client.publications.set("remote-track", replacement);
  };
  const recovery = client.recoverRemotePublication(
    "remote-track",
    "old-token",
    1,
  );

  assert.equal(await recovery, false);
  assert.deepEqual(
    requests.map((message) => message.data.operation),
    ["tracks-close", "tracks-new", "tracks-close"],
  );
  assert.deepEqual(requests[2].data.body.tracks, [{ mid: "remote-mid-2" }]);
  assert.equal(client.remoteByMid.has("remote-mid-2"), false);
  assert.equal(client.subscribedTrackNames.has("remote-track"), false);
  assert.equal(client.lastReceivedConsumerParams, null);
  client.closeMedia();
});

test("Cloudflare recovery only trusts a consumer on the returned MID", async () => {
  const requests = [];
  const ended = [];
  let client;
  let closeCount = 0;
  const peerConnection = new GatheringPeerConnection("wrong-mid");
  peerConnection.iceGatheringState = "complete";
  peerConnection.localDescription = { type: "offer", sdp: "offer" };
  const publication = {
    trackName: "remote-track",
    sessionId: "remote-session",
    source: "camera",
    userId: "user-1",
    generation: 1,
  };
  const wrongTrack = {
    id: "wrong-track-id",
    kind: "audio",
    addEventListener() {},
  };
  client = new CloudflareRealtimeSession({
    send(message) {
      requests.push(message);
      const { requestId, operation } = message.data;
      if (operation === "tracks-close") closeCount += 1;
      queueMicrotask(() =>
        client.handle("cloudflare-response", {
          requestId,
          result:
            operation === "tracks-new"
              ? {
                  tracks: [{ trackName: "remote-track", mid: "remote-mid-2" }],
                  sessionDescription: { type: "answer", sdp: "subscribe" },
                }
              : {
                  sessionDescription: {
                    type: "answer",
                    sdp: closeCount === 1 ? "close" : "compensate",
                  },
                },
        }),
      );
      return true;
    },
    iceServers: [],
    onRemoteTrackEnded(entry) {
      ended.push(entry);
    },
  });
  client.peerConnection = peerConnection;
  client.sessionId = "local-session";
  client.initializing = Promise.resolve();
  client.sessionGeneration = 1;
  client.publications.set("remote-track", publication);
  client.consumers.set("remote-track", {
    trackName: "remote-track",
    mid: "remote-mid",
    track: { stop() {} },
    receiverIncarnationId: "old-token",
  });
  client.remoteByMid.set("remote-mid", publication);
  client.remoteByMid.set("wrong-mid", publication);
  client.subscribedTrackNames.add("remote-track");
  client.pendingRemoteTracks.set("remote-mid-2", [
    {
      track: wrongTrack,
      transceiver: { mid: "wrong-mid" },
    },
  ]);

  assert.equal(
    await client.recoverRemotePublication("remote-track", "old-token", 1),
    false,
  );
  assert.deepEqual(
    requests.map((message) => message.data.operation),
    ["tracks-close", "tracks-new", "tracks-close"],
  );
  assert.deepEqual(requests[2].data.body.tracks, [{ mid: "remote-mid-2" }]);
  assert.equal(client.remoteByMid.has("remote-mid-2"), false);
  assert.equal(client.consumers.get("remote-track").mid, "wrong-mid");
  assert.equal(client.subscribedTrackNames.has("remote-track"), true);
  assert.equal(ended.length, 1);
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
