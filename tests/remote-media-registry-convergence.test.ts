import assert from "node:assert/strict";
import test from "node:test";
import {
  RemoteMediaRegistry,
  type RemoteMediaRegistryOptions,
} from "../app/shared/remote-media-registry.ts";
import type { Ref } from "vue";
import type { RemoteMediaEntry } from "../app/shared/types/hybrid-media-registry.ts";

type FakeVideoTrack = {
  id: string;
  kind: "video";
  enabled: boolean;
};

function createVideoRegistry(
  options: Partial<RemoteMediaRegistryOptions> = {},
) {
  const videoFeeds = {
    value: new Map<string, RemoteMediaEntry>(),
  } as unknown as Ref<Map<string, RemoteMediaEntry>>;
  const audioFeeds = {
    value: new Map<string, RemoteMediaEntry>(),
  } as unknown as Ref<Map<string, RemoteMediaEntry>>;
  const registry = new RemoteMediaRegistry({
    audioFeeds,
    videoFeeds,
    getVolume: () => 1,
    getOutputDevice: () => null,
    isDeafened: () => false,
    isBroadcastMode: () => false,
    onSpeaking: () => {},
    ...options,
  } as RemoteMediaRegistryOptions);
  return { registry, videoFeeds };
}

function stream(track: FakeVideoTrack) {
  const tracks = [track];
  return {
    getTracks: () => [...tracks],
    removeTrack: (current: FakeVideoTrack) =>
      tracks.splice(tracks.indexOf(current), 1),
    addTrack: (current: FakeVideoTrack) => tracks.push(current),
  } as unknown as MediaStream;
}

function entry(overrides: Partial<RemoteMediaEntry> = {}): RemoteMediaEntry {
  const track = (overrides.track as FakeVideoTrack | undefined) || {
    id: "track-a",
    kind: "video" as const,
    enabled: true,
  };
  return {
    key: "remote:user-1:camera",
    provider: "sfu",
    userId: "user-1",
    peerId: "peer-1",
    source: "camera",
    track: track as unknown as MediaStreamTrack,
    stream: overrides.stream || stream(track),
    consumerId: "consumer-a",
    connectionEpoch: 4,
    sourceGeneration: 12,
    ...overrides,
  } as RemoteMediaEntry;
}

test("registry bind reaches transport-connected for a real remote track", () => {
  const { registry } = createVideoRegistry();
  const current = entry();
  registry.bind(current);
  const state = registry.getConvergenceState(current.key);
  assert.ok(state);
  assert.equal(state.phase, "transport-connected");
  assert.equal(state.incarnation.provider, "sfu");
  assert.equal(state.incarnation.consumerId, "consumer-a");
});

test("frame-first evidence is retained until RTP progression", () => {
  const { registry } = createVideoRegistry();
  const current = entry();
  registry.bind(current);
  const token = registry.getConvergenceState(current.key)?.incarnation
    .receiverIncarnationId;
  assert.ok(token);
  assert.equal(registry.markFirstFrame(current.key, token), true);
  assert.equal(
    registry.getConvergenceState(current.key)?.phase,
    "transport-connected",
  );
  registry.updateRtpStats(current.key, token, {
    bytesReceived: 1000,
    packetsReceived: 10,
    framesDecoded: 1,
  });
  registry.updateRtpStats(current.key, token, {
    bytesReceived: 2000,
    packetsReceived: 20,
    framesDecoded: 2,
  });
  assert.equal(registry.getConvergenceState(current.key)?.phase, "renderable");
});

test("RTP-first evidence reaches renderable after first frame", () => {
  const { registry } = createVideoRegistry();
  const current = entry();
  registry.bind(current);
  const token = registry.getConvergenceState(current.key)?.incarnation
    .receiverIncarnationId;
  assert.ok(token);
  registry.updateRtpStats(current.key, token, {
    bytesReceived: 1000,
    packetsReceived: 10,
    framesDecoded: 1,
  });
  registry.updateRtpStats(current.key, token, {
    bytesReceived: 2000,
    packetsReceived: 20,
    framesDecoded: 2,
  });
  assert.equal(registry.getConvergenceState(current.key)?.phase, "rtp-flowing");
  assert.equal(registry.markFirstFrame(current.key, token), true);
  assert.equal(registry.getConvergenceState(current.key)?.phase, "renderable");
});

