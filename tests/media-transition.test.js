import assert from "node:assert/strict";
import test from "node:test";
import {
  allClientsReady,
  hasCompleteMesh,
  membershipTopology,
  p2pRoutingPolicy,
  shouldAcceptTopologyEvent,
  topologyEventKey,
} from "../server/utils/media-transition.js";
import {
  allClientsReady as serverClientsReady,
  hasCompleteMesh as serverCompleteMesh,
  membershipTopology as serverMembershipTopology,
} from "../server/utils/media-transition.js";

test("membership topology enforces the four-device mesh limit", () => {
  assert.equal(membershipTopology(0), "idle");
  assert.equal(membershipTopology(1), "sfu");
  assert.equal(membershipTopology(2), "probing");
  assert.equal(membershipTopology(4), "probing");
  assert.equal(membershipTopology(5), "sfu");
});

test("P2P confidence decreases as the mesh gains participants", () => {
  assert.deepEqual(p2pRoutingPolicy(2), {
    recoveryDelayMs: 3000,
    stabilityDelayMs: 2000,
  });
  assert.deepEqual(p2pRoutingPolicy(3), {
    recoveryDelayMs: 6000,
    stabilityDelayMs: 4000,
  });
  assert.deepEqual(p2pRoutingPolicy(4), {
    recoveryDelayMs: 10000,
    stabilityDelayMs: 8000,
  });
});

test("complete mesh requires every directed peer report", () => {
  const peers = ["a", "b", "c"];
  const readiness = new Map([
    ["a", new Set(["b", "c"])],
    ["b", new Set(["a", "c"])],
    ["c", new Set(["a", "b"])],
  ]);
  assert.equal(hasCompleteMesh(peers, readiness), true);
  readiness.get("c").delete("b");
  assert.equal(hasCompleteMesh(peers, readiness), false);
});

test("transition consensus is tied to the current source revision", () => {
  const ready = new Map([
    ["a", 3],
    ["b", 3],
  ]);
  assert.equal(allClientsReady(["a", "b"], ready, 3), true);
  ready.set("b", 2);
  assert.equal(allClientsReady(["a", "b"], ready, 3), false);
});

test("topology keys distinguish source revisions and reject stale epochs", () => {
  assert.notEqual(
    topologyEventKey({
      epoch: 4,
      mode: "switching",
      target: "sfu",
      sourceRevision: 1,
    }),
    topologyEventKey({
      epoch: 4,
      mode: "switching",
      target: "sfu",
      sourceRevision: 2,
    }),
  );
  assert.equal(shouldAcceptTopologyEvent({ epoch: 3 }, 4), false);
  assert.equal(shouldAcceptTopologyEvent({ epoch: 4 }, 4), true);
});

test("client and server topology policies remain identical", () => {
  for (let count = 0; count <= 6; count++)
    assert.equal(serverMembershipTopology(count), membershipTopology(count));
  const peerIds = ["a", "b"];
  const complete = new Map([
    ["a", new Set(["b"])],
    ["b", new Set(["a"])],
  ]);
  assert.equal(
    serverCompleteMesh(peerIds, complete),
    hasCompleteMesh(peerIds, complete),
  );
  const readiness = new Map([
    ["a", 3],
    ["b", 3],
  ]);
  assert.equal(
    serverClientsReady(peerIds, readiness, 3),
    allClientsReady(peerIds, readiness, 3),
  );
});
