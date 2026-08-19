import { beforeEach, describe, it } from "node:test";
import assert from "node:assert";
import { ref } from "vue";
import { setupMediaMessageHandlers } from "../app/shared/media-message-handlers.ts";
import { createCloudflarePublicationRegistry } from "../app/shared/cloudflare-publication-registry.ts";
import type { CloudflarePublication } from "../app/shared/types/cloudflare-media.ts";
import type {
  MediaMessageHandlersContext,
  MediaMessage,
} from "../app/shared/types/media-message-handlers.ts";
import type { TopologyState } from "../app/shared/types/topology-controller.ts";
import type { TopologySourceEntry } from "../app/shared/types/topology-controller.ts";
import type { MediaCaptureManager } from "../app/shared/media-capture.ts";
import type { MediaVideoFeed } from "../app/shared/types/media-source-controller.ts";
import type {
  MediaCaptureEntry,
  MediaCaptureSettings,
} from "../app/shared/types/media-capture.ts";

interface RegistryHandle {
  update: (publication: CloudflarePublication) => boolean;
  values: () => CloudflarePublication[];
  reconcileExact: (snapshot: CloudflarePublication[]) => {
    canonicalSnapshot: CloudflarePublication[];
    removed: CloudflarePublication[];
  };
}

interface TestPublication {
  peerId: string;
  source: string;
  trackName: string;
  generation: number;
  connectionEpoch: number;
  userId: string;
  closed: boolean;
  publicationRevision: number;
  [key: string]: unknown;
}

