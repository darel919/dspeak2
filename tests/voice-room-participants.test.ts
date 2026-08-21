import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeLocalVoiceParticipant,
  shouldRenderVoiceParticipant,
} from "../app/shared/voice-room-participants.ts";

test("connected local participant is projected when the connected-user map is empty", () => {
  const result = mergeLocalVoiceParticipant([], {
    connected: true,
    channelMatches: true,
    currentUser: { id: "local", display_name: "You" },
    muted: true,
    deafened: true,
    cameraEnabled: true,
    screenSharing: true,
  });

  assert.deepEqual(result, [
    {
      id: "local",
      display_name: "You",
      muted: true,
      deafened: true,
      cameraEnabled: true,
      screenSharing: true,
    },
  ]);
});

test("local participant is not projected outside the displayed connected channel", () => {
  const options = {
    connected: true,
    channelMatches: false,
    currentUser: { id: "local" },
    muted: false,
    deafened: false,
    cameraEnabled: false,
    screenSharing: false,
  };

  assert.deepEqual(mergeLocalVoiceParticipant([], options), []);
  assert.deepEqual(
    mergeLocalVoiceParticipant([], { ...options, connected: false }),
    [],
  );
});

test("existing users are preserved and the local ID is not duplicated", () => {
  const remote = { id: "remote", speaking: true };
  const local = { id: "local", display_name: "You", speaking: true };

  const result = mergeLocalVoiceParticipant([remote, local], {
    connected: true,
    channelMatches: true,
    currentUser: { id: "local", display_name: "Current user" },
    muted: true,
    deafened: false,
    cameraEnabled: false,
    screenSharing: false,
  });

  assert.equal(result.length, 2);
  assert.deepEqual(result[0], remote);
  assert.deepEqual(result[1], {
    id: "local",
    display_name: "You",
    speaking: true,
    muted: true,
    deafened: false,
    cameraEnabled: false,
    screenSharing: false,
  });
});

test("local participant renders even when a local feed represents the same user", () => {
  assert.equal(
    shouldRenderVoiceParticipant("local", new Set(["local"]), "local"),
    true,
  );
});

test("remote participants represented by feeds stay suppressed", () => {
  assert.equal(
    shouldRenderVoiceParticipant("remote", new Set(["remote"]), "local"),
    false,
  );
  assert.equal(
    shouldRenderVoiceParticipant("other", new Set(["remote"]), "local"),
    true,
  );
});
