import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeNativeInvokeError } from "../app/composables/media/native-media-engine-runtime.ts";

describe("native media invoke errors", () => {
  it("preserves structured worker details and exposes the native cause", () => {
    const error = normalizeNativeInvokeError(
      "media_p2p_set_remote_description",
      {
        code: "NATIVE_P2P_REMOTE_DESCRIPTION_FAILED",
        message: "native P2P remote description failed",
        details: {
          sdpType: "answer",
          nativeError: "Failed to set remote answer",
        },
      },
    ) as Error & {
      code?: string;
      details?: Record<string, unknown>;
      nativeCommand?: string;
    };

    assert.equal(
      error.message,
      "native P2P remote description failed: Failed to set remote answer",
    );
    assert.equal(error.code, "NATIVE_P2P_REMOTE_DESCRIPTION_FAILED");
    assert.equal(error.details?.sdpType, "answer");
    assert.equal(error.nativeCommand, "media_p2p_set_remote_description");
  });

  it("normalizes string worker failures without losing the command", () => {
    const error = normalizeNativeInvokeError(
      "media_set_camera",
      "native camera capture failed (error -220): camera permission was denied",
    ) as Error & { nativeCommand?: string };

    assert.equal(
      error.message,
      "native camera capture failed (error -220): camera permission was denied",
    );
    assert.equal(error.nativeCommand, "media_set_camera");
  });
});
