import assert from "node:assert/strict";
import test from "node:test";
import {
  mediaDebug,
  sanitizeMediaDebugValue,
  setMediaDebugEnabled,
} from "../app/shared/media-debug.js";

test("media debug output is enabled explicitly and redacts handshake secrets", () => {
  const previousDebug = console.debug;
  const previousFlag = globalThis.__DSPEAK_MEDIA_DEBUG__;
  const calls = [];
  console.debug = (...values) => calls.push(values);
  setMediaDebugEnabled(true);

  try {
    mediaDebug("handshake.test", {
      ticket: "provider-ticket",
      token: "media-token",
      authorization: "Bearer secret",
      sdp: "private-sdp",
      candidate: "private-candidate",
      nested: { password: "password" },
      safe: "visible",
    });
  } finally {
    console.debug = previousDebug;
    if (previousFlag === undefined) delete globalThis.__DSPEAK_MEDIA_DEBUG__;
    else globalThis.__DSPEAK_MEDIA_DEBUG__ = previousFlag;
  }

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 2), ["[Media]", "handshake.test"]);
  assert.deepEqual(calls[0][2], {
    ticket: "[redacted]",
    token: "[redacted]",
    authorization: "[redacted]",
    sdp: "[redacted]",
    candidate: "[redacted]",
    nested: { password: "[redacted]" },
    safe: "visible",
  });
  assert.equal(
    sanitizeMediaDebugValue({ secret: "hidden", safe: "visible" }).secret,
    "[redacted]",
  );
});
