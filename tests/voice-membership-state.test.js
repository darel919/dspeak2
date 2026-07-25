import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("transient media route health does not clear voice membership", async () => {
  const source = await readFile("app/stores/voice.js", "utf8");

  assert.doesNotMatch(
    source,
    /mediaConnectionState[\s\S]{0,300}connected\.value\s*=\s*false/,
  );
  assert.match(
    source,
    /async function leaveVoiceChannel[\s\S]*connected\.value\s*=\s*false/,
  );
  assert.match(
    source,
    /async function disposeFailedSession[\s\S]*connected\.value\s*=\s*false/,
  );
});
