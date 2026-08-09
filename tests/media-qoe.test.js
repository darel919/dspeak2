import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createMediaQoeReport,
  mediaQoePathsFromStats,
  normalizeMediaPathMetrics,
  rankRouteCandidates,
  shouldMigrateForQoe,
} from "../shared/media-qoe.js";

describe("media QoE routing", () => {
  it("builds a normalized report from browser transport stats", () => {
    const report = createMediaQoeReport({
      provider: "mediasoup",
      epoch: 4,
      paths: mediaQoePathsFromStats({
        transports: [
          {
            id: "send",
            rttMs: 0.08,
            inboundAudio: { jitter: 0.004 },
            candidatePair: { packetLoss: 1 },
          },
        ],
      }),
    });

    assert.equal(report.provider, "mediasoup");
    assert.equal(report.epoch, 4);
    assert.equal(report.paths[0].rttMs, 80);
    assert.equal(report.paths[0].jitterMs, 4);
    assert.equal(report.paths[0].packetLossPercent, 1);
  });

  it("normalizes WebRTC seconds and fractions into provider-neutral metrics", () => {
    assert.deepEqual(
      normalizeMediaPathMetrics({
        routeId: "p2p-a",
        peerOrProvider: "peer-a",
        rttMs: 0.08,
        jitterMs: 0.004,
        fractionLost: 0.01,
        concealedAudioRatio: 0.02,
      }),
      {
        routeId: "p2p-a",
        peerOrProvider: "peer-a",
        rttMs: 80,
        jitterMs: 4,
        packetLossPercent: 1,
        jitterBufferDelayMs: null,
        availableOutgoingBitrate: null,
        concealedAudioRatio: 0.02,
        candidateType: null,
        protocol: null,
        sampledAt: null,
      },
    );
  });

  it("ranks viable candidates by worst participant latency before infrastructure cost", () => {
    const ranked = rankRouteCandidates([
      {
        id: "cloudflare",
        kind: "sfu",
        provider: "cloudflare-realtime",
        paths: [{ rttMs: 90, jitterMs: 6, packetLossPercent: 0.5 }],
        infrastructureCost: 1,
      },
      {
        id: "p2p",
        kind: "p2p",
        path: "direct",
        paths: [
          { rttMs: 40, jitterMs: 4, packetLossPercent: 0.2 },
          { rttMs: 130, jitterMs: 5, packetLossPercent: 0.2 },
        ],
        infrastructureCost: 0,
      },
    ]);

    assert.deepEqual(
      ranked.map((candidate) => candidate.id),
      ["cloudflare", "p2p"],
    );
  });

  it("requires a stable meaningful improvement unless the active route failed", () => {
    const now = 100_000;
    const active = { worstLatencyMs: 100, viable: true };
    assert.equal(
      shouldMigrateForQoe(
        active,
        { worstLatencyMs: 75, viable: true, stableSince: now - 9_999 },
        { now },
      ),
      false,
    );
    assert.equal(
      shouldMigrateForQoe(
        active,
        { worstLatencyMs: 75, viable: true, stableSince: now - 10_000 },
        { now },
      ),
      true,
    );
    assert.equal(
      shouldMigrateForQoe(
        { worstLatencyMs: 10, viable: false },
        { worstLatencyMs: 100, viable: true },
        { now },
      ),
      true,
    );
  });
});
