import test from "node:test";
import assert from "node:assert/strict";
import { setupMediaMessageHandlers } from "../app/shared/media-message-handlers.ts";

test("media state synchronizes only after the authenticated server acknowledgement", () => {
  const handlers = new Map();
  let localPeerId = null;
  let synchronizations = 0;

  setupMediaMessageHandlers({
    ensureP2p: () => null,
    getHeartbeatSequence: () => 0,
    getLastHeartbeatAckSequence: () => 0,
    getSfu: () => null,
    getSocket: () => null,
    lastInRoom: { value: [] },
    onServerConnected: () => {
      synchronizations += 1;
    },
    participantSfuRoundTripTimes: { value: {} },
    queueTopology: () => {},
    registerHandler: (type, handler) => handlers.set(type, handler),
    remoteProducersCount: { value: 0 },
    setHeartbeatAck: () => {},
    setLocalPeerId: (peerId) => {
      localPeerId = peerId;
    },
    sfuProducerIds: () => [],
    syncConnectedUsers: () => {},
    voiceStore: {
      updateUserVoiceState: () => {},
      upsertUserProfile: () => {},
    },
  });

  assert.equal(synchronizations, 0);
  handlers.get("connected")({ peerId: "peer-1" });
  assert.equal(localPeerId, "peer-1");
  assert.equal(synchronizations, 1);
});

test("producer snapshots are retained before SFU initialization", async () => {
  const handlers = new Map();
  const received = [];
  let sessionRequests = 0;
  const session = {
    handle: (type, data) => received.push([type, data]),
  };

  setupMediaMessageHandlers({
    ensureP2p: () => null,
    getHeartbeatSequence: () => 0,
    getLastHeartbeatAckSequence: () => 0,
    getSfu: () => {
      sessionRequests += 1;
      return session;
    },
    getSocket: () => null,
    lastInRoom: { value: [] },
    participantSfuRoundTripTimes: { value: {} },
    queueTopology: () => {},
    registerHandler: (type, handler) => handlers.set(type, handler),
    remoteProducersCount: { value: 0 },
    setHeartbeatAck: () => {},
    setLocalPeerId: () => {},
    sfuProducerIds: () => [],
    syncConnectedUsers: () => {},
    voiceStore: {
      updateUserVoiceState: () => {},
      upsertUserProfile: () => {},
    },
  });

  await handlers.get("available-producers")({ producers: ["producer-1"] });
  assert.equal(sessionRequests, 1);
  assert.deepEqual(received, [
    ["available-producers", { producers: ["producer-1"] }],
  ]);
});

test("listener attenuation acknowledgements reach the session owner", () => {
  const handlers = new Map();
  const reports = [];
  setupMediaMessageHandlers({
    ensureP2p: () => null,
    getHeartbeatSequence: () => 0,
    getLastHeartbeatAckSequence: () => 0,
    getSfu: () => null,
    getSocket: () => null,
    lastInRoom: { value: [] },
    onAttenuationState: (data) => reports.push(data),
    participantSfuRoundTripTimes: { value: {} },
    queueTopology: () => {},
    registerHandler: (type, handler) => handlers.set(type, handler),
    remoteProducersCount: { value: 0 },
    setHeartbeatAck: () => {},
    setLocalPeerId: () => {},
    sfuProducerIds: () => [],
    syncConnectedUsers: () => {},
    voiceStore: {
      updateUserVoiceState: () => {},
      upsertUserProfile: () => {},
    },
  });

  handlers.get("attenuation-state")({
    active: true,
    effectivePercent: 0,
    fromPeerId: "listener-1",
    source: "screen-audio",
  });
  assert.equal(reports.length, 1);
  assert.equal(reports[0].fromPeerId, "listener-1");
});

test("media worker shutdown closes only the SFU provider", () => {
  const handlers = new Map();
  let p2pClosed = false;
  let sfuClosed = false;
  let socketClosed = false;
  const p2p = {
    closeAll: () => {
      p2pClosed = true;
    },
  };
  const sfu = {
    close: () => {
      sfuClosed = true;
    },
  };

  setupMediaMessageHandlers({
    ensureP2p: () => p2p,
    getHeartbeatSequence: () => 0,
    getLastHeartbeatAckSequence: () => 0,
    getSfu: () => sfu,
    getSocket: () => ({
      close: () => {
        socketClosed = true;
      },
    }),
    lastInRoom: { value: [] },
    participantSfuRoundTripTimes: { value: {} },
    queueTopology: () => {},
    registerHandler: (type, handler) => handlers.set(type, handler),
    remoteProducersCount: { value: 0 },
    setHeartbeatAck: () => {},
    setLocalPeerId: () => {},
    sfuProducerIds: () => [],
    syncConnectedUsers: () => {},
    voiceStore: {
      updateUserVoiceState: () => {},
      upsertUserProfile: () => {},
    },
  });

  handlers.get("server-shutdown")();

  assert.equal(sfuClosed, true);
  assert.equal(socketClosed, true);
  assert.equal(p2pClosed, false);
});

