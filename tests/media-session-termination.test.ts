import assert from "node:assert/strict";
import test from "node:test";
import { createHybridMediaSessionTermination } from "../app/shared/hybrid-media-session-termination.ts";

type TerminationOverrides = Record<string, unknown>;

function buildContext(overrides: TerminationOverrides = {}) {
  const refs = {
    connected: { value: true },
    /* SAFETY: the fixture mirrors the Vue ref shape (a .value holder) only. */
    error: { value: null as string | null },
    iceConnectedBoth: { value: true },
    mediaConnectionState: { value: "connected" },
    playbackState: { value: "active" },
    protocolState: { value: {} },
    protocolUpdateRequired: { value: false },
    rtpStatsSamples: new Set(),
    sfuRoundTripTime: { value: 1 },
    transportReady: { value: true },
  };
  const calls = {
    sendLeaveCalls: 0,
    signalingStopCalls: 0,
    providerCloseCalls: 0,
  };
  const context = {
    capture: {
      stopDeviceMonitoring: () => {},
      stopAll: () => {},
    },
    clearAttenuation: () => {},
    closeMediaSessionTransports: () => {},
    cancelConnect: () => {},
    disposeVisibility: () => {},
    handoff: { clear: () => {} },
    getP2pMesh: () => null,
    getProviderSocket: () => ({ close: () => (calls.providerCloseCalls += 1) }),
    getSfu: () => null,
    lifecycleState: { record: () => {} },
    mediaPathMetrics: [],
    participantSfuRoundTripTimes: {},
    peerConnectionMetrics: {},
    peerRoundTripTimes: {},
    refreshPublicMaps: () => {},
    refreshTopologyGraph: () => {},
    resetTopologySequencing: () => {},
    setActiveProvider: () => {},
    setChannelId: () => {},
    setIntentionalClose: () => {},
    setLastP2pEdges: () => {},
    setP2pMesh: () => {},
    setProviderSocket: () => {},
    setSfu: () => {},
    resolveTopologyWaiter: () => {},
    stopLocalVoiceDetection: () => {},
    stopSharedAudioMeter: () => {},
    sendLeave: async () => {
      calls.sendLeaveCalls += 1;
      return undefined;
    },
    signaling: {
      stop: () => (calls.signalingStopCalls += 1),
      getSocket: () => null,
    },
    ...refs,
    ...overrides,
  };
  return { context, calls };
}

test("disconnect stops signaling exactly once on leave success", async () => {
  const { context, calls } = buildContext();
  /* SAFETY: buildContext returns the full termination context contract. */
  const termination = createHybridMediaSessionTermination(context as never);
  await termination.disconnect();
  assert.equal(calls.signalingStopCalls, 1);
  assert.equal(calls.sendLeaveCalls, 1);
});

test("disconnect stops signaling exactly once when leave rejects", async () => {
  const { context, calls } = buildContext({
    sendLeave: async () => {
      throw new Error("leave rejected");
    },
  });
  /* SAFETY: buildContext returns the full termination context contract. */
  const termination = createHybridMediaSessionTermination(context as never);
  await termination.disconnect();
  assert.equal(calls.signalingStopCalls, 1);
});

test("disconnect stops signaling exactly once when leave hangs", async () => {
  const { context, calls } = buildContext({
    sendLeave: () => new Promise(() => {}),
  });
  /* SAFETY: buildContext returns the full termination context contract. */
  const termination = createHybridMediaSessionTermination(context as never);
  const startedAt = Date.now();
  await termination.disconnect();
  assert.ok(Date.now() - startedAt >= 700);
  assert.equal(calls.signalingStopCalls, 1);
});
