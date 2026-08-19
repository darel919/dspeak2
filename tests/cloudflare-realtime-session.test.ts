import assert from "node:assert/strict";
import test from "node:test";
import { CloudflareRealtimeSession } from "../app/shared/cloudflare-realtime-session.ts";
import type { CloudflarePublication } from "../app/shared/types/cloudflare-media.ts";

function session() {
  return new CloudflareRealtimeSession({ send() {}, iceServers: [] });
}

test("stale mid-subscribe reconciliation converges to the newest canonical snapshot", async () => {
  const client = session();
  client.sessionId = "cloudflare-session";
  client.subscriptionsStarted = true;
  const registry = new Map<string, unknown>();

  // R40 snapshot: old physical track X (generation 8)
  const oldX = {
    peerId: "peer-1",
    source: "screen",
    trackName: "screen-X",
    generation: 8,
    connectionEpoch: 1,
    userId: "user-1",
    closed: false,
  };
  // R41 live push: new physical track Y (generation 9)
  const newY = {
    peerId: "peer-1",
    source: "screen",
    trackName: "screen-Y",
    generation: 9,
    connectionEpoch: 1,
    userId: "user-1",
    closed: false,
  };

  // Subscribe for X defers until we release it (simulates slow provider I/O)
  let releaseSubscribeX: (() => void) | undefined;
  const gateX = new Promise<void>((resolve) => {
    releaseSubscribeX = resolve;
  });
  const subscribeCalls: string[] = [];
  client.subscribe = async (publication) => {
    const trackName = String(publication.trackName);
    subscribeCalls.push(trackName);
    client.subscribedTrackNames.add(trackName);
    if (trackName === "screen-X") await gateX;
    return true;
  };

  interface NarrowedSession {
    handle: (type: string, data: Record<string, unknown>) => Promise<unknown>;
    reconcilePublications: (
      publications: CloudflarePublication[],
      removedPublications?: CloudflarePublication[],
      isStale?: () => boolean,
      getLatestCanonical?: () => CloudflarePublication[],
    ) => Promise<unknown>;
  }
  const sessionNarrowed = client as unknown as NarrowedSession;
  await sessionNarrowed.handle("cloudflare-publication-available", {
    ...newY,
  });
  assert.equal(client.publications.has("screen-Y"), true);

  // Delayed R40 heartbeat starts reconciliation: inserts X, awaits subscribe(X)
  let stale = false;
  // The LAZY canonical getter reads the CURRENT retained registry at stale
  // detection time - exactly like the real caller passing
  // () => cloudflarePublications.values().
  let registrySnapshotAtStale: unknown[] | null = null;
  const reconcilePromise = sessionNarrowed.reconcilePublications(
    [oldX],
    [],
    () => stale,
    () => {
      registrySnapshotAtStale = [...registry.values()];
      return [...registry.values()] as CloudflarePublication[];
    },
  );

  // While R40 is awaiting subscription I/O, R41 becomes authoritative:
  // the retained registry mutates BEFORE the stale check runs.
  registry.set(newY.trackName, newY);
  stale = true;
  releaseSubscribeX?.();

  await reconcilePromise;

  // Y must survive; X must NOT remain as a duplicate consumer
  assert.equal(client.publications.has("screen-Y"), true);
  assert.equal(client.publications.has("screen-X"), false);
  assert.equal(client.subscribedTrackNames.has("screen-Y"), true);
  assert.equal(client.subscribedTrackNames.has("screen-X"), false);
  // The convergence re-subscribes Y idempotently; X's subscription is gated
  // away and its publication is never retained.
  assert.ok(subscribeCalls.includes("screen-X"));
  assert.ok(subscribeCalls.includes("screen-Y"));
  // The lazy getter was evaluated at stale-detection time and saw the NEWEST
  // retained state - this is the exact caller-level ordering the frozen
  // values() snapshot could not provide.
  assert.deepEqual(registrySnapshotAtStale, [newY]);
  client.closeMedia();
});

test("stale mid-subscribe convergence treats an empty canonical state as authoritative", async () => {
  const client = session();
  client.sessionId = "cloudflare-session";
  client.subscriptionsStarted = true;
  const registry = new Map<string, unknown>();

  const oldX = {
    peerId: "peer-1",
    source: "screen",
    trackName: "screen-X",
    generation: 8,
    connectionEpoch: 1,
    userId: "user-1",
    closed: false,
  };

  let releaseSubscribeX: (() => void) | undefined;
  const gateX = new Promise<void>((resolve) => {
    releaseSubscribeX = resolve;
  });
  client.subscribe = async (publication) => {
    const trackName = String(publication.trackName);
    if (trackName === "screen-X") await gateX;
    return true;
  };

  interface NarrowedSession {
    reconcilePublications: (
      publications: CloudflarePublication[],
      removedPublications?: CloudflarePublication[],
      isStale?: () => boolean,
      getLatestCanonical?: () => CloudflarePublication[],
    ) => Promise<unknown>;
  }
  const sessionNarrowed = client as unknown as NarrowedSession;

  // R40 heartbeat starts reconciliation, inserts X, awaits subscribe(X)
  let stale = false;
  const reconcilePromise = sessionNarrowed.reconcilePublications(
    [oldX],
    [],
    () => stale,
    // The true newest retained state is EMPTY: the empty-set guard must NOT
    // block convergence, or X would be re-inserted as a ghost.
    () => [...registry.values()] as CloudflarePublication[],
  );

  // R41 close retires X: the retained registry is now empty before the stale
  // check runs.
  stale = true;
  releaseSubscribeX?.();

  await reconcilePromise;

  // X must be fully retired: the empty canonical snapshot must reach the
  // removal phase and delete the phanom insertion from the stale snapshot.
  assert.equal(client.publications.has("screen-X"), false);
  assert.equal(client.subscribedTrackNames.has("screen-X"), false);
  client.closeMedia();
});

function report(type, bytesField, bytes, timestamp) {
  return new Map([["rtp", { type, [bytesField]: bytes, timestamp }]]);
}

test("Cloudflare sessions without active media are ready after bootstrap", () => {
  const client = session();
  client.peerConnection = { connectionState: "new" };

  assert.equal(client.connectionState().ready, false);

  client.sessionId = "cloudflare-session";
  assert.deepEqual(client.connectionState(), {
    ready: true,
    send: "new",
    recv: "new",
    sendRequired: false,
    receiveRequired: false,
    connectionState: "new",
    iceConnectionState: "new",
    iceGatheringState: "new",
    signalingState: "new",
  });

  client.producers.set("audio", {});
  assert.equal(client.connectionState().ready, false);
  client.closeMedia();
});

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

test("Cloudflare screen consent does not rebind the remote track", async () => {
  let remoteTrackCallbacks = 0;
  const client = new CloudflareRealtimeSession({
    send() {},
    iceServers: [],
    onRemoteTrack: () => {
      remoteTrackCallbacks += 1;
    },
  });
  client.consumers.set("screen", {
    userId: "user-remote",
    source: "screen",
    receiving: false,
    track: { enabled: false },
  });

  await client.setRemoteReceiving("user-remote", "screen", true);

  assert.equal(remoteTrackCallbacks, 0);
  assert.equal(client.consumers.get("screen").track.enabled, true);
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
