import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { handleNativeTopology } from "../app/composables/media/native-media-engine-runtime.ts";

function createEngine(calls) {
  return {
    nativeTopologyKey: null,
    nativeProvider: "sfu",
    nativeSession: {
      selectedProvider: "cloudflare-realtime",
      activeSfuProvider: "cloudflare-realtime",
      activateProvider: async (provider) => calls.push(["provider", provider]),
      topologyState: null,
    },
    nativeP2pSession: {
      applyTopology: async (topology) => calls.push(["p2p", topology.mode]),
    },
    _syncNativeFeeds() {},
    _emit() {},
  };
}

describe("native media topology transitions", () => {
  it("keeps the active SFU alive while direct qualification is probing", async () => {
    const calls = [];
    const engine = createEngine(calls);

    await handleNativeTopology(engine, {
      mode: "probing",
      target: "p2p",
      provider: "cloudflare-realtime",
      epoch: 7,
      sourceRevision: 3,
      peers: [],
    });

    assert.deepEqual(calls, [["p2p", "probing"]]);
    assert.equal(engine.nativeProvider, "sfu");
  });

  it("only releases the SFU after the direct route is committed", async () => {
    const calls = [];
    const engine = createEngine(calls);

    await handleNativeTopology(engine, {
      mode: "p2p",
      epoch: 8,
      sourceRevision: 3,
      peers: [],
    });

    assert.deepEqual(calls, [
      ["p2p", "p2p"],
      ["provider", "mediasoup"],
    ]);
    assert.equal(engine.nativeProvider, "p2p");
  });

  it("waits for native SFU RTP before acknowledging an upgrade", async () => {
    const calls = [];
    const engine = createEngine(calls);
    const readiness = [
      {
        ready: false,
        outboundExpected: 1,
        outboundFlowing: 0,
        inboundExpected: 1,
        inboundFlowing: 0,
      },
      {
        ready: true,
        outboundExpected: 1,
        outboundFlowing: 1,
        inboundExpected: 1,
        inboundFlowing: 1,
      },
    ];
    engine.nativeSession.localPeerId = "local";
    engine.nativeSession.expectedInboundFlowCount = () => 1;
    engine.nativeSession.mediaReadiness = async () => {
      calls.push(["readiness"]);
      return readiness.shift();
    };
    engine.nativeSession.signaling = {
      send: (message) => calls.push(["signal", message]),
    };

    await handleNativeTopology(engine, {
      mode: "switching",
      target: "sfu",
      provider: "cloudflare-realtime",
      targetProvider: "cloudflare-realtime",
      targetProviderId: "cloudflare-primary",
      epoch: 9,
      sourceRevision: 4,
      localPeerId: "local",
      peers: [
        { peerId: "local", sources: ["audio"] },
        { peerId: "remote", sources: ["audio"] },
      ],
    });

    assert.equal(calls.filter(([type]) => type === "readiness").length, 2);
    assert.deepEqual(calls.at(-1), [
      "signal",
      {
        type: "topology-ready",
        data: {
          provider: "cloudflare-realtime",
          providerId: "cloudflare-primary",
          epoch: 9,
          target: "sfu",
          sourceRevision: 4,
        },
      },
    ]);
  });

  it("supersedes a slow native handoff before it can acknowledge the old route", async () => {
    const calls = [];
    const engine = createEngine(calls);
    engine.nativeSession.mediaReadiness = async () => ({
      ready: false,
      outboundExpected: 1,
      outboundFlowing: 0,
      inboundExpected: 1,
      inboundFlowing: 0,
    });
    engine.nativeSession.expectedInboundFlowCount = () => 1;
    engine.nativeSession.localPeerId = "local";
    const first = handleNativeTopology(engine, {
      mode: "switching",
      target: "sfu",
      provider: "cloudflare-realtime",
      epoch: 10,
      sourceRevision: 4,
      localPeerId: "local",
      peers: [
        { peerId: "local", sources: ["audio"] },
        { peerId: "remote", sources: ["audio"] },
      ],
    });
    await Promise.resolve();
    const second = handleNativeTopology(engine, {
      mode: "p2p",
      provider: "cloudflare-realtime",
      epoch: 11,
      sourceRevision: 4,
      localPeerId: "local",
      peers: [],
    });

    await Promise.all([first, second]);

    assert.equal(
      calls.some(
        ([type, message]) =>
          type === "signal" && message?.type === "topology-ready",
      ),
      false,
    );
    assert.equal(engine.nativeProvider, "p2p");
  });
});
