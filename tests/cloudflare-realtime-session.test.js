import assert from "node:assert/strict";
import test from "node:test";
import { CloudflareRealtimeSession } from "../app/shared/cloudflare-realtime-session.js";

function session() {
  return new CloudflareRealtimeSession({ send() {}, iceServers: [] });
}

function report(type, bytesField, bytes, timestamp) {
  return new Map([["rtp", { type, [bytesField]: bytes, timestamp }]]);
}

test("Cloudflare SFU readiness requires every expected RTP flow", async () => {
  const client = session();
  client.peerConnection = { connectionState: "connected" };
  let outboundBytes = 100;
  let inboundBytes = 200;
  let timestamp = 1000;
  client.producers.set("audio", {
    source: "audio",
    sender: {
      id: "sender-1",
      getStats: async () =>
        report("outbound-rtp", "bytesSent", outboundBytes, timestamp),
    },
  });
  client.consumers.set("consumer-1", {
    trackName: "track-1",
    receiver: {
      id: "receiver-1",
      getStats: async () =>
        report("inbound-rtp", "bytesReceived", inboundBytes, timestamp),
    },
  });

  assert.equal(client.expectedInboundFlowCount(), 1);
  assert.equal((await client.mediaReadiness(1)).ready, false);
  outboundBytes += 10;
  inboundBytes += 10;
  timestamp += 100;
  assert.equal((await client.mediaReadiness(1)).ready, true);
  timestamp += 100;
  assert.equal((await client.mediaReadiness(1)).ready, false);
});

test("Cloudflare metrics expose the shared transport diagnostics contract", async () => {
  const report = new Map([
    [
      "pair",
      {
        id: "pair",
        type: "candidate-pair",
        state: "succeeded",
        nominated: true,
        currentRoundTripTime: 0.04,
        availableOutgoingBitrate: 96_000,
        localCandidateId: "local",
        remoteCandidateId: "remote",
      },
    ],
    [
      "local",
      {
        id: "local",
        type: "local-candidate",
        address: "192.0.2.10",
        port: 5000,
        protocol: "udp",
        candidateType: "host",
      },
    ],
    [
      "remote",
      {
        id: "remote",
        type: "remote-candidate",
        address: "198.51.100.10",
        port: 6000,
        protocol: "udp",
        candidateType: "srflx",
      },
    ],
    [
      "outbound",
      {
        id: "outbound",
        type: "outbound-rtp",
        kind: "audio",
        packetsSent: 100,
      },
    ],
    [
      "remote-inbound",
      {
        id: "remote-inbound",
        type: "remote-inbound-rtp",
        kind: "audio",
        fractionLost: 0.05,
      },
    ],
    [
      "inbound",
      {
        id: "inbound",
        type: "inbound-rtp",
        kind: "audio",
        jitter: 0.004,
      },
    ],
  ]);
  const client = session();
  client.peerConnection = {
    connectionState: "connected",
    iceConnectionState: "connected",
    signalingState: "stable",
    getStats: async () => report,
  };
  client.sessionId = "cloudflare-session";

  const [stats] = await client.stats();

  assert.deepEqual(stats.pcStates, {
    connectionState: "connected",
    iceConnectionState: "connected",
    signalingState: "stable",
  });
  assert.equal(stats.candidatePair.currentRoundTripTime, 0.04);
  assert.equal(stats.rttMs, 40);
  assert.equal(stats.jitterMs, 4);
  assert.equal(stats.packetLossPercent, 5);
  assert.equal(stats.availableOutgoingBitrate, 96_000);
  assert.equal(stats.candidateType, "host");
  assert.equal(stats.protocol, "udp");
  const [diagnostic] = await client.diagnosticStats();
  assert.equal(diagnostic.kind, "sfu:cloudflare-realtime");
  assert.equal(diagnostic.pcStates.connectionState, "connected");
});

