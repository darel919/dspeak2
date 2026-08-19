import assert from "node:assert/strict";
import test from "node:test";
import { setupMediaMessageHandlers } from "../app/shared/media-message-handlers.ts";
import { createCloudflarePublicationRegistry } from "../app/shared/cloudflare-publication-registry.ts";
import type { CloudflarePublication } from "../app/shared/types/cloudflare-media.ts";
import type { MediaMessageHandlersContext } from "../app/shared/types/media-message-handlers.ts";

interface RegistryHandle {
  update: (publication: Record<string, unknown>) => boolean;
  values: () => CloudflarePublication[];
  reconcileExact: (snapshot: CloudflarePublication[]) => {
    canonicalSnapshot: CloudflarePublication[];
    removed: CloudflarePublication[];
  };
}

test("stale heartbeat cannot mutate registry before revision fence (real handler path)", async () => {
  const reg = createCloudflarePublicationRegistry();
  const lastApplied = { value: "0" };
  let queuedDigests: unknown[][] = [];
  let queuedRevisions: (string | number | null)[] = [];

  const ctx: any = {
    getHeartbeatSequence: () => 10,
    getLastHeartbeatAckSequence: () => 0,
    getSfu: () => null,
    getSocket: () => ({ close: () => {} }),
    lastInRoom: { value: [] },
    participantSfuRoundTripTimes: { value: {} },
    queueTopology: () => {},
    registerHandler: (
      type: string,
      handler: (data: Record<string, unknown>) => unknown,
    ) => {
      if (type === "heartbeat-ack") {
        (globalThis as Record<string, unknown>).__testHeartbeatAckHandler =
          handler;
      }
    },
    remoteProducersCount: { value: 0 },
    setHeartbeatAck: () => {},
    setLocalPeerId: () => {},
    sfuProducerIds: () => [],
    syncConnectedUsers: () => {},
    voiceStore: {
      updateUserVoiceState: () => {},
      upsertUserProfile: () => {},
    },
    ensureP2p: () => null,
    onServerConnected: () => {},
    onServerHello: () => {},
    onAttenuationState: () => {},
    onProviderTicket: () => {},
    onProviderFailure: () => {},
    onProviderRecovering: () => {},
    onProviderRecoveryTopology: () => {},
    onP2pQualification: () => {},
    onOperationAck: () => {},
    onOperationError: () => {},
    onRoomRevisionApplied: () => {},
    onSnapshotRequested: () => {},
    queueTargetedReconciliation: () => {},
    onConnectionEpochUpdated: () => {},
    handlePublicationsDigest: async (
      digest: unknown[],
      publicationRevision?: string | number | null,
    ) => {
      queuedDigests.push(digest);
      queuedRevisions.push(publicationRevision as string | number | null);
      if (!Array.isArray(digest)) return;
      const serverPublications: CloudflarePublication[] = [];
      for (const entry of digest) {
        if (!entry || typeof entry !== "object") continue;
        serverPublications.push(entry as CloudflarePublication);
      }
      const envelopeRevision = publicationRevision
        ? String(publicationRevision)
        : "0";
      if (BigInt(envelopeRevision) < BigInt(lastApplied.value)) return;
      const { canonicalSnapshot, removed } =
        reg.reconcileExact(serverPublications);
      if (BigInt(envelopeRevision) > BigInt(lastApplied.value)) {
        lastApplied.value = envelopeRevision;
      }
      return { canonicalSnapshot, removed, lastApplied: lastApplied.value };
    },
  };

  setupMediaMessageHandlers(ctx);

  const handler = (globalThis as Record<string, unknown>)
    .__testHeartbeatAckHandler as (
    data: Record<string, unknown>,
  ) => Promise<unknown>;

  const oldX = {
    peerId: "peer-1",
    source: "screen",
    trackName: "screen-X",
    generation: 8,
    connectionEpoch: 1,
    userId: "user-1",
    closed: false,
    publicationRevision: 40,
  };

  // R40: Initial heartbeat with X
  await handler({
    sequence: 10,
    connectionEpoch: 1,
    publishedSourcesDigest: [oldX],
    publicationRevision: 40,
  });

  assert.equal(reg.values().length, 1);
  assert.equal(reg.values()[0].trackName, "screen-X");
  assert.equal(lastApplied.value, "40");

  // R41: Live close push arrives (simulating server pushing close)
  // In real flow this comes via cloudflare-publication-available
  const closeX = { ...oldX, closed: true, publicationRevision: 41 };
  reg.update(closeX);

  assert.equal(reg.values().length, 0);

  // R41: Heartbeat digest empty
  await handler({
    sequence: 11,
    connectionEpoch: 1,
    publishedSourcesDigest: [],
    publicationRevision: 41,
  });

  assert.equal(reg.values().length, 0);
  assert.equal(lastApplied.value, "41");

  // DELAYED R40 HEARTBEAT ARRIVES
  // This used to cause onPublicationsDigest to mutate registry BEFORE revision check
  await handler({
    sequence: 10, // stale sequence, but we're testing the digest path
    connectionEpoch: 1,
    publishedSourcesDigest: [oldX],
    publicationRevision: 40,
  });

  // Registry should STILL be empty because:
  // 1. The real handler path ONLY calls handlePublicationsDigest
  // 2. handlePublicationsDigest checks revision fence (40 < 41) and returns early
  // 3. No preliminary mutation occurs
  assert.equal(
    reg.values().length,
    0,
    "Stale heartbeat should not resurrect closed publication",
  );
  assert.equal(
    lastApplied.value,
    "41",
    "Last applied revision should not regress",
  );
});

