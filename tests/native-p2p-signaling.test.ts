import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { receiveSignal } from "../app/shared/native-p2p-signaling.ts";

describe("browser P2P signaling", () => {
  it("buffers a signal for a peer that is not connected yet", async () => {
    const pending = [];
    const mesh = {
      epoch: 4,
      connections: new Map(),
      queuePendingSignal(payload) {
        pending.push(payload);
        return true;
      },
    };
    const payload = {
      fromPeerId: "peer-b",
      epoch: 4,
      signal: { candidate: { candidate: "candidate" } },
    };

    assert.equal(await receiveSignal(mesh, payload), true);
    assert.deepEqual(pending, [payload]);
  });

  it("rejects stale signals without buffering them", async () => {
    const pending = [];
    const mesh = {
      epoch: 4,
      connections: new Map(),
      queuePendingSignal(payload) {
        pending.push(payload);
        return true;
      },
    };

    assert.equal(
      await receiveSignal(mesh, {
        fromPeerId: "peer-b",
        epoch: 3,
        signal: { candidate: { candidate: "stale" } },
      }),
      false,
    );
    assert.deepEqual(pending, []);
  });
});
