import assert from "node:assert/strict";
import test from "node:test";
import {
  FATAL_CLIENT_ERROR_MESSAGE,
  isFatalClientError,
} from "../app/shared/fatal-client-error.js";

test("recognizes failures that require a page refresh", () => {
  assert.equal(
    isFatalClientError(
      new TypeError(
        "Failed to fetch dynamically imported module: /_nuxt/useMediasoupSfu.js",
      ),
    ),
    true,
  );
  assert.equal(isFatalClientError(new Error("Loading chunk 42 failed")), true);
  assert.equal(isFatalClientError({ name: "ChunkLoadError" }), true);
});

test("leaves recoverable device and connection errors contextual", () => {
  assert.equal(
    isFatalClientError(new Error("Microphone permission is required")),
    false,
  );
  assert.equal(isFatalClientError(new Error("Connection timed out")), false);
});

test("uses one stable user-facing fatal error message", () => {
  assert.equal(
    FATAL_CLIENT_ERROR_MESSAGE,
    "We encountered a fatal error and cannot recover. Please refresh the page.",
  );
});