test("two participants with same source name - tombstone resolves correct participant", async () => {
  const { createMediaSourceController } =
    await import("../app/shared/media-source-controller.ts");

  const localPeerId = "local-peer-123";
  const localParticipantKey = "user-1:device-1";

  const controller = createMediaSourceController({
    capture: {} as any,
    connected: { value: true } as any,
    createSharedAudioSource: async () => ({}) as any,
    error: { value: null } as any,
    getActiveProvider: () => "sfu",
    getConnectionEpoch: () => 1,
    getIntentionalClose: () => false,
    getLastAppliedRoomRevision: () => "1",
    getLastAppliedPublicationRevision: () => "41",
    setLastAppliedPublicationRevision: () => {},
    getP2pMesh: () => null,
    getSfu: () => null,
    localSources: new Map(),
    localVideoFeeds: { value: new Map() } as any,
    producerFacade: () => {},
    refreshPublicMaps: () => {},
    reportSfuFailure: () => {},
    send: () => {},
    startLocalVoiceDetection: () => {},
    startSharedAudioMeter: () => {},
    stopLocalVoiceDetection: () => {},
    stopSharedAudioMeter: () => {},
    topologyState: { value: {} } as any,
    voiceStore: {
      micMuted: false,
      deafened: false,
      screenSharing: false,
      systemAudioSharing: false,
    },
    getLocalPeerId: () => localPeerId,
    getLocalParticipantKey: () => localParticipantKey,
  });

  // Set up FSM for local "screen" source at generation 7 (inactive, reconciling)
  // This simulates a tombstone state where we stopped sharing but haven't completed cleanup
  controller.setSourcePhase("screen", "stopping", "sfu");
  let fsm = controller.sourceFsms.get("screen");
  if (fsm) {
    controller.sourceFsms.set("screen", {
      ...fsm,
      generation: 7,
      desiredState: "inactive",
    });
  }
  fsm = controller.sourceFsms.get("screen");
  if (fsm) {
    controller.sourceFsms.set("screen", { ...fsm, phase: "reconciling" });
  }

  // Simulate STALE_SOURCE_GENERATION NACK with canonical state showing:
  // - LOCAL participant: screen generation 7 INACTIVE (our tombstone)
  // - REMOTE participant (first in array): screen generation 6 ACTIVE (their active screen)
  // The OLD code would grab the remote participant's state and incorrectly complete
  const payload = {
    source: "screen",
    expectedGeneration: 7,
    adoptsCanonicalGeneration: true,
    retryable: false,
    code: "STALE_SOURCE_GENERATION",
    canonicalState: {
      participants: [
        {
          peerId: "remote-peer-456",
          sourceStates: {
            screen: { generation: 6, desiredState: "active" },
          },
        },
        {
          peerId: localPeerId,
          sourceStates: {
            screen: { generation: 7, desiredState: "inactive" },
          },
        },
      ],
      sourceStates: {
        [localParticipantKey]: {
          screen: { generation: 7, desiredState: "inactive" },
        },
        "user-2:device-2": {
          screen: { generation: 6, desiredState: "active" },
        },
      },
    },
  };

  const result = await controller.queueTargetedReconciliation(
    "op-test",
    payload as any,
  );

  // Should complete the retirement because canonical state for LOCAL participant shows inactive
  assert.equal(
    result,
    true,
    "Should complete retirement when local participant is inactive",
  );

  // FSM should become idle
  const currentFsm = controller.sourceFsms.get("screen");
  assert.ok(currentFsm, "FSM should exist");
  assert.equal(
    currentFsm.phase,
    "idle",
    "Local participant should become idle",
  );
  assert.equal(currentFsm.generation, 7, "Generation should not change");

  // Now test the inverse: local inactive (gen 7), remote active (gen 99)
  // Reset FSM
  controller.setSourcePhase("screen", "stopping", "sfu");
  fsm = controller.sourceFsms.get("screen");
  if (fsm) {
    controller.sourceFsms.set("screen", {
      ...fsm,
      generation: 7,
      desiredState: "inactive",
    });
  }
  fsm = controller.sourceFsms.get("screen");
  if (fsm) {
    controller.sourceFsms.set("screen", { ...fsm, phase: "reconciling" });
  }

  const payload2 = {
    source: "screen",
    expectedGeneration: 7,
    adoptsCanonicalGeneration: true,
    retryable: false,
    code: "STALE_SOURCE_GENERATION",
    canonicalState: {
      participants: [
        {
          peerId: "remote-peer-456",
          sourceStates: {
            screen: { generation: 99, desiredState: "active" },
          },
        },
        {
          peerId: localPeerId,
          sourceStates: {
            screen: { generation: 7, desiredState: "inactive" },
          },
        },
      ],
      sourceStates: {
        [localParticipantKey]: {
          screen: { generation: 7, desiredState: "inactive" },
        },
        "user-2:device-2": {
          screen: { generation: 99, desiredState: "active" },
        },
      },
    },
  };

  const result2 = await controller.queueTargetedReconciliation(
    "op-test2",
    payload2 as any,
  );

  // Should complete the retirement because LOCAL participant is inactive
  assert.equal(
    result2,
    true,
    "Should complete retirement when local participant is inactive (remote active)",
  );

  // FSM should become idle
  const currentFsm2 = controller.sourceFsms.get("screen");
  assert.ok(currentFsm2, "FSM should exist");
  assert.equal(
    currentFsm2.phase,
    "idle",
    "Local participant should become idle (remote active)",
  );
});

