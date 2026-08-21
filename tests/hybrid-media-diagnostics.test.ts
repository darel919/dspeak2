import assert from "node:assert/strict";
import test from "node:test";
import { ref } from "vue";
import { createHybridMediaDiagnostics } from "../app/shared/hybrid-media-diagnostics.ts";
import { collectRtpStats } from "../app/shared/rtc-media-stats.ts";
import { outboundSourceHasFlow } from "../app/shared/media-source-flow.ts";
import { FakeMediaStreamTrack } from "./helpers/fake-media.ts";

function createReport(trackId: string, bytesSent: number) {
  return new Map([
    [
      "audio-source",
      {
        id: "audio-source",
        type: "media-source",
        kind: "audio",
        trackIdentifier: trackId,
      },
    ],
    [
      "audio-rtp",
      {
        id: "audio-rtp",
        type: "outbound-rtp",
        kind: "audio",
        trackId: "audio-source",
        mid: "0",
        bytesSent,
        packetsSent: 12,
        timestamp: 2_000,
      },
    ],
  ]);
}

function createDiagnostics({
  activeProvider,
  mode,
  targetTransport,
  sfuReport,
  p2pReport,
}: {
  activeProvider: string | null;
  mode: string;
  targetTransport?: "p2p" | "sfu" | null;
  sfuReport?: Map<string, Record<string, unknown>>;
  p2pReport?: Map<string, Record<string, unknown>>;
}) {
  const track = new FakeMediaStreamTrack("audio", "microphone-track");
  const diagnostics = createHybridMediaDiagnostics({
    collectRtpStats,
    getActiveProvider: () => activeProvider,
    getActiveRouteProvider: () => "cloudflare-realtime",
    getAudioLatencySnapshot: () => ({}),
    getP2pMesh: () =>
      p2pReport
        ? {
            getOutboundTrackStats: async () => p2pReport,
          }
        : null,
    getRequestedVideoSettings: () => ({ frameRate: 30 }),
    getLifecycle: () => null,
    getProtocolState: () => null,
    getReadiness: () => null,
    getSfu: () =>
      sfuReport
        ? {
            producers: new Map([
              [
                "audio",
                {
                  producer: { getStats: async () => sfuReport },
                  track,
                  mid: "0",
                },
              ],
            ]),
          }
        : null,
    localSources: new Map([["audio", { source: "audio", track }]]),
    playbackState: ref("ready"),
    peerRoundTripTimes: ref({}),
    remoteAudioFeeds: ref(new Map()),
    refreshTopologyGraph: () => {},
    remoteVideoFeeds: ref(new Map()),
    send: () => undefined,
    sfuRoundTripTime: ref(null),
    topologyGraph: ref({ topology: {}, nodes: [], edges: [] }),
    topologyState: ref({ mode, epoch: 1, targetTransport, peers: [] }),
    updateP2pStats: () => undefined,
    rtpStatsSamples: new Map(),
  });

  return { diagnostics, track };
}

test("staged SFU outbound audio remains visible before provider commit", async () => {
  const { diagnostics } = createDiagnostics({
    activeProvider: null,
    mode: "switching",
    targetTransport: "sfu",
    sfuReport: createReport("microphone-track", 480),
  });

  const stats = await diagnostics.getOutboundRtpStats();

  assert.equal(outboundSourceHasFlow(stats, "audio"), true);
  assert.equal(stats[0]?.source, "audio");
  assert.equal(stats[0]?.bytesSent, 480);
});

test("committed P2P outbound audio remains authoritative over staged SFU stats", async () => {
  const { diagnostics } = createDiagnostics({
    activeProvider: "p2p",
    mode: "switching",
    targetTransport: "sfu",
    sfuReport: createReport("microphone-track", 480),
    p2pReport: createReport("microphone-track", 240),
  });

  const stats = await diagnostics.getOutboundRtpStats();

  assert.equal(stats[0]?.bytesSent, 240);
});

test("idle does not accept stale SFU producer stats", async () => {
  const { diagnostics } = createDiagnostics({
    activeProvider: null,
    mode: "idle",
    sfuReport: createReport("microphone-track", 480),
  });

  const stats = await diagnostics.getOutboundRtpStats();

  assert.equal(outboundSourceHasFlow(stats, "audio"), false);
  assert.equal(stats[0]?.bytesSent, undefined);
});
