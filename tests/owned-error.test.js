import assert from "node:assert/strict";
import test from "node:test";
import { reconcileOwnedError } from "../app/shared/owned-error.js";

test("clears an owned media error after recovery", () => {
  const failed = reconcileOwnedError(null, null, "SFU media session closed");
  assert.deepEqual(failed, {
    error: "SFU media session closed",
    ownedError: "SFU media session closed",
  });

  assert.deepEqual(reconcileOwnedError(failed.error, failed.ownedError, null), {
    error: null,
    ownedError: null,
  });
});

test("does not clear a newer error owned by another voice operation", () => {
  assert.deepEqual(
    reconcileOwnedError(
      "Unable to access the camera",
      "SFU media session closed",
      null,
    ),
    { error: "Unable to access the camera", ownedError: null },
  );
});

test("replaces the previously owned media error", () => {
  assert.deepEqual(
    reconcileOwnedError(
      "Media signaling connection failed",
      "Media signaling connection failed",
      new Error("Initial media topology timed out"),
    ),
    {
      error: "Initial media topology timed out",
      ownedError: "Initial media topology timed out",
    },
  );
});
