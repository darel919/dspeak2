import { describe, it } from "node:test";
import assert from "node:assert";
import { createMediaTopologyView } from "../app/shared/media-topology-view.js";

function makeView(overrides = {}) {
  const state = {
    mediaPathMetrics: { value: [] },
    peerRoundTripTimes: { value: {} },
    peerConnectionMetrics: { value: {} },
    topologyGraph: { value: null },
  };
  const edges = { value: [] };
  return {
    state,
    view: createMediaTopologyView({
      activeProvider: () => "p2p",
      addressFamily: () => "ipv4",
      buildTopologyGraph: (input) => input,
      consumers: { value: new Map() },
      getLocalPeerId: () => "me",
      getP2pEdges: () => edges.value,
      getP2pMesh: () => null,
      getSfu: () => null,
      mapPeerConnectionMetrics: () => state.peerConnectionMetrics.value,
      mapPeerRoundTripTimes: () => state.peerRoundTripTimes.value,
      mediaPathMetrics: state.mediaPathMetrics,
      participantSfuRoundTripTimes: { value: {} },
      peerConnectionMetrics: state.peerConnectionMetrics,
      peerRoundTripTimes: state.peerRoundTripTimes,
      producers: { value: new Map() },
      consumers: { value: new Map() },
      setP2pEdges: (next) => {
        edges.value = next;
      },
      topologyGraph: state.topologyGraph,
      topologyState: {
        value: {
          mode: "p2p",
          peers: [{ peerId: "peer1", userId: "user1" }],
        },
      },
      voiceStore: {
        isUserConnected: () => true,
        addConnectedUser: () => {},
        removeConnectedUser: () => {},
        getConnectedUsersArray: () => [],
      },
      ...overrides,
    }),
  };
}

describe("media-topology-view", () => {
  it("updateP2pStats emits normalized MediaPathMetrics per edge", () => {
    const { view, state } = makeView();
    view.updateP2pStats([
      {
        peerId: "peer1",
        rtt: 42,
        jitter: 0.015,
        packetLoss: 0.2,
        candidatePair: {
          local: { candidateType: "srflx", protocol: "udp" },
        },
      },
    ]);

    assert.strictEqual(state.mediaPathMetrics.value.length, 1);
    const metrics = state.mediaPathMetrics.value[0];
    assert.strictEqual(metrics.routeId, "p2p:peer1");
    assert.strictEqual(metrics.peerOrProvider, "peer1");
    assert.strictEqual(metrics.rttMs, 42);
    assert.strictEqual(metrics.jitterMs, 15);
    assert.strictEqual(metrics.packetLossPercent, 0.2);
    assert.strictEqual(metrics.candidateType, "srflx");
    assert.strictEqual(metrics.protocol, "udp");
    assert.ok(metrics.sampledAt > 0);
  });

  it("skips edges without a peer id", () => {
    const { view, state } = makeView();
    view.updateP2pStats([{ rtt: 42 }, { peerId: "peer1", rtt: 50 }]);
    assert.strictEqual(state.mediaPathMetrics.value.length, 1);
    assert.strictEqual(state.mediaPathMetrics.value[0].peerOrProvider, "peer1");
  });

  it("leaves mediaPathMetrics untouched when not provided", () => {
    const { view } = makeView();
    const fallback = makeView({
      mediaPathMetrics: undefined,
    });
    fallback.view.updateP2pStats([{ peerId: "peer1", rtt: 50 }]);
    assert.strictEqual(fallback.state.mediaPathMetrics.value.length, 0);
  });
});
