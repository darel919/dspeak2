import assert from "node:assert/strict";
import test from "node:test";
import {
  createRoomTopology,
  RoomTopologyCoordinator,
  roomTopologyPayload,
  supersededMediaSessions,
} from "../server/utils/room-topology.js";
import { matchesPreparedActivation } from "../server/utils/media-transition.js";

function harness(peerCount) {
  const broadcasts = [];
  const timers = [];
  const setTimer = (callback, delay) => {
    const timer = { callback, delay, active: true };
    timers.push(timer);
    return timer;
  };
  const clearTimer = (timer) => {
    if (timer) timer.active = false;
  };
  const sessions = new Map();
  for (let index = 1; index <= peerCount; index += 1) {
    const id = `peer-${index}`;
    sessions.set(id, {
      peer: { id },
      userId: `user-${index}`,
      profile: { id: `user-${index}`, display_name: `User ${index}` },
      sources: new Set(["audio"]),
    });
  }
  const room = { sessions, topology: createRoomTopology() };
  const coordinator = new RoomTopologyCoordinator({
    broadcast: (target) =>
      broadcasts.push({
        mode: target.topology.mode,
        target: target.topology.target,
        epoch: target.topology.epoch,
        sourceRevision: target.topology.sourceRevision,
        reason: target.topology.reason,
        transitionFailure: target.topology.transitionFailure,
      }),
    setTimer,
    clearTimer,
  });
  return { room, coordinator, broadcasts, timers };
}

test("topology membership carries the authenticated participant profile", () => {
  const { room } = harness(1);
  assert.deepEqual(roomTopologyPayload(room).peers[0].profile, {
    id: "user-1",
    display_name: "User 1",
  });
});

test("a reconnect replaces only the same authenticated device", () => {
  const sessions = new Map([
    [
      "same-device",
      {
        peer: { id: "same-device" },
        userId: "user-1",
        deviceId: "device-1",
      },
    ],
    [
      "other-device",
      {
        peer: { id: "other-device" },
        userId: "user-1",
        deviceId: "device-2",
      },
    ],
    [
      "other-user",
      {
        peer: { id: "other-user" },
        userId: "user-2",
        deviceId: "device-1",
      },
    ],
  ]);
  const room = { sessions };

  assert.deepEqual(
    supersededMediaSessions(room, "user-1", "device-1").map(
      (session) => session.peer.id,
    ),
    ["same-device"],
  );
});

function qualifyCompleteMesh(room, coordinator) {
  const peerIds = [...room.sessions.keys()];
  const epoch = room.topology.epoch;
  for (const peerId of peerIds) {
    coordinator.p2pReady(
      room,
      peerId,
      peerIds.filter((candidate) => candidate !== peerId),
      epoch,
    );
  }
}

function acknowledgeAll(room, coordinator) {
  const event = {
    epoch: room.topology.epoch,
    target: room.topology.target,
    sourceRevision: room.topology.sourceRevision,
  };
  for (const peerId of room.sessions.keys())
    coordinator.clientReady(room, peerId, event);
}

test("activation identifies the exact transition epoch accepted by every client", () => {
  const { room, coordinator } = harness(2);
  coordinator.reconcile(room, "joined");
  const preparedEpoch = room.topology.epoch;
  acknowledgeAll(room, coordinator);

  assert.equal(room.topology.mode, "sfu");
  assert.equal(room.topology.preparedEpoch, preparedEpoch);
  assert.equal(room.topology.epoch, preparedEpoch + 1);
});

test("client accepts only the activation produced by its verified transition", () => {
  const prepared = { target: "sfu", epoch: 7, sourceRevision: 3 };
  assert.equal(
    matchesPreparedActivation(
      prepared,
      { preparedEpoch: 7, sourceRevision: 3 },
      "sfu",
    ),
    true,
  );
  assert.equal(
    matchesPreparedActivation(
      prepared,
      { preparedEpoch: 6, sourceRevision: 3 },
      "sfu",
    ),
    false,
  );
  assert.equal(
    matchesPreparedActivation(
      prepared,
      { preparedEpoch: 7, sourceRevision: 4 },
      "sfu",
    ),
    false,
  );
  assert.equal(
    matchesPreparedActivation(
      prepared,
      { preparedEpoch: 7, sourceRevision: 3 },
      "p2p",
    ),
    false,
  );
});

