import assert from "node:assert/strict";
import test from "node:test";
import {
  closeMediaProvider,
  closeMediaProviders,
  closeMediaProviderSafely,
} from "../app/shared/media-session-cleanup.ts";

test("remote media clears even when provider shutdown throws", () => {
  const operations = [];
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    closeMediaProviders({
      handoff: {
        clear() {
          operations.push("clear");
        },
      },
      getP2pMesh: () => ({
        closeAll() {
          operations.push("p2p");
          throw new Error("P2P close failed");
        },
      }),
      getSfu: () => ({
        close() {
          operations.push("sfu");
        },
      }),
    });
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(operations, ["clear", "p2p", "sfu"]);
});

test("browser SFU shutdown uses closeMedia before the native fallback", () => {
  const operations = [];
  closeMediaProvider({
    closeMedia() {
      operations.push("close-media");
    },
    close() {
      operations.push("close");
    },
  });
  assert.deepEqual(operations, ["close-media"]);
});

test("safe provider shutdown consumes asynchronous close failures", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await assert.doesNotReject(
      closeMediaProviderSafely(
        {
          closeMedia: async () => {
            throw new Error("close failed");
          },
        },
        "SFU",
      ),
    );
  } finally {
    console.warn = originalWarn;
  }
});
