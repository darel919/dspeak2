import assert from "node:assert/strict";
import test from "node:test";
import {
  handleConnectionState,
  handleIceState,
} from "../app/shared/native-p2p-health.ts";
import { NativeP2pLifecycleMethods } from "../app/shared/native-p2p/lifecycle.ts";
import type {
  NativeP2pConnectionState,
  NativeP2pHealthMesh,
} from "../app/shared/types/native-p2p.ts";

type FakePeerConnection = {
  connectionState: RTCPeerConnectionState;
  iceConnectionState: RTCIceConnectionState;
  restartIce: () => void;
};

function buildState(
  peerId: string,
  pc: FakePeerConnection,
): NativeP2pConnectionState {
  const state = {
    peerId,
    userId: null,
    /* SAFETY: FakePeerConnection exposes the connectionState/iceConnectionState/restartIce members these handlers read. */
    pc,
    channel: null,
    polite: false,
    makingOffer: false,
    ignoreOffer: false,
    negotiationRequested: false,
    negotiationTimer: null,
    capabilityWaitTimer: null,
    restarted: false,
    disconnectTimer: null,
    healthReceived: 0,
    lastHealthAt: 0,
    mediaReady: false,
    expectedRemoteSources: 1,
    senders: new Map(),
    audioReceivers: new Map(),
    remoteTracks: new Map(),
    remoteSourceNames: new Set(),
    remoteReceiving: new Map(),
    sourceReceiving: new Map(),
    lastOutboundBytes: null,
    lastInboundBytes: null,
    lastOutboundProgressAt: null,
    lastInboundProgressAt: null,
    lastOutboundSourceBytes: new Map(),
    lastInboundSourceBytes: new Map(),
    lastOutboundSourceProgressAt: new Map(),
    lastInboundSourceProgressAt: new Map(),
    selectedPair: null,
    candidates: [],
    remoteDescription: null,
    closed: false,
  };
  /* SAFETY: the fixture carries every member the health handlers touch. */
  return state as NativeP2pConnectionState;
}

function buildMesh(): NativeP2pHealthMesh & {
  failures: Array<{ reason: string; error?: unknown }>;
} {
  const failures: Array<{ reason: string; error?: unknown }> = [];
  const mesh = {
    mode: "p2p",
    readyReported: true,
    healthRunToken: 0,
    healthCheckRunning: false,
    healthInterval: null,
    qualificationTimeout: null,
    connections: new Map<string, NativeP2pConnectionState>(),
    localSources: new Map(),
    sourceTransmission: new Map(),
    epoch: 3,
    /* SAFETY: failures mirror the mesh failure report shape (reason plus optional detail). */
    p2pIcePolicy: "direct-or-relay" as const,
    failures,
    /* SAFETY: the fixture only needs the reason string to assert scoping. */
    fail(reason: string, error?: string) {
      mesh.failures.push({ reason, error });
    },
    /* SAFETY: same failure-report shape as fail above. */
    onFailure(reason: string, error?: string) {
      mesh.failures.push({ reason, error });
    },
    emitSnapshot() {},
    sendControl: () => true,
    checkQualification() {},
    remoteSourcesExpected: () => true,
    remoteSources: new Map(),
    remoteSourceOwners: new Map(),
    remoteSourceGenerations: new Map(),
    remoteSourceConnectionEpochs: new Map(),
    pendingSignals: new Map(),
    stopHealthChecks() {},
    onRemoteTrackEnded: () => {},
  };
  Object.defineProperties(
    mesh,
    Object.getOwnPropertyDescriptors(NativeP2pLifecycleMethods.prototype),
  );
  /* SAFETY: the fixture above implements every member the health handlers touch. */
  return mesh as never;
}

test("single edge failure is peer-scoped and surviving edge keeps mesh alive", () => {
  const mesh = buildMesh();
  const failingPc: FakePeerConnection = {
    connectionState: "failed",
    iceConnectionState: "failed",
    restartIce: () => {},
  };
  const healthyPc: FakePeerConnection = {
    connectionState: "connected",
    iceConnectionState: "connected",
    restartIce: () => {},
  };
  mesh.connections.set("peer-a", buildState("peer-a", failingPc));
  mesh.connections.set("peer-b", buildState("peer-b", healthyPc));

  /* SAFETY: the fixture implements the full mesh surface handleConnectionState touches. */
  handleConnectionState(mesh as never, mesh.connections.get("peer-a")!);

  assert.equal(mesh.failures.length, 0);
  assert.ok(mesh.connections.size <= 1);
  assert.ok(!mesh.connections.has("peer-a"));
});

test("last remaining edge failure escalates to mesh failure once", () => {
  const mesh = buildMesh();
  const failingPc: FakePeerConnection = {
    connectionState: "failed",
    iceConnectionState: "failed",
    restartIce: () => {},
  };
  mesh.connections.set("solo", buildState("solo", failingPc));

  /* SAFETY: the fixture implements the full mesh surface handleConnectionState touches. */
  handleConnectionState(mesh as never, mesh.connections.get("solo")!);

  assert.equal(mesh.failures.length, 1);
  assert.equal(mesh.failures[0].reason, "peer-connection-failed");
  assert.equal(mesh.connections.size, 0);
});

test("ice failure on one of two peers does not fail the mesh", () => {
  const mesh = buildMesh();
  const failedIcePc: FakePeerConnection = {
    connectionState: "connected",
    iceConnectionState: "failed",
    restartIce: () => {},
  };
  const healthyPc: FakePeerConnection = {
    connectionState: "connected",
    iceConnectionState: "connected",
    restartIce: () => {},
  };
  mesh.connections.set("peer-a", buildState("peer-a", failedIcePc));
  mesh.connections.set("peer-b", buildState("peer-b", healthyPc));

  /* SAFETY: the fixture implements the full mesh surface handleIceState touches. */
  handleIceState(mesh as never, mesh.connections.get("peer-a")!);

  assert.equal(mesh.failures.length, 0);
  assert.equal(mesh.connections.size, 1);
});