function runActiveTimer(timers, delay) {
  const timer = timers.find(
    (candidate) => candidate.active && candidate.delay === delay,
  );
  assert.ok(timer);
  timer.active = false;
  timer.callback();
}

function reachP2p(room, coordinator, timers) {
  coordinator.reconcile(room, "joined");
  assert.equal(room.topology.target, "sfu");
  acknowledgeAll(room, coordinator);
  runActiveTimer(timers, 3000);
  assert.equal(room.topology.mode, "probing");
  qualifyCompleteMesh(room, coordinator);
  assert.equal(room.topology.target, "p2p");
  acknowledgeAll(room, coordinator);
  assert.equal(room.topology.mode, "p2p");
}

test("one client establishes SFU without scheduling a direct upgrade", () => {
  const { room, coordinator, timers } = harness(1);
  coordinator.reconcile(room, "joined");
  assert.equal(room.topology.mode, "switching");
  assert.equal(room.topology.target, "sfu");
  assert.equal(room.topology.reason, "establishing-sfu");
  acknowledgeAll(room, coordinator);
  assert.equal(room.topology.mode, "sfu");
  assert.equal(
    timers.some((timer) => timer.active),
    false,
  );
});

test("two clients activate direct P2P only after complete qualification and handoff consensus", () => {
  const { room, coordinator, timers } = harness(2);
  reachP2p(room, coordinator, timers);
  assert.equal(room.topology.reason, "complete-direct-mesh");
});

test("two-device direct video keeps one resource-capped P2P sender", () => {
  const { room, coordinator, timers } = harness(2);
  reachP2p(room, coordinator, timers);
  room.sessions.get("peer-1").sources.add("screen");

  coordinator.sourcesChanged(room);

  assert.equal(room.topology.mode, "p2p");
  assert.equal(room.topology.target, null);
});

test("multi-peer video follows the normal SFU-first P2P qualification path", () => {
  const { room, coordinator, timers } = harness(3);
  room.sessions.get("peer-1").sources.add("screen");
  coordinator.reconcile(room, "joined");
  acknowledgeAll(room, coordinator);

  assert.equal(room.topology.mode, "sfu");
  assert.equal(
    timers.some((timer) => timer.active && timer.delay === 6000),
    true,
  );
});

test("video does not block background direct recovery", () => {
  const { room, coordinator, timers } = harness(2);
  room.sessions.get("peer-1").sources.add("camera");
  coordinator.reconcile(room, "joined");
  acknowledgeAll(room, coordinator);

  assert.equal(room.topology.mode, "sfu");
  assert.equal(
    timers.some((timer) => timer.active && timer.delay === 3000),
    true,
  );

  runActiveTimer(timers, 3000);
  assert.equal(room.topology.mode, "probing");
  qualifyCompleteMesh(room, coordinator);
  assert.equal(room.topology.target, "p2p");
  acknowledgeAll(room, coordinator);
  assert.equal(room.topology.mode, "p2p");
});

test("four clients require every directed mesh edge before activation", () => {
  const { room, coordinator, timers } = harness(4);
  coordinator.reconcile(room, "joined");
  acknowledgeAll(room, coordinator);
  runActiveTimer(timers, 10000);
  const peerIds = [...room.sessions.keys()];
  for (const peerId of peerIds.slice(0, 3)) {
    coordinator.p2pReady(
      room,
      peerId,
      peerIds.filter((candidate) => candidate !== peerId),
      room.topology.epoch,
    );
  }
  assert.equal(room.topology.mode, "probing");
  coordinator.p2pReady(
    room,
    peerIds[3],
    peerIds.slice(0, 3),
    room.topology.epoch,
  );
  assert.equal(room.topology.target, "p2p");
  acknowledgeAll(room, coordinator);
  assert.equal(room.topology.mode, "p2p");
});

