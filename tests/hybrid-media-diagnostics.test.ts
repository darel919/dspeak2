import assert from "node:assert/strict";
import test from "node:test";
import { ref } from "vue";
import { createHybridMediaDiagnostics } from "../app/shared/hybrid-media-diagnostics.ts";
import { collectRtpStats } from "../app/shared/rtc-media-stats.ts";
import { outboundSourceHasFlow } from "../app/shared/media-source-flow.ts";
import { FakeMediaStreamTrack } from "./helpers/fake-media.ts";

test("staged SFU outbound audio remains visible before provider commit", async () => {
  const track = new FakeMediaStreamTrack("audio", "microphone-track");
  const report = new Map([
    [
      "audio-source",
      {
        id: "audio-source",
        type: "media-source",
        kind: "audio",
        trackIdentifier: track.id,
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
        bytesSent: 480,
        packetsSent: 12,
        timestamp: 2_000,
      },
    ],
  ]);
  const localSources = new Map([["audio", { source: "audio", track }]]);
  const diagnostics = createHybridMediaDiagnostics({
    collectRtpStats,
    getActiveProvider: () => null,
    getActiveRouteProvider: () => "cloudflare-realtime",
    getAudioLatencySnapshot: () => ({}),
    getP2pMesh: () => null,
    getRequestedVideoSettings: () => ({ frameRate: 30 }),
    getLifecycle: () => null,
    getProtocolState: () => null,
    getReadiness: () => null,
    getSfu: () => ({
      producers: new Map([
        [
          "audio",
          {
            producer: { getStats: async () => report },
            track,
            mid: "0",
          },
        ],
      ]),
    }),
    localSources,
    playbackState: ref("ready"),
    peerRoundTripTimes: ref({}),
    remoteAudioFeeds: ref(new Map()),
    refreshTopologyGraph: () => {},
    remoteVideoFeeds: ref(new Map()),
    send: () => undefined,
    sfuRoundTripTime: ref(null),
    topologyGraph: ref({ topology: {}, nodes: [], edges: [] }),
    topologyState: ref({ epoch: 1 }),
    updateP2pStats: () => undefined,
    rtpStatsSamples: new Map(),
  });

  const stats = await diagnostics.getOutboundRtpStats();

  assert.equal(outboundSourceHasFlow(stats, "audio"), true);
  assert.equal(stats[0]?.source, "audio");
  assert.equal(stats[0]?.bytesSent, 480);
});
