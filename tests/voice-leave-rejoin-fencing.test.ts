import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("fast leave/rejoin fences stale joins with a monotonic generation", async () => {
  const source = await readFile("app/shared/voice-media-actions.ts", "utf8");

  const joinStart = source.indexOf("async function joinVoiceChannel");
  const joinEnd = source.indexOf(
    "function restorePersistedVoiceState",
    joinStart,
  );
  const join = source.slice(joinStart, joinEnd);

  assert.match(join, /const generation = \+\+joinGenerationState\.value/);
  assert.match(
    join,
    /if \(generation !== joinGenerationState\.value\)[\s\S]*VOICE_JOIN_CANCELLED/,
  );
  const fenceCount = (join.match(/ensureCurrentJoin\(\)/g) || []).length;
  assert.ok(
    fenceCount >= 5,
    `expected repeated liveness checks after awaits, found ${fenceCount}`,
  );
});

test("channel switch leaves the current session before joining the next channel", async () => {
  const source = await readFile("app/shared/voice-media-actions.ts", "utf8");

  const switchStart = source.indexOf(
    "if (connected.value && currentChannelId.value !== channelId)",
  );
  assert.ok(switchStart > 0);
  const block = source.slice(switchStart, switchStart + 220);

  assert.match(block, /await leaveVoiceChannel\(false\)/);
  assert.match(block, /ensureCurrentJoin\(\)/);
});

test("leave invalidates pending joins and disposes the live media session", async () => {
  const source = await readFile("app/shared/voice-media-actions.ts", "utf8");

  const leaveStart = source.indexOf("async function leaveVoiceChannel");
  const leaveEnd = source.indexOf("function restorePersistedVoiceState");
  const leave = source.slice(leaveStart, leaveEnd);

  assert.match(leave, /cancelPendingJoin\) joinGenerationState\.value \+= 1/);
  assert.match(leave, /await session\?\.disconnect\?\.\(\)/);
  const generationBump = leave.indexOf("joinGenerationState.value += 1");
  const disconnectCall = leave.indexOf("await session?.disconnect?.()");
  assert.ok(generationBump >= 0 && generationBump < disconnectCall);
});

test("fatal media errors invalidate the native runtime for every pending join", async () => {
  const source = await readFile("app/shared/voice-media-actions.ts", "utf8");

  const fatalStart = source.indexOf("function invalidateAfterFatalMediaError");
  const fatalEnd = source.indexOf("async function disposeFailedSession");
  const fatal = source.slice(fatalStart, fatalEnd);

  assert.match(fatal, /joinGenerationState\.value \+= 1/);
  assert.match(fatal, /nativeMediaInvalidated\.value = true/);
});