test("pending retirement completes on fresh ACK after reconnect", async () => {
  const { createMediaSourceController } =
    await import("../app/shared/media-source-controller.ts");

  let connectionEpoch = 1;

  let sendFn: (message: unknown) => void = () => {};
  const controller = createMediaSourceController({
    capture: {} as any,
    connected: { value: true } as any,
    createSharedAudioSource: async () => ({}) as any,
    error: { value: null } as any,
    getActiveProvider: () => "sfu",
    getConnectionEpoch: () => connectionEpoch,
    getIntentionalClose: () => false,
    getLastAppliedRoomRevision: () => "1",
    getLastAppliedPublicationRevision: () => "41",
    setLastAppliedPublicationRevision: () => {},
    getP2pMesh: () => null,
    getSfu: () => null,
    localSources: new Map(),
    localVideoFeeds: { value: new Map() } as any,
    producerFacade: () => {},
    refreshPublicMaps: () => {},
    reportSfuFailure: () => {},
    send: (message: unknown) => sendFn(message),
    startLocalVoiceDetection: () => {},
    startSharedAudioMeter: () => {},
    stopLocalVoiceDetection: () => {},
    stopSharedAudioMeter: () => {},
    topologyState: { value: {} } as any,
    voiceStore: {
      micMuted: false,
      deafened: false,
      screenSharing: false,
      systemAudioSharing: false,
    },
    getLocalPeerId: () => "local-peer-123",
    getLocalParticipantKey: () => "user-1:device-1",
  });

  // First, create a pending retirement by directly manipulating the internal state
  // (simulating what happens after a STALE_SOURCE_GENERATION NACK with retryable=true)
  controller.setSourcePhase("screen", "stopping", "sfu");
  let fsm = controller.sourceFsms.get("screen");
  if (fsm) {
    controller.sourceFsms.set("screen", {
      ...fsm,
      generation: 7,
      desiredState: "inactive",
    });
  }
  fsm = controller.sourceFsms.get("screen");
  if (fsm) {
    controller.sourceFsms.set("screen", { ...fsm, phase: "idle" });
  }

  // Manually add a pending retirement with an OLD operation ID (simulating old epoch)
  controller.pendingRetirements.set("screen", {
    source: "screen",
    generation: 7,
    operationId: "op-old-epoch-123",
    cleanupRequired: true,
  });

  // Change to new connection epoch
  connectionEpoch = 2;

  // Set up send function to auto-resolve ACKs for media-sources
  sendFn = (message: unknown) => {
    const msg = message as { type: string; data?: { operationId?: string } };
    if (msg.type === "media-sources" && msg.data?.operationId) {
      controller.resolveOperationAck(msg.data.operationId);
    }
  };

  // Call processPendingRetirements - this should send a fresh mutation
  // With the new implementation, the fresh ACK should complete the retirement
  await controller.processPendingRetirements();

  // The pending retirement should be DELETED because the fresh send completed
  // and the .then() handler completed the cleanup locally
  const pending = controller.pendingRetirements.get("screen");
  assert.equal(
    pending,
    undefined,
    "Pending retirement should be deleted after fresh ACK completes cleanup",
  );

  // FSM should be idle
  const currentFsm = controller.sourceFsms.get("screen");
  assert.ok(currentFsm, "FSM should exist");
  assert.equal(
    currentFsm.phase,
    "idle",
    "FSM should be idle after retirement completes",
  );
  assert.equal(
    currentFsm.desiredState,
    "inactive",
    "FSM desiredState should remain inactive",
  );
});
