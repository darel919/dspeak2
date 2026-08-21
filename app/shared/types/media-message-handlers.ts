import type { OwnedErrorValue } from "./shared-utilities.ts";

import type { MediaCommandResult } from "./boundary.ts";

import type { Ref } from "vue";
import type { TopologyData } from "./topology-controller.ts";
import type { VoiceUserRecord } from "./voice-media-actions.ts";

export type MediaMessage = Record<string, unknown>;

export interface MediaMessageHandlersContext {
  getHeartbeatSequence: () => number;
  getLastHeartbeatAckSequence: () => number;
  getSfu: () => {
    handle: (type: string, data: MediaMessage) => MediaCommandResult;
  } | null;
  getSocket: () => { close: () => MediaCommandResult } | null;
  lastInRoom: Ref<string[]>;
  participantSfuRoundTripTimes: Ref<Record<string, unknown>>;
  queueTopology: (data: TopologyData) => MediaCommandResult;
  registerHandler: (
    type: string,
    handler: (data: MediaMessage) => MediaCommandResult,
  ) => MediaCommandResult;
  remoteProducersCount: Ref<number>;
  setHeartbeatAck: (
    sequence: number,
    acknowledgedAt: number,
  ) => MediaCommandResult;
  setLocalPeerId: (peerId: string | null) => MediaCommandResult;
  sfuProducerIds: () => string[];
  syncConnectedUsers: (data?: unknown[]) => MediaCommandResult;
  voiceStore: {
    updateUserVoiceState: (
      userId: string,
      data: MediaMessage,
    ) => MediaCommandResult;
    upsertUserProfile: (profile: VoiceUserRecord) => MediaCommandResult;
  };
  ensureP2p: () => {
    receiveSignal: (data: MediaMessage) => Promise<MediaCommandResult>;
    fail: (reason: string, error: OwnedErrorValue) => MediaCommandResult;
  } | null;
  onServerConnected?: () => MediaCommandResult;
  onServerHello: (data: MediaMessage) => MediaCommandResult;
  onAttenuationState: (data: MediaMessage) => MediaCommandResult;
  onProviderTicket: (data: MediaMessage) => MediaCommandResult;
  onProviderFailure: (data: MediaMessage) => MediaCommandResult;
  onProviderRecovering: (data: MediaMessage) => MediaCommandResult;
  onProviderRecoveryTopology?: (data: MediaMessage) => MediaCommandResult;
  onP2pQualification: (data: MediaMessage) => MediaCommandResult;
  onOperationAck?: (
    operationId: string,
    data?: MediaMessage,
  ) => MediaCommandResult;
  onOperationError?: (
    operationId: string,
    error: OwnedErrorValue,
  ) => MediaCommandResult;
  onRoomRevisionApplied?: (roomRevision: string) => MediaCommandResult;
  onSnapshotRequested?: () => MediaCommandResult;
  queueTargetedReconciliation?: (
    operationId: string,
    data: MediaMessage,
  ) => MediaCommandResult;
  onConnectionEpochUpdated?: (connectionEpoch: number) => MediaCommandResult;
  handlePublicationsDigest?: (
    publications: unknown[],
    publicationRevision?: string | number | null,
  ) => Promise<MediaCommandResult>;
}