test("five clients use SFU after all-client handoff consensus", () => {
  const { room, coordinator } = harness(5);
  coordinator.reconcile(room, "joined");
  assert.equal(room.topology.mode, "switching");
  assert.equal(room.topology.target, "sfu");
  acknowledgeAll(room, coordinator);
  assert.equal(room.topology.mode, "sfu");
  assert.equal(room.topology.reason, "participant-limit");
});

test("source changes restart a transition and reject stale readiness and failures", () => {
  const { room, coordinator } = harness(2);
  coordinator.reconcile(room, "joined");
  const stale = {
    epoch: room.topology.epoch,
    target: "sfu",
    sourceRevision: room.topology.sourceRevision,
  };
  coordinator.sourcesChanged(room);
  assert.equal(room.topology.reason, "media-sources-changed");
  assert.equal(coordinator.clientReady(room, "peer-1", stale), false);
  assert.equal(coordinator.clientFailed(room, stale), false);
  assert.equal(room.topology.mode, "switching");
});

test("source changes invalidate partial direct qualification", () => {
  const { room, coordinator, timers } = harness(3);
  coordinator.reconcile(room, "joined");
  acknowledgeAll(room, coordinator);
  runActiveTimer(timers, 6000);
  const staleEpoch = room.topology.epoch;
  const peerIds = [...room.sessions.keys()];
  coordinator.p2pReady(room, "peer-1", ["peer-2", "peer-3"], staleEpoch);
  assert.equal(room.topology.readiness.size, 1);

  coordinator.sourcesChanged(room);
  assert.ok(room.topology.epoch > staleEpoch);
  assert.equal(room.topology.readiness.size, 0);
  assert.equal(
    coordinator.p2pReady(room, "peer-2", ["peer-1", "peer-3"], staleEpoch),
    false,
  );
});

test("stale P2P failures cannot disrupt an active SFU route", () => {
  const { room, coordinator } = harness(5);
  coordinator.reconcile(room, "joined");
  acknowledgeAll(room, coordinator);
  const epoch = room.topology.epoch;
  assert.equal(coordinator.p2pFailed(room, "health-timeout", epoch), false);
  assert.equal(room.topology.mode, "sfu");
});

test("SFU recovery waits for a stable complete direct mesh before switching", () => {
  const { room, coordinator, timers } = harness(2);
  room.topology.p2pEverActivated = true;
  coordinator.beginTransition(room, "sfu", "direct-path-unavailable");
  acknowledgeAll(room, coordinator);
  const recovery = timers.find((timer) => timer.active && timer.delay === 3000);
  assert.ok(recovery);
  recovery.callback();
  assert.equal(room.topology.mode, "probing");
  qualifyCompleteMesh(room, coordinator);
  assert.equal(room.topology.mode, "probing");
  const activation = timers.find(
    (timer) => timer.active && timer.delay === 2000,
  );
  assert.ok(activation);
  activation.callback();
  assert.equal(room.topology.mode, "switching");
  assert.equal(room.topology.target, "p2p");
});

test("failed background direct recovery returns to the already-active SFU without another handoff", () => {
  const { room, coordinator, timers } = harness(2);
  room.topology.p2pEverActivated = true;
  coordinator.beginTransition(room, "sfu", "initial-direct-failure");
  acknowledgeAll(room, coordinator);
  timers.find((timer) => timer.active && timer.delay === 3000).callback();
  const recoveryEpoch = room.topology.epoch;
  assert.equal(room.topology.recovering, true);
  assert.equal(
    coordinator.p2pFailed(room, "qualification-timeout", recoveryEpoch),
    true,
  );
  assert.equal(room.topology.mode, "sfu");
  assert.equal(room.topology.target, null);
  assert.equal(
    room.topology.reason,
    "direct-path-unavailable-qualification-timeout",
  );
});

