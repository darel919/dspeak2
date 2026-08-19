import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createCloudflarePublicationRegistry } from "../app/shared/cloudflare-publication-registry.ts";

test("Cloudflare publications survive transport reconstruction", () => {
  const registry = createCloudflarePublicationRegistry();
  const publication = {
    trackName: "track-1",
    peerId: "peer-1",
    source: "screen",
  };

  assert.equal(registry.update(publication), true);
  assert.deepEqual(registry.values(), [publication]);
  assert.deepEqual(registry.values(), [publication]);
});

test("Cloudflare publication replacement and closure remove stale tracks", () => {
  const registry = createCloudflarePublicationRegistry();
  registry.update({
    trackName: "track-old",
    peerId: "peer-1",
    source: "screen",
  });
  const replacement = {
    trackName: "track-new",
    peerId: "peer-1",
    source: "screen",
  };
  registry.update(replacement);

  assert.deepEqual(registry.values(), [replacement]);
  registry.update({
    trackName: "track-old",
    peerId: "peer-1",
    source: "screen",
    connectionEpoch: 1,
    generation: 1,
    closed: true,
  });
  assert.deepEqual(registry.values(), [replacement]);
  registry.update({ ...replacement, closed: true });
  assert.deepEqual(registry.values(), []);
});

test("every Cloudflare activation path replays retained publications", async () => {
  const source = await readFile(
    new URL(
      "../app/shared/hybrid-media-topology-controller/controller.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const composable = await readFile(
    new URL("../app/composables/useHybridMediaSession.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /replayCloudflarePublications\(session\)/);
  assert.match(composable, /replayCloudflarePublications: async \(session\)/);
});

test("stale same-track heartbeat keeps the newer local incarnation in the canonical snapshot", () => {
  const registry = createCloudflarePublicationRegistry();
  const localNewer = {
    trackName: "track-X",
    peerId: "peer-1",
    source: "camera",
    connectionEpoch: 5,
    generation: 10,
  };
  registry.update(localNewer);

  const staleIncoming = {
    trackName: "track-X",
    peerId: "peer-1",
    source: "camera",
    connectionEpoch: 5,
    generation: 9,
  };

  const { canonicalSnapshot, removed } = registry.reconcileExact([
    staleIncoming,
  ]);

  assert.deepEqual(canonicalSnapshot, [localNewer]);
  assert.ok(!registry.values().includes(staleIncoming));
});

test("stale heartbeat with changed trackName cannot displace the same logical slot", () => {
  const registry = createCloudflarePublicationRegistry();
  const newerIncarnation = {
    trackName: "track-Y",
    peerId: "peer-1",
    source: "camera",
    connectionEpoch: 6,
    generation: 9,
  };
  registry.update(newerIncarnation);

  const staleOldTrack = {
    trackName: "track-X",
    peerId: "peer-1",
    source: "camera",
    connectionEpoch: 5,
    generation: 8,
  };

  const { canonicalSnapshot, removed } = registry.reconcileExact([
    staleOldTrack,
  ]);

  assert.deepEqual(canonicalSnapshot, [newerIncarnation]);
  assert.equal(
    registry.values().some((p) => p.trackName === "track-X"),
    false,
  );
  assert.equal(removed.length, 0);
});

test("reconcileExact retires publications absent from the server snapshot", () => {
  const registry = createCloudflarePublicationRegistry();
  const ghost = {
    trackName: "track-ghost",
    peerId: "peer-1",
    source: "screen",
    connectionEpoch: 2,
    generation: 3,
  };
  registry.update(ghost);

  const { canonicalSnapshot, removed } = registry.reconcileExact([]);

  assert.deepEqual(canonicalSnapshot, []);
  assert.deepEqual(removed, [ghost]);
  assert.deepEqual(registry.values(), []);
});

test("local mutation sequence never advances from server snapshots", () => {
  const registry = createCloudflarePublicationRegistry();
  const before = registry.getLocalMutationSequence();
  registry.reconcileExact([
    {
      trackName: "track-A",
      peerId: "peer-1",
      source: "camera",
      connectionEpoch: 1,
      generation: 1,
    },
    {
      trackName: "track-B",
      peerId: "peer-1",
      source: "screen",
      connectionEpoch: 1,
      generation: 1,
    },
  ]);
  const after = registry.getLocalMutationSequence();
  assert.ok(after >= before);
});
