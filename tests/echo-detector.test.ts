import assert from "node:assert/strict";
import test from "node:test";
import { createEchoDetector } from "../app/shared/echo-detector.ts";

test("echo detection reports sustained microphone activity during remote speech", () => {
  const reports = [];
  const detector = createEchoDetector({
    onDetected: (detected) => reports.push(detected),
  });
  for (let index = 0; index < 10; index += 1) {
    detector.sample({
      active: true,
      echoCancellation: false,
      remoteSpeaking: true,
    });
  }
  assert.deepEqual(reports, [true]);
  detector.clear();
  assert.deepEqual(reports, [true, false]);
});

test("echo detection ignores activity when cancellation or remote speech is absent", () => {
  const reports = [];
  const detector = createEchoDetector({
    onDetected: (detected) => reports.push(detected),
  });
  for (let index = 0; index < 12; index += 1) {
    detector.sample({
      active: true,
      echoCancellation: index < 6,
      remoteSpeaking: index >= 6,
    });
  }
  assert.deepEqual(reports, []);
});
