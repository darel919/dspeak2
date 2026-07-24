import test from "node:test";
import assert from "node:assert/strict";
import { setupMediaMessageHandlers } from "../app/shared/media-message-handlers.js";

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