test("route commits preserve the authoritative route epoch and mode", () => {
  const handlers = new Map();
  const queued = [];
  setupMediaMessageHandlers({
    ensureP2p: () => null,
    getHeartbeatSequence: () => 0,
    getLastHeartbeatAckSequence: () => 0,
    getSfu: () => null,
    getSocket: () => null,
    lastInRoom: { value: [] },
    participantSfuRoundTripTimes: { value: {} },
    queueTopology: (data) => queued.push(data),
    registerHandler: (type, handler) => handlers.set(type, handler),
    remoteProducersCount: { value: 0 },
    setHeartbeatAck: () => {},
    setLocalPeerId: () => {},
    sfuProducerIds: () => [],
    syncConnectedUsers: () => {},
    voiceStore: {
      updateUserVoiceState: () => {},
      upsertUserProfile: () => {},
    },
  });

  handlers.get("route-commit")({
    route: {
      kind: "sfu",
      provider: "mediasoup",
      epoch: 9,
      sourceRevision: 3,
    },
    mode: "sfu",
  });

  assert.deepEqual(queued[0], {
    route: {
      kind: "sfu",
      provider: "mediasoup",
      epoch: 9,
      sourceRevision: 3,
    },
    mode: "sfu",
    kind: "sfu",
    provider: "mediasoup",
    epoch: 9,
    sourceRevision: 3,
  });
});

test("topology rosters synchronize participants without legacy presence events", () => {
  const handlers = new Map();
  const synchronized = [];
  setupMediaMessageHandlers({
    ensureP2p: () => null,
    getHeartbeatSequence: () => 0,
    getLastHeartbeatAckSequence: () => 0,
    getSfu: () => null,
    getSocket: () => null,
    lastInRoom: { value: [] },
    participantSfuRoundTripTimes: { value: {} },
    queueTopology: () => {},
    registerHandler: (type, handler) => handlers.set(type, handler),
    remoteProducersCount: { value: 0 },
    setHeartbeatAck: () => {},
    setLocalPeerId: () => {},
    sfuProducerIds: () => [],
    syncConnectedUsers: (participants) => synchronized.push(participants),
    voiceStore: {
      updateUserVoiceState: () => {},
      upsertUserProfile: () => {},
    },
  });

  const peers = [
    { peerId: "peer-local", userId: "user-local", sources: [] },
    { peerId: "peer-remote", userId: "user-remote", sources: ["audio"] },
  ];
  handlers.get("topology-state")({ peers });
  handlers.get("route-commit")({ participants: peers });

  assert.deepEqual(synchronized, [peers, peers]);
});

test("P2P qualification acknowledgements retain their message kind", () => {
  const handlers = new Map();
  const acknowledgements = [];
  setupMediaMessageHandlers({
    ensureP2p: () => null,
    getHeartbeatSequence: () => 0,
    getLastHeartbeatAckSequence: () => 0,
    getSfu: () => null,
    getSocket: () => null,
    lastInRoom: { value: [] },
    onP2pQualification: (data) => acknowledgements.push(data),
    participantSfuRoundTripTimes: { value: {} },
    queueTopology: () => {},
    registerHandler: (type, handler) => handlers.set(type, handler),
    remoteProducersCount: { value: 0 },
    setHeartbeatAck: () => {},
    setLocalPeerId: () => {},
    sfuProducerIds: () => [],
    syncConnectedUsers: () => {},
    voiceStore: {
      updateUserVoiceState: () => {},
      upsertUserProfile: () => {},
    },
  });

  handlers.get("p2p-qualified")({ epoch: 5, acknowledged: true });
  handlers.get("p2p-failed")({ epoch: 5, reason: "timeout" });

  assert.deepEqual(
    acknowledgements.map(({ type, failed }) => ({ type, failed })),
    [
      { type: "p2p-qualified", failed: undefined },
      { type: "p2p-failed", failed: true },
    ],
  );
});

test("provider recovery notifications reach the media session", () => {
  const handlers = new Map();
  const notifications = [];
  setupMediaMessageHandlers({
    ensureP2p: () => null,
    getHeartbeatSequence: () => 0,
    getLastHeartbeatAckSequence: () => 0,
    getSfu: () => null,
    getSocket: () => null,
    lastInRoom: { value: [] },
    onProviderRecovering: (data) => notifications.push(data),
    participantSfuRoundTripTimes: { value: {} },
    queueTopology: () => {},
    registerHandler: (type, handler) => handlers.set(type, handler),
    remoteProducersCount: { value: 0 },
    setHeartbeatAck: () => {},
    setLocalPeerId: () => {},
    sfuProducerIds: () => [],
    syncConnectedUsers: () => {},
    voiceStore: {
      updateUserVoiceState: () => {},
      upsertUserProfile: () => {},
    },
  });

  handlers.get("provider-recovering")({ retryAt: 1234 });
  assert.deepEqual(notifications, [{ retryAt: 1234 }]);
});
