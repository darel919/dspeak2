import assert from "node:assert/strict";
import test from "node:test";
import {
  getVoicePresenceSnapshots,
  publishVoicePresence,
  subscribeToVoicePresence,
  unsubscribeFromVoicePresence,
} from "../server/utils/voice-presence.js";

test("voice presence publishes channel snapshots to room observers", () => {
  const roomId = `room-${Date.now()}-publish`;
  const messages = [];
  const peer = {
    send(payload) {
      messages.push(JSON.parse(payload));
    },
  };
  subscribeToVoicePresence(roomId, peer);

  publishVoicePresence(roomId, {
    channelId: "voice-one",
    inRoom: ["user-one"],
    profiles: [{ id: "user-one", display_name: "User One" }],
    participantStates: [{ userId: "user-one", muted: false }],
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, "voice-presence");
  assert.deepEqual(messages[0].data.inRoom, ["user-one"]);
  assert.equal(getVoicePresenceSnapshots(roomId)[0].channelId, "voice-one");
  unsubscribeFromVoicePresence(roomId, peer);
});

test("voice presence isolates observers by room", () => {
  const firstRoom = `room-${Date.now()}-first`;
  const secondRoom = `room-${Date.now()}-second`;
  let deliveries = 0;
  const peer = {
    send() {
      deliveries += 1;
    },
  };
  subscribeToVoicePresence(firstRoom, peer);
  publishVoicePresence(secondRoom, {
    channelId: "voice-two",
    inRoom: [],
    profiles: [],
    participantStates: [],
  });
  assert.equal(deliveries, 0);
  unsubscribeFromVoicePresence(firstRoom, peer);
});
