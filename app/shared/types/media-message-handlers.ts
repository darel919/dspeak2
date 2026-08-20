import type { Ref } from "vue";
import type { TopologyData } from "./topology-controller.ts";
import type { TopologyController } from "./topology-controller.ts";

export type MediaMessage = Record<string, unknown>;

export interface MediaMessageHandlersContext {
  getHeartbeatSequence: () => number;
  getLastHeartbeatAckSequence: () => number;
  getSfu: () => {
    handle: (type: string, data: MediaMessage) => unknown;
  } | null;
  getSocket: () => { close: () => unknown } | null;
  lastInRoom: Ref<string[]>;
  participantSfuRoundTripTimes: Ref<Record<string, unknown>>;
  queueTopology: (data: TopologyData) => unknown;
  registerHandler: (
    type: string,
    handler: (data: MediaMessage) => unknown,
  ) => unknown;
  remoteProducersCount: Ref<number>;
  setHeartbeatAck: (sequence: number, acknowledgedAt: number) => unknown;
  setLocalPeerId: (peerId: string | null) => unknown;
  sfuProducerIds: () => string[];
  syncConnectedUsers: (data: unknown) => unknown;
  voiceStore: {
    updateUserVoiceState: (userId: string, data: MediaMessage) => unknown;
    upsertUserProfile: (profile: MediaMessage) => unknown;
  };
  ensureP2p: () => {
    receiveSignal: (data: MediaMessage) => Promise<unknown>;
    fail: (reason: string, error: unknown) => unknown;
  } | null;
  onServerConnected?: () => unknown;
  onServerHello: (data: MediaMessage) => unknown;
  onAttenuationState: (data: MediaMessage) => unknown;
  onProviderTicket: (data: MediaMessage) => unknown;
  onProviderFailure: (data: MediaMessage) => unknown;
  onProviderRecovering: (data: MediaMessage) => unknown;
  onProviderRecoveryTopology?: (data: MediaMessage) => unknown;
  onP2pQualification: (data: MediaMessage) => unknown;
  onOperationAck?: (operationId: string, data?: MediaMessage) => unknown;
  onOperationError?: (operationId: string, error: unknown) => unknown;
  onRoomRevisionApplied?: (roomRevision: string) => unknown;
  onSnapshotRequested?: () => unknown;
  queueTargetedReconciliation?: (
    operationId: string,
    data: MediaMessage,
  ) => unknown;
  onConnectionEpochUpdated?: (connectionEpoch: number) => unknown;
  handlePublicationsDigest?: (
    publications: unknown[],
    publicationRevision?: string | number | null,
  ) => Promise<unknown>;
  onReceiverEvidence?: (data: MediaMessage) => unknown;
}
