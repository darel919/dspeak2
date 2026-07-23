import assert from "node:assert/strict";
import test from "node:test";
import {
  VOICE_CONNECTION_ERROR_MESSAGE,
  voiceJoinErrorMessage,
} from "../app/shared/voice-errors.js";

test("hides request paths and transport details from voice connection errors", () => {
  const error = new TypeError(
    '[GET] "/dspeak/config": <no response> Failed to fetch',
  );

  assert.equal(voiceJoinErrorMessage(error), VOICE_CONNECTION_ERROR_MESSAGE);
  assert.doesNotMatch(voiceJoinErrorMessage(error), /dspeak|config|fetch/i);
});

test("preserves actionable microphone guidance", () => {
  assert.equal(
    voiceJoinErrorMessage(
      new Error("Microphone permission is required to join the room"),
    ),
    "Microphone permission is required to join the room",
  );
  assert.equal(
    voiceJoinErrorMessage(
      new Error("Microphone access is not supported by this browser"),
    ),
    "Microphone access is not supported by this browser",
  );
});

test("uses the stable voice message for unknown thrown values", () => {
  assert.equal(
    voiceJoinErrorMessage({ endpoint: "https://internal.example.test/socket" }),
    VOICE_CONNECTION_ERROR_MESSAGE,
  );
});
