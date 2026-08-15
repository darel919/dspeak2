import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  FATAL_CLIENT_ERROR_MESSAGE,
  NATIVE_MEDIA_WORKER_FATAL_CODE,
  classifyFatalClientError,
  isFatalClientError,
  isNativeMediaWorkerFatalError,
  nativeMediaWorkerFatalDescriptor,
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
  assert.equal(descriptor?.title, "Media engine crashed");
  assert.match(descriptor?.message || "", /cannot recover in this session/);
  assert.equal(
    classifyFatalClientError("native media worker is not running"),
    null,
  );
});

test("native fatal descriptors preserve structured diagnostics without changing copy", () => {
  const details = { signal: 6, signalName: "SIGABRT" };
  const descriptor = nativeMediaWorkerFatalDescriptor(details);
  assert.deepEqual(descriptor.details, details);
  assert.equal(descriptor.recoveryAction, "restart-app");
  assert.equal(descriptor.recoveryLabel, "Restart dSpeak");
});

test("native worker fatal events are handled once at the app-global boundary", async () => {
  const plugin = await readFile(
    "app/plugins/fatal-client-error.client.ts",
    "utf8",
  );
  const recovery = await readFile(
    "app/composables/useFatalClientError.ts",
    "utf8",
  );
  assert.match(plugin, /listen\(\s*"media:error"/);
  assert.match(plugin, /isNativeMediaWorkerFatalError\(payload\)/);
  assert.match(plugin, /__DSPEAK_NATIVE_FATAL_LISTENER__/);
  assert.match(plugin, /listenerState\.handled/);
  assert.match(plugin, /Native crash evidence/);
  assert.match(plugin, /invalidateVoiceMediaState/);
  assert.match(plugin, /nuxtApp\.vueApp\.onUnmount\(dispose\)/);
  assert.doesNotMatch(plugin, /native media worker is not running/);
  assert.match(recovery, /invoke\("desktop_restart_app"\)/);
  assert.match(recovery, /shouldReplaceWithNativeFatal/);
});

test("uses one stable user-facing fatal error message", () => {
  assert.equal(
    FATAL_CLIENT_ERROR_MESSAGE,
    "We encountered a fatal error and cannot recover. Please refresh the page.",
  );
});