test("old stats and frame evidence cannot mutate a replacement receiver", () => {
  const { registry, videoFeeds } = createVideoRegistry();
  const oldEntry = entry();
  registry.bind(oldEntry);
  const oldToken = registry.getConvergenceState(oldEntry.key)?.incarnation
    .receiverIncarnationId;
  assert.ok(oldToken);
  const replacement = entry({
    track: {
      id: "track-b",
      kind: "video",
      enabled: true,
    } as unknown as MediaStreamTrack,
    consumerId: "consumer-b",
  });
  registry.bind(replacement);
  assert.equal(
    registry.updateRtpStats(oldEntry.key, oldToken, {
      bytesReceived: 10000,
      packetsReceived: 100,
      framesDecoded: 10,
    }),
    false,
  );
  assert.equal(registry.markFirstFrame(oldEntry.key, oldToken), false);
  assert.equal(videoFeeds.value.get(oldEntry.key)?.consumerId, "consumer-b");
  assert.equal(
    registry.getConvergenceState(oldEntry.key)?.rtpEvidence.lastRtpSampleAt,
    null,
  );
});

test("old recovery completion cannot mutate a replacement receiver", async () => {
  let resolveRecovery: ((value: boolean) => void) | null = null;
  const { registry } = createVideoRegistry({
    onReceiverRecovery: () =>
      new Promise<boolean>((resolve) => {
        resolveRecovery = resolve;
      }),
  });
  const oldEntry = entry();
  registry.bind(oldEntry);
  const oldToken = registry.getConvergenceState(oldEntry.key)?.incarnation
    .receiverIncarnationId;
  assert.ok(oldToken);
  const oldState = registry.getConvergenceState(oldEntry.key);
  assert.ok(oldState);
  oldState.stallState.recoveryAttempt = 1;
  const recovery = registry.runReceiverRecovery(oldEntry.key, oldToken);
  registry.bind(entry({ consumerId: "consumer-replacement" }));
  const finishRecovery = resolveRecovery as unknown as (value: boolean) => void;
  finishRecovery(false);
  await recovery;
  assert.equal(
    registry.getConvergenceState(oldEntry.key)?.incarnation.consumerId,
    "consumer-replacement",
  );
  assert.equal(
    registry.getConvergenceState(oldEntry.key)?.phase,
    "transport-connected",
  );
});

test("provider handoff resets evidence when authority stays unchanged", () => {
  const { registry } = createVideoRegistry();
  const p2p = entry({
    provider: "p2p",
    consumerId: undefined,
    receiverIncarnationId: undefined,
  });
  registry.bind(p2p);
  const p2pToken = registry.getConvergenceState(p2p.key)?.incarnation
    .receiverIncarnationId;
  assert.ok(p2pToken);
  registry.updateRtpStats(p2p.key, p2pToken, {
    bytesReceived: 1000,
    packetsReceived: 10,
    framesDecoded: 1,
  });
  registry.updateRtpStats(p2p.key, p2pToken, {
    bytesReceived: 2000,
    packetsReceived: 20,
    framesDecoded: 2,
  });
  registry.markFirstFrame(p2p.key, p2pToken);
  assert.equal(registry.getConvergenceState(p2p.key)?.phase, "renderable");
  const sfu = entry({
    provider: "sfu",
    consumerId: "consumer-sfu",
    receiverIncarnationId: undefined,
  });
  registry.bind(sfu);
  const state = registry.getConvergenceState(sfu.key);
  assert.ok(state);
  assert.notEqual(state.incarnation.receiverIncarnationId, p2pToken);
  assert.equal(state.phase, "transport-connected");
  assert.equal(state.rtpEvidence.lastRtpProgressAt, null);
  assert.equal(state.firstFrameEvidence.received, false);
});

test("normal operation samples receiver stats without diagnostics", async () => {
  let sampleCount = 0;
  const { registry } = createVideoRegistry({
    getReceiverStats: async () => {
      sampleCount += 1;
      return {
        bytesReceived: sampleCount * 1000,
        packetsReceived: sampleCount * 10,
        framesDecoded: sampleCount,
      };
    },
  });
  const current = entry();
  registry.bind(current);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(sampleCount >= 1);
  assert.ok(
    registry.getConvergenceState(current.key)?.rtpEvidence.lastRtpSampleAt,
  );
  registry.clear();
});

test("receiver stats rejection does not wedge the health sampler", async () => {
  const { registry } = createVideoRegistry({
    getReceiverStats: async () => {
      throw new Error("stats unavailable");
    },
  });
  registry.bind(entry());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(registry.receiverHealthRunning, false);
  registry.clear();
});
