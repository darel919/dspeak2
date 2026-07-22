import test from "node:test";
import assert from "node:assert/strict";
import { normalizeParticipantVoiceState } from "../shared/participant-voice-state.js";

test("participant voice state accepts explicit mute and deafen booleans", () => {
  assert.deepEqual(
    normalizeParticipantVoiceState({ muted: true, deafened: false }),
    { muted: true, deafened: false },
  );
});

test("participant voice state rejects partial and coerced values", () => {
  assert.equal(normalizeParticipantVoiceState({ muted: true }), null);
  assert.equal(
    normalizeParticipantVoiceState({ muted: "true", deafened: false }),
    null,
  );
});