function createTestContext(
  registerHandler: MediaMessageHandlersContext["registerHandler"],
): MediaMessageHandlersContext {
  return {
    getHeartbeatSequence: () => 10,
    getLastHeartbeatAckSequence: () => 0,
    getSfu: () => null,
    getSocket: () => ({ close: () => {} }),
    lastInRoom: ref([]),
    participantSfuRoundTripTimes: ref({}),
    queueTopology: () => {},
    registerHandler,
    remoteProducersCount: ref(0),
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
    onServerHello: (_data: MediaMessage) => {},
    onAttenuationState: (_data: MediaMessage) => {},
    onProviderTicket: (_data: MediaMessage) => {},
    onProviderFailure: (_data: MediaMessage) => {},
    onProviderRecovering: (_data: MediaMessage) => {},
    onProviderRecoveryTopology: (_data: MediaMessage) => {},
    onP2pQualification: (_data: MediaMessage) => {},
    onOperationAck: (_operationId: string, _data?: MediaMessage) => {},
    onOperationError: (_operationId: string, _error: unknown) => {},
    onRoomRevisionApplied: (_roomRevision: string) => {},
    onSnapshotRequested: () => {},
    queueTargetedReconciliation: (
      _operationId: string,
      _data: MediaMessage,
    ) => {},
    onConnectionEpochUpdated: (_connectionEpoch: number) => {},
    handlePublicationsDigest: async (
      digest: unknown[],
      publicationRevision?: string | number | null,
    ) => {
      queuedDigests.push(digest);
      queuedRevisions.push(publicationRevision ?? null);
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
}

let reg: RegistryHandle;
let lastApplied: { value: string };
let queuedDigests: unknown[][];
let queuedRevisions: (string | number | null)[];
let ctx: MediaMessageHandlersContext;
let heartbeatAckHandler:
  ((data: Record<string, unknown>) => Promise<unknown>) | null;

describe("stale heartbeat regression", () => {
  beforeEach(() => {
    reg = createCloudflarePublicationRegistry();
    lastApplied = { value: "0" };
    queuedDigests = [];
    queuedRevisions = [];
    ctx = createTestContext((type, handler) => {
      if (type === "heartbeat-ack") {
        heartbeatAckHandler = handler;
      }
    });
    heartbeatAckHandler = null;

    setupMediaMessageHandlers(ctx);
  });

  it("stale heartbeat cannot mutate registry before revision fence (real handler path)", async () => {
    const oldX: TestPublication = {
      peerId: "peer-1",
      source: "screen",
      trackName: "screen-X",
      generation: 8,
      connectionEpoch: 1,
      userId: "user-1",
      closed: false,
      publicationRevision: 40,
    };

    await heartbeatAckHandler?.({
      sequence: 10,
      connectionEpoch: 1,
      publishedSourcesDigest: [oldX],
      publicationRevision: 40,
    });

    assert.equal(reg.values().length, 1);
    assert.equal(reg.values()[0].trackName, "screen-X");
    assert.equal(lastApplied.value, "40");

    const closeX: TestPublication = {
      ...oldX,
      closed: true,
      publicationRevision: 41,
    };
    reg.update(closeX);

    assert.equal(reg.values().length, 0);

    await heartbeatAckHandler?.({
      sequence: 11,
      connectionEpoch: 1,
      publishedSourcesDigest: [],
      publicationRevision: 41,
    });

    assert.equal(reg.values().length, 0);
    assert.equal(lastApplied.value, "41");

    await heartbeatAckHandler?.({
      sequence: 10,
      connectionEpoch: 1,
      publishedSourcesDigest: [oldX],
      publicationRevision: 40,
    });

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
});

describe("media source controller tombstone resolution", () => {
  it("two participants with same source name - tombstone resolves correct participant", async () => {
    const { createMediaSourceController } =
      await import("../app/shared/media-source-controller.ts");

    const localPeerId = "local-peer-123";
    const localParticipantKey = "user-1:device-1";

    const mockCapture: MediaCaptureManager = {
      getSettings: () =>
        ({
          audio: {},
          micDeviceId: null,
          cameraDeviceId: null,
        }) as MediaCaptureSettings,
      getAudioStereo: (_source: string) => false,
      mediaDevices: navigator.mediaDevices,
      onMicrophoneFallback: (_details: unknown) => {},
      onMicrophoneRestored: (_details: unknown) => {},
      onSource: (_entry: unknown) => {},
      onSourceEnded: (
        _entry: unknown,
        _details?: Record<string, unknown>,
      ) => {},
      startMicrophone: async () => ({}) as unknown as MediaCaptureEntry,
      stop: async () => {},
    };

    const controller = createMediaSourceController({
      capture: mockCapture,
      connected: ref(true),
      createSharedAudioSource: async (entry: TopologySourceEntry) => entry,
      error: ref(null),
      getActiveProvider: () => "sfu",
      getConnectionEpoch: () => 1,
      getIntentionalClose: () => false,
      getLastAppliedRoomRevision: () => "1",
      getLastAppliedPublicationRevision: () => "41",
      setLastAppliedPublicationRevision: () => {},
      getP2pMesh: () => null,
      getSfu: () => null,
      localSources: new Map(),
      localVideoFeeds: ref(new Map<string, MediaVideoFeed>()),
      producerFacade: () => {},
      refreshPublicMaps: () => {},
      reportSfuFailure: () => {},
      send: () => {},
      startLocalVoiceDetection: () => {},
      startSharedAudioMeter: () => {},
      stopLocalVoiceDetection: () => {},
      stopSharedAudioMeter: () => {},
      topologyState: ref({
        mode: "sfu",
        epoch: 1,
        peers: [],
        activatedAt: null,
        canonicalMode: "sfu",
        activeTransport: "sfu",
        targetTransport: null,
      } as TopologyState),
      voiceStore: {
        micMuted: false,
        deafened: false,
        screenSharing: false,
        systemAudioSharing: false,
      },
      getLocalPeerId: () => localPeerId,
      getLocalParticipantKey: () => localParticipantKey,
    });

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
      payload,
    );

    assert.equal(
      result,
      true,
      "Should complete retirement when local participant is inactive",
    );

    const currentFsm = controller.sourceFsms.get("screen");
    assert.ok(currentFsm, "FSM should exist");
    assert.equal(
      currentFsm.phase,
      "idle",
      "Local participant should become idle",
    );
    assert.equal(currentFsm.generation, 7, "Generation should not change");

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
      payload2,
    );

    assert.equal(
      result2,
      true,
      "Should complete retirement when local participant is inactive (remote active)",
    );

    const currentFsm2 = controller.sourceFsms.get("screen");
    assert.ok(currentFsm2, "FSM should exist");
    assert.equal(
      currentFsm2.phase,
      "idle",
      "Local participant should become idle (remote active)",
    );
  });

  it("pending retirement completes on fresh ACK after reconnect", async () => {
    const { createMediaSourceController } =
      await import("../app/shared/media-source-controller.ts");

    let connectionEpoch = 1;

    let sendFn: (message: unknown) => void = () => {};
    const controller = createMediaSourceController({
      capture: {},
      connected: { value: true },
      createSharedAudioSource: async () => ({}),
      error: { value: null },
      getActiveProvider: () => "sfu",
      getConnectionEpoch: () => connectionEpoch,
      getIntentionalClose: () => false,
      getLastAppliedRoomRevision: () => "1",
      getLastAppliedPublicationRevision: () => "41",
      setLastAppliedPublicationRevision: () => {},
      getP2pMesh: () => null,
      getSfu: () => null,
      localSources: new Map(),
      localVideoFeeds: { value: new Map() },
      producerFacade: () => {},
      refreshPublicMaps: () => {},
      reportSfuFailure: () => {},
      send: (message: unknown) => sendFn(message),
      startLocalVoiceDetection: () => {},
      startSharedAudioMeter: () => {},
      stopLocalVoiceDetection: () => {},
      stopSharedAudioMeter: () => {},
      topologyState: { value: {} },
      voiceStore: {
        micMuted: false,
        deafened: false,
        screenSharing: false,
        systemAudioSharing: false,
      },
      getLocalPeerId: () => "local-peer-123",
      getLocalParticipantKey: () => "user-1:device-1",
    });

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

    controller.pendingRetirements.set("screen", {
      source: "screen",
      generation: 7,
      operationId: "op-old-epoch-123",
      cleanupRequired: true,
    });

    connectionEpoch = 2;

    sendFn = (message: unknown) => {
      const msg = message as { type: string; data?: { operationId?: string } };
      if (msg.type === "media-sources" && msg.data?.operationId) {
        controller.resolveOperationAck(msg.data.operationId);
      }
    };

    await controller.processPendingRetirements();

    const pending = controller.pendingRetirements.get("screen");
    assert.equal(
      pending,
      undefined,
      "Pending retirement should be deleted after fresh ACK completes cleanup",
    );

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
});
