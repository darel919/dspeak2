import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyP2pVideoCodecPreferences } from "../app/shared/native-p2p-common.ts";
import { receiveSignal } from "../app/shared/native-p2p-signaling.ts";

function capabilities(codecs: string[]) {
  const entries = Object.fromEntries(
    ["H264", "H265", "VP8", "VP9", "AV1"].map((codec) => [
      codec,
      {
        encode: {
          supported: codecs.includes(codec),
          acceleration: codecs.includes(codec) ? "hardware" : "unsupported",
          realtimeEfficiency: codecs.includes(codec) ? "excellent" : "unusable",
        },
        decode: {
          supported: codecs.includes(codec),
          acceleration: codecs.includes(codec) ? "hardware" : "unsupported",
          realtimeEfficiency: codecs.includes(codec) ? "excellent" : "unusable",
        },
      },
    ]),
  );
  return {
    videoCodecs: entries,
    concurrentEncode: { supported: true, maxHardwareSessions: 2 },
  };
}

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

  it("records a remote codec matrix and selects the efficient P2P pair", async () => {
    const state = {
      peerId: "peer-b",
      userId: "user-b",
      pc: { connectionState: "new" },
      closed: false,
      signalingOperation: null,
      signalingPhase: null,
      polite: false,
      negotiationRequested: false,
      capabilityWaitTimer: null,
    };
    const mesh = {
      epoch: 4,
      connections: new Map([["peer-b", state]]),
      mediaCapabilities: capabilities(["H264", "VP8"]),
    };

    assert.equal(
      await receiveSignal(mesh, {
        fromPeerId: "peer-b",
        epoch: 4,
        signal: { capabilities: { mediaCapabilities: capabilities(["H264"]) } },
      }),
      true,
    );
    assert.equal(state.selectedCodec, "H264");
    assert.equal(
      state.remoteMediaCapabilities.videoCodecs.H264.decode.supported,
      true,
    );
  });

  it("filters browser P2P preferences to the selected codec while retaining RTX", () => {
    const previousReceiver = globalThis.RTCRtpReceiver;
    const calls = [];
    globalThis.RTCRtpReceiver = {
      getCapabilities: () => ({
        codecs: [
          { mimeType: "video/VP8" },
          { mimeType: "video/H264" },
          { mimeType: "video/rtx" },
        ],
      }),
    } as never;
    try {
      const pc = {
        getTransceivers: () => [
          {
            sender: { track: { kind: "video" } },
            receiver: { track: null },
            setCodecPreferences: (preferences) => calls.push(preferences),
          },
        ],
      };
      assert.equal(applyP2pVideoCodecPreferences(pc, ["H264"]), true);
      assert.deepEqual(
        calls[0].map((codec) => codec.mimeType),
        ["video/H264", "video/rtx"],
      );
    } finally {
      globalThis.RTCRtpReceiver = previousReceiver;
    }
  });
});
