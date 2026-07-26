import assert from "node:assert/strict";
import test from "node:test";
import {
  waitForInitialMediaTopology,
  waitForMediaHandoff,
} from "../app/shared/media-handoff-readiness.js";

function sfuHandoff({
  expectedInboundFlowCount,
  expectedSources,
  localSourceCount,
  readiness,
  shouldReceive,
  tracksReady = true,
}) {
  const inboundFlowCount = expectedInboundFlowCount ?? expectedSources.length;
  const peers = [
    { peerId: "local", userId: "local", sources: [] },
    { peerId: "remote", userId: "remote", sources: expectedSources },
  ];
  return waitForMediaHandoff({
    getLatestTopologyKey: () => "current",
    getLocalPeerId: () => "local",
    getSfu: () => ({
      expectedInboundFlowCount: () => inboundFlowCount,
      mediaReadiness: readiness,
      ...(shouldReceive ? { shouldReceive } : {}),
    }),
    handoff: {
      count: () => (tracksReady ? expectedSources.length : 1),
      entries: () =>
        tracksReady
          ? expectedSources.map((source) => ({
              userId: "remote",
              source,
            }))
          : [{ userId: "remote", source: "screen-audio" }],
      hasExpectedFeeds: () => tracksReady,
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

test("paused SFU video does not count as expected inbound RTP flow", async () => {
  let receivedExpected = null;
  await sfuHandoff({
    expectedSources: ["screen", "screen-audio"],
    expectedInboundFlowCount: 1,
    localSourceCount: 0,
    readiness: async (expected) => {
      receivedExpected = expected;
      return {
        ready: true,
        outboundExpected: 0,
        outboundFlowing: 0,
        inboundExpected: 1,
        inboundFlowing: 1,
      };
    },
  });

  assert.equal(receivedExpected, 1);
});

test("unrequested SFU screen video does not block handoff", async () => {
  await sfuHandoff({
    expectedSources: ["screen", "screen-audio"],
    expectedInboundFlowCount: 1,
    localSourceCount: 0,
    tracksReady: false,
    shouldReceive: (_userId, source) => source !== "screen",
    readiness: async (expected) => ({
      ready: expected === 1,
      outboundExpected: 0,
      outboundFlowing: 0,
      inboundExpected: expected,
      inboundFlowing: 1,
    }),
  });
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

test("initial topology waiting can be cancelled without a stale timeout", async () => {
  let waiter = null;
  const waiting = waitForInitialMediaTopology({
    isReady: () => false,
    setWaiter: (next) => {
      waiter = next;
    },
    timeoutMs: 5000,
  });

  waiter(new Error("media session stopped"));

  await assert.rejects(waiting, /media session stopped/);
  assert.equal(waiter, null);
});