test("an active P2P failure still requires all-client SFU preparation", () => {
  const { room, coordinator, timers } = harness(2);
  reachP2p(room, coordinator, timers);
  assert.equal(room.topology.recovering, false);
  coordinator.p2pFailed(room, "ice-failed", room.topology.epoch);
  assert.equal(room.topology.mode, "switching");
  assert.equal(room.topology.target, "sfu");
  acknowledgeAll(room, coordinator);
  assert.equal(room.topology.reason, "direct-path-unavailable-ice-failed");
});

test("SFU preparation retries preserve the direct fallback cause", () => {
  const { room, coordinator, timers } = harness(2);
  reachP2p(room, coordinator, timers);
  coordinator.p2pFailed(room, "peer-connection-failed", room.topology.epoch);
  const failure = {
    epoch: room.topology.epoch,
    target: "sfu",
    sourceRevision: room.topology.sourceRevision,
    reason:
      "SFU media did not become ready for handoff (tracks 2/2, outbound 0/0, inbound 1/2)",
  };

  coordinator.clientFailed(room, failure);

  assert.equal(
    room.topology.reason,
    "direct-path-unavailable-peer-connection-failed",
  );
  assert.match(room.topology.transitionFailure, /^sfu-media-did-not-become/);
  runActiveTimer(timers, 1000);
  assert.equal(
    room.topology.reason,
    "direct-path-unavailable-peer-connection-failed",
  );
  assert.match(room.topology.transitionFailure, /^sfu-media-did-not-become/);
});

test("P2P membership changes return to SFU before qualifying the new mesh", () => {
  const { room, coordinator, timers } = harness(2);
  reachP2p(room, coordinator, timers);
  room.sessions.set("peer-3", {
    peer: { id: "peer-3" },
    userId: "user-3",
    sources: new Set(["audio"]),
  });

  coordinator.reconcile(room, "membership-changed");
  assert.equal(room.topology.mode, "switching");
  assert.equal(room.topology.target, "sfu");
  assert.equal(room.topology.reason, "membership-changed-stabilize-sfu");
});

test("an active SFU transport failure coordinates a fresh SFU session for every client", () => {
  const { room, coordinator } = harness(5);
  coordinator.reconcile(room, "joined");
  acknowledgeAll(room, coordinator);
  const activeEpoch = room.topology.epoch;

  assert.equal(
    coordinator.sfuFailed(room, "media-transport-failed", activeEpoch),
    true,
  );
  assert.equal(room.topology.mode, "switching");
  assert.equal(room.topology.target, "sfu");
  assert.match(room.topology.reason, /^sfu-path-unavailable-/);

  acknowledgeAll(room, coordinator);
  assert.equal(room.topology.mode, "sfu");
  assert.match(room.topology.reason, /^sfu-path-unavailable-/);
});

test("stale SFU failures cannot restart a newer topology epoch", () => {
  const { room, coordinator } = harness(5);
  coordinator.reconcile(room, "joined");
  acknowledgeAll(room, coordinator);
  const staleEpoch = room.topology.epoch;
  coordinator.beginTransition(room, "sfu", "scheduled-refresh");
  acknowledgeAll(room, coordinator);

  assert.equal(coordinator.sfuFailed(room, "late-failure", staleEpoch), false);
  assert.equal(room.topology.mode, "sfu");
});

test("five-to-four membership keeps SFU until a stable mesh qualifies", () => {
  const { room, coordinator, timers } = harness(5);
  coordinator.reconcile(room, "joined");
  acknowledgeAll(room, coordinator);
  room.sessions.delete("peer-5");

  coordinator.reconcile(room, "membership-changed");
  assert.equal(room.topology.mode, "sfu");
  runActiveTimer(timers, 10000);
  assert.equal(room.topology.mode, "probing");
  assert.equal(room.topology.recovering, true);
  qualifyCompleteMesh(room, coordinator);
  assert.equal(room.topology.target, "p2p");
  acknowledgeAll(room, coordinator);
  assert.equal(room.topology.mode, "p2p");
});
