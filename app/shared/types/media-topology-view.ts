import type { ExternalValue } from "./boundary.ts";

import type { MediaCommandResult } from "./boundary.ts";

import type { Ref } from "vue";
import type { VoiceUserRecord } from "./voice-media-actions.ts";
import type { TopologyState } from "./topology-controller.ts";

export interface MediaTopologyParticipant {
  id?: string | number | null;
  userId?: string | number | null;
  profile?: Record<string, unknown> | null;
  sources?: unknown;
  muted?: unknown;
  deafened?: unknown;
  [key: string]: unknown;
}

export interface MediaTopologyEdge {
  peerId?: string | number | null;
  state?: string;
  rtt?: number | null;
  jitter?: number | null;
  network?: string | null;
  bitrate?: number | null;
  packetLoss?: number | null;
  jitterBufferDelayMs?: number | null;
  availableOutgoingBitrate?: number | null;
  concealedAudioRatio?: number | null;
  candidatePair?: MediaTopologyCandidatePair | null;
  [key: string]: unknown;
}

export interface MediaTopologyCandidate {
  candidateType?: string | null;
  protocol?: string | null;
  address?: string | null;
}

export interface MediaTopologyCandidatePair {
  currentRoundTripTime?: number | null;
  availableOutgoingBitrate?: number | null;
  packetLoss?: number | null;
  local?: MediaTopologyCandidate | null;
  remote?: MediaTopologyCandidate | null;
  [key: string]: unknown;
}

export interface MediaTopologyConnection {
  peerId: string | number;
  pc: { connectionState?: string };
}

export interface MediaTopologyProvider {
  connections?: Map<string, MediaTopologyConnection>;
  producers?: Map<string, { producer: { id?: string } }>;
  consumers?: Map<string, { producerId?: string; consumer?: unknown }>;
}

export interface MediaTopologyVoiceStore {
  upsertUserProfile: (profile: VoiceUserRecord) => MediaCommandResult;
  isUserConnected: (userId: string) => boolean;
  addConnectedUser: (
    userId: string | number,
    userInfo: VoiceUserRecord,
  ) => MediaCommandResult;
  updateUserVoiceState?: (
    userId: string,
    state: Record<string, unknown>,
  ) => MediaCommandResult;
  getConnectedUsersArray: () => Array<Record<string, unknown>>;
  removeConnectedUser: (userId: string | number) => MediaCommandResult;
}

export interface MediaTopologyViewContext {
  activeProvider: () => string | null;
  addressFamily: (address: ExternalValue) => string;
  buildTopologyGraph: unknown;
  consumers: Ref<Map<string, unknown>>;
  getParticipantProfile?: (
    userId: string,
  ) => Record<string, unknown> | null | undefined;
  getLocalPeerId: () => string | null;
  getP2pEdges: () => MediaCommandResult[];
  getP2pMesh: () => MediaCommandResult;
  getSfu: () => MediaCommandResult;
  mapPeerConnectionMetrics: unknown;
  mapPeerRoundTripTimes: unknown;
  mediaPathMetrics: Ref<unknown[]>;
  participantSfuRoundTripTimes: Ref<Record<string, unknown>>;
  peerConnectionMetrics: Ref<Record<string, unknown>>;
  peerRoundTripTimes: Ref<Record<string, unknown>>;
  producers: Ref<Map<string, unknown>>;
  setP2pEdges: (edges: unknown[]) => MediaCommandResult;
  topologyGraph: Ref<Record<string, unknown>>;
  topologyState: Ref<TopologyState>;
  voiceStore: MediaTopologyVoiceStore;
}
