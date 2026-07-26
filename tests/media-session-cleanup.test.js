import assert from "node:assert/strict";
import test from "node:test";
import { closeMediaProviders } from "../app/shared/media-session-cleanup.js";

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
