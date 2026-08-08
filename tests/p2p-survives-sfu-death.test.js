import { describe, it, mock } from "node:test";
import assert from "node:assert";

describe("Phase 8: P2P survives SFU death", () => {
  it("closeMediaProviders clears handoff before closing providers, P2P stays alive", async () => {
    const { closeMediaProviders } =
      await import("../app/shared/media-session-cleanup.js");

    let handoffCleared = false;
    let p2pClosed = false;
    let sfuClosed = false;
    let handoffClearedBeforeClose = true;

    const handoff = {
      clear() {
        handoffCleared = true;
        if (p2pClosed || sfuClosed) handoffClearedBeforeClose = false;
      },
    };

    const getP2pMesh = () => ({
      closeAll() {
        p2pClosed = true;
        if (!handoffCleared) handoffClearedBeforeClose = false;
      },
    });

    const getSfu = () => ({
      close() {
        sfuClosed = true;
        if (!handoffCleared) handoffClearedBeforeClose = false;
      },
    });

    closeMediaProviders({ getP2pMesh, getSfu, handoff });

    assert.ok(handoffCleared, "handoff must be cleared");
    assert.ok(
      handoffClearedBeforeClose,
      "handoff must clear before providers close",
    );
  });

  it("disconnect() stops audio playback before risky I/O even on throw", async () => {
    const { closeMediaProviders } =
      await import("../app/shared/media-session-cleanup.js");

    const handoff = { clear: mock.fn() };
    const p2pMesh = {
      closeAll: mock.fn(() => {
        throw new Error("P2P close failed");
      }),
    };
    const sfu = {
      close: mock.fn(() => {
        throw new Error("SFU close failed");
      }),
    };
    const getP2pMesh = () => p2pMesh;
    const getSfu = () => sfu;

    closeMediaProviders({ getP2pMesh, getSfu, handoff });

    assert.ok(handoff.clear.mock.callCount() === 1, "handoff.clear called");
    assert.ok(p2pMesh.closeAll.mock.callCount() === 1, "P2P closeAll called");
    assert.ok(sfu.close.mock.callCount() === 1, "SFU close called");
  });
});
