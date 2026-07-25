import assert from "node:assert/strict";
import test from "node:test";
import { waitForMediaHandoff } from "../app/shared/media-handoff-readiness.js";

function sfuHandoff({ expectedSources, localSourceCount, readiness }) {
  const peers = [
    { peerId: "local", sources: [] },
    { peerId: "remote", sources: expectedSources },
  ];
  return waitForMediaHandoff({
    getLatestTopologyKey: () => "current",
    getLocalPeerId: () => "local",
    getSfu: () => ({ mediaReadiness: readiness }),
    handoff: {
      count: () => expectedSources.length,
      hasExpectedFeeds: () => true,
    },
    localSources: new Map(
      Array.from({ length: localSourceCount }, (_, index) => [
        `source-${index}`,
        {},
      ]),
    ),
    pollIntervalMs: 1,
    provider: "sfu",
    timeoutMs: 20,
    topology: {},
    topologyEventKey: () => "current",
    topologyState: { value: { peers } },
  });
}

test("receive-only SFU handoff accepts verified inbound RTP flow", async () => {
  let checks = 0;
  await sfuHandoff({
    expectedSources: ["audio"],
    localSourceCount: 0,
    readiness: async () => {
      checks += 1;
      return {
        ready: true,
        outboundExpected: 0,
        outboundFlowing: 0,
        inboundExpected: 1,
        inboundFlowing: 1,
      };
    },
  });
  assert.equal(checks, 1);
});

test("SFU handoff does not accept staged tracks without RTP flow", async () => {
  await assert.rejects(
    sfuHandoff({
      expectedSources: ["audio"],
      localSourceCount: 1,
      readiness: async () => ({
        ready: false,
        outboundExpected: 1,
        outboundFlowing: 0,
        inboundExpected: 1,
        inboundFlowing: 0,
      }),
    }),
    /outbound 0\/1, inbound 0\/1/,
  );
});