test("Cloudflare applies high-quality video sender settings before negotiation", async () => {
  let applied = null;
  const client = new CloudflareRealtimeSession({
    send() {},
    iceServers: [],
    getVideoSettings: () => ({
      frameRate: 60,
      maxBitrate: 4_500_000,
      qualityPriority: "resolution",
    }),
  });
  const sender = {
    getParameters: () => ({ encodings: [{}] }),
    setParameters: async (parameters) => {
      applied = parameters;
    },
  };

  assert.equal(
    await client.configureVideoSender(sender, {
      source: "screen",
      track: {
        kind: "video",
        getSettings: () => ({ width: 1920, height: 1080, frameRate: 60 }),
      },
    }),
    true,
  );
  assert.equal(applied.encodings[0].maxBitrate, 4_500_000);
  assert.equal(applied.encodings[0].maxFramerate, 60);
  assert.equal(applied.encodings[0].priority, "high");
  assert.equal(applied.degradationPreference, "maintain-resolution");
});

class FakePeerConnection {
  constructor() {
    this.connectionState = "new";
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  close() {
    this.connectionState = "closed";
  }
}

test("Cloudflare batches queued publications after local bootstrap", async () => {
  const previousPeerConnection = globalThis.RTCPeerConnection;
  globalThis.RTCPeerConnection = FakePeerConnection;
  const requests = [];
  let client;
  client = new CloudflareRealtimeSession({
    send(message) {
      requests.push(message);
      const request = message.data;
      queueMicrotask(() =>
        client.handle("cloudflare-response", {
          requestId: request.requestId,
          result:
            request.operation === "new-session"
              ? { sessionId: "cloudflare-session" }
              : {
                  tracks: request.body.tracks.map((track, index) => ({
                    trackName: track.trackName,
                    mid: `remote-mid-${index}`,
                  })),
                },
        }),
      );
      return true;
    },
    iceServers: [],
  });
  const publication = {
    trackName: "remote-screen",
    sessionId: "publisher-session",
    peerId: "peer-remote",
    userId: "user-remote",
    source: "screen",
  };
  const audioPublication = {
    ...publication,
    trackName: "remote-screen-audio",
    source: "screen-audio",
    ownerSource: "screen",
  };

  try {
    await client.handle("cloudflare-publication-available", publication);
    await client.handle("cloudflare-publication-available", audioPublication);
    await client.initialize();
    assert.equal(
      requests.filter((entry) => entry.data.operation === "tracks-new").length,
      0,
    );
    await client.startSubscriptions();
    const subscriptionRequests = requests.filter(
      (entry) => entry.data.operation === "tracks-new",
    );
    assert.equal(subscriptionRequests.length, 1);
    assert.equal(subscriptionRequests[0].data.body.tracks.length, 2);
    assert.equal(client.remoteByMid.get("remote-mid-0"), publication);
    assert.equal(client.remoteByMid.get("remote-mid-1"), audioPublication);
    await client.startSubscriptions();
    assert.equal(
      requests.filter((entry) => entry.data.operation === "tracks-new").length,
      1,
    );
  } finally {
    client.closeMedia();
    globalThis.RTCPeerConnection = previousPeerConnection;
  }
});

test("Cloudflare screen consent leaves separately controlled media unchanged", async () => {
  const client = session();
  const screen = {
    userId: "user-remote",
    source: "screen",
    receiving: true,
    track: { enabled: true },
  };
  const screenAudio = {
    userId: "user-remote",
    source: "screen-audio",
    ownerSource: "system-audio",
    receiving: true,
    track: { enabled: true },
  };
  client.consumers.set("screen", screen);
  client.consumers.set("screen-audio", screenAudio);

  await client.setRemoteReceiving("user-remote", "screen", false);

  assert.equal(screen.receiving, false);
  assert.equal(screen.track.enabled, false);
  assert.equal(screenAudio.receiving, true);
  assert.equal(screenAudio.track.enabled, true);
  client.closeMedia();
});

test("Cloudflare receiving defaults distinguish paired and standalone audio", () => {
  const client = session();

  assert.equal(
    client.shouldReceive("user-remote", "screen-audio", "screen"),
    false,
  );
  assert.equal(
    client.shouldReceive("user-remote", "screen-audio", "system-audio"),
    true,
  );
  assert.equal(client.shouldReceive("user-remote", "screen-audio"), false);
  client.closeMedia();
});

test("Cloudflare remote tracks retain the publication identity contract", async () => {
  const previousPeerConnection = globalThis.RTCPeerConnection;
  globalThis.RTCPeerConnection = FakePeerConnection;
  let client;
  let remoteEntry = null;
  client = new CloudflareRealtimeSession({
    send(message) {
      const request = message.data;
      queueMicrotask(() =>
        client.handle("cloudflare-response", {
          requestId: request.requestId,
          result:
            request.operation === "new-session"
              ? { sessionId: "cloudflare-session" }
              : {
                  tracks: [
                    {
                      trackName: request.body.tracks[0].trackName,
                      mid: "remote-mid",
                    },
                  ],
                },
        }),
      );
      return true;
    },
    iceServers: [],
    onRemoteTrack: (entry) => {
      remoteEntry = entry;
    },
  });
  const publication = {
    trackName: "remote-track",
    sessionId: "publisher-session",
    peerId: "peer-remote",
    userId: "user-remote",
    source: "audio",
  };

  try {
    await client.handle("cloudflare-publication-available", publication);
    await client.initialize();
    await client.startSubscriptions();
    const track = {
      kind: "audio",
      addEventListener() {},
    };
    client.peerConnection.listeners.get("track")({
      transceiver: { mid: "remote-mid" },
      receiver: { id: "receiver-1" },
      track,
      streams: [{}],
    });

    assert.equal(remoteEntry.userId, "user-remote");
    assert.equal(remoteEntry.participantId, "user-remote");
    assert.equal(remoteEntry.peerId, "peer-remote");
    assert.equal(remoteEntry.kind, "audio");
    assert.equal(remoteEntry.key, "remote-track");
    assert.equal(remoteEntry.track, track);
  } finally {
    client.closeMedia();
    globalThis.RTCPeerConnection = previousPeerConnection;
  }
});

test("Cloudflare drops a subscription that closes while negotiation is pending", async () => {
  const requests = [];
  const client = new CloudflareRealtimeSession({
    send(message) {
      requests.push(message);
      return true;
    },
    iceServers: [],
  });
  client.peerConnection = new FakePeerConnection();
  client.sessionId = "cloudflare-session";
  client.subscriptionsStarted = true;
  const publication = {
    trackName: "remote-track",
    sessionId: "publisher-session",
    peerId: "peer-remote",
    userId: "user-remote",
    source: "audio",
  };

  const subscription = client.handle(
    "cloudflare-publication-available",
    publication,
  );
  await new Promise((resolve) => setImmediate(resolve));
  const request = requests[0];
  await client.handle("cloudflare-publication-available", {
    ...publication,
    closed: true,
  });
  await client.handle("cloudflare-response", {
    requestId: request.data.requestId,
    result: {
      tracks: [{ trackName: publication.trackName, mid: "late-mid" }],
    },
  });
  await subscription;

  assert.equal(client.remoteByMid.has("late-mid"), false);
  client.closeMedia();
});

test("Cloudflare rejects subscriptions without a returned media MID", async () => {
  const client = session();
  client.peerConnection = new FakePeerConnection();
  client.sessionId = "cloudflare-session";
  const publication = {
    trackName: "remote-screen",
    sessionId: "publisher-session",
    peerId: "peer-remote",
    userId: "user-remote",
    source: "screen",
  };
  client.publications.set(publication.trackName, publication);
  client.request = async () => ({
    tracks: [{ trackName: publication.trackName }],
  });

  await assert.rejects(
    client.subscribePublication(publication, client.sessionGeneration),
    /track MID is missing/,
  );
  assert.equal(client.consumers.size, 0);
  assert.equal(client.remoteByMid.size, 0);
  client.closeMedia();
});
