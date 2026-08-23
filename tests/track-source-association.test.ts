import assert from "node:assert/strict";
import test from "node:test";
import {
  TrackSourceAssociation,
  type TrackSourceAssociationRecord,
} from "../app/shared/track-source-association.ts";

function record(source: string): TrackSourceAssociationRecord {
  return { source, generation: 1, connectionEpoch: 4, ownerSource: null };
}

test("association registered before ontrack resolves immediately", () => {
  const registry = new TrackSourceAssociation();
  registry.associate("peer-a", "track-1", record("screen"));
  assert.equal(registry.lookupByTrack("peer-a", "track-1")?.source, "screen");
});

test("ontrack before metadata parks and resolves when association lands", async () => {
  const registry = new TrackSourceAssociation();
  let resolved: TrackSourceAssociationRecord | null = null;
  registry.park("peer-a", "track-2", "video", (value) => {
    /* SAFETY: the park callback receives exactly the stored association record. */
    resolved = value as TrackSourceAssociationRecord;
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(resolved, null);
  const outcome = registry.associate("peer-a", "track-2", record("camera"));
  assert.equal(outcome, "resolved");
  await Promise.resolve();
  assert.equal(resolved?.source, "camera");
});

test("dropPeer clears every association for that peer", () => {
  const registry = new TrackSourceAssociation();
  registry.associate("peer-a", "t1", record("camera"));
  registry.associate("peer-b", "t1", record("screen"));
  registry.dropPeer("peer-a");
  assert.equal(registry.lookupByTrack("peer-a", "t1"), null);
  assert.equal(registry.lookupByTrack("peer-b", "t1")?.source, "screen");
});
