import assert from "node:assert/strict";
import test from "node:test";
import {
  FATAL_CLIENT_ERROR_MESSAGE,
  NATIVE_MEDIA_WORKER_FATAL_CODE,
  classifyFatalClientError,
  isFatalClientError,
  isNativeMediaWorkerFatalError,
} from "../app/shared/fatal-client-error.ts";

test("recognizes failures that require a page refresh", () => {
  assert.equal(
    isFatalClientError(
      new TypeError(
        "Failed to fetch dynamically imported module: /_nuxt/useMediasoupSfu.ts",
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
  assert.equal(
    isFatalClientError(new Error("native audio capture track is unavailable")),
    false,
  );
  assert.equal(
    classifyFatalClientError({ code: "DESKTOP_CAPTURE_TRACK_UNAVAILABLE" }),
    null,
  );
});

test("classifies native worker exits by structured code", () => {
  const payload = {
    code: NATIVE_MEDIA_WORKER_FATAL_CODE,
    source: "native-media-worker",
    message: "The native media worker exited unexpectedly",
    signal: 6,
  };
  const descriptor = classifyFatalClientError(payload);
  assert.equal(isNativeMediaWorkerFatalError(payload), true);
  assert.equal(descriptor?.kind, "native-media-worker");
  assert.equal(descriptor?.recoveryAction, "restart-app");
  assert.equal(descriptor?.recoveryLabel, "Restart dSpeak");
  assert.equal(descriptor?.code, NATIVE_MEDIA_WORKER_FATAL_CODE);
  assert.equal(
    classifyFatalClientError("native media worker is not running"),
    null,
  );
});

test("uses one stable user-facing fatal error message", () => {
  assert.equal(
    FATAL_CLIENT_ERROR_MESSAGE,
    "We encountered a fatal error and cannot recover. Please refresh the page.",
  );
});
