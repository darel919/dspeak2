import type { ExternalValue } from "./boundary.ts";

import type { MediaCommandResult } from "./boundary.ts";

import type { Ref } from "vue";
import type { MediaCaptureManager } from "../media-capture.ts";
import type {
  AdaptiveVideoEntry,
  AdaptiveVideoSettings,
} from "./adaptive-media.ts";
import type {
  TopologySourceEntry,
  TopologyState,
} from "./topology-controller.ts";

export interface SourceProvider {
  publishSource: (
    source: string,
    track: MediaStreamTrack,
    stream?: MediaStream,
    entry?: TopologySourceEntry,
  ) => MediaCommandResult;
  unpublishSource: (source: string) => MediaCommandResult;
  addSource: (entry: TopologySourceEntry) => MediaCommandResult;
  removeSource: (source: string) => MediaCommandResult;
  setSourceTransmission?: (
    source: string,
    enabled: boolean,
  ) => MediaCommandResult;
}

export interface MediaSourceControllerContext {
  capture: MediaCaptureManager;
  connected: Ref<boolean>;
  createSharedAudioSource: (
    entry: TopologySourceEntry,
  ) => Promise<TopologySourceEntry>;
  error: Ref<string | null>;
  getActiveProvider: () => string | null;
  getConnectionEpoch: () => number;
  getIntentionalClose: () => boolean;
  getLastAppliedRoomRevision: () => string;
  getLastAppliedPublicationRevision: () => string;
  setLastAppliedPublicationRevision: (value: string) => void;
  getP2pMesh: () => MediaCommandResult;
  getSfu: () => MediaCommandResult;
  getVideoReport?: (
    source: string,
  ) => Promise<Map<string, Record<string, unknown>> | null>;
  getVideoSettings?: (source: string) => AdaptiveVideoSettings;
  localSources: Map<string, TopologySourceEntry>;
  localVideoFeeds: Ref<Map<string, MediaVideoFeed>>;
  onSharedAudioStopped?: () => MediaCommandResult;
  producerFacade: (entry: TopologySourceEntry) => MediaCommandResult;
  refreshMediaPolicy?: () => Promise<MediaCommandResult>;
  refreshPublicMaps: () => MediaCommandResult;
  reportSfuFailure: (reason: string) => MediaCommandResult;
  send: (message: Record<string, unknown>) => MediaCommandResult;
  startLocalVoiceDetection: (entry: TopologySourceEntry) => MediaCommandResult;
  startSharedAudioMeter: (source: string) => MediaCommandResult;
  stopLocalVoiceDetection: () => MediaCommandResult;
  stopSharedAudioMeter: () => MediaCommandResult;
  topologyState: Ref<TopologyState>;
  queueTargetedReconciliation?: (
    operationId: string,
    data: ExternalValue,
  ) => MediaCommandResult;
  processPendingRetirements?: () => Promise<void>;
  sendParticipantVoiceState: (state: {
    muted?: boolean;
    deafened?: boolean;
  }) => MediaCommandResult;
  getLocalPeerId?: () => string | null;
  getLocalParticipantKey?: () => string | null;
  voiceStore: {
    micMuted: boolean;
    deafened: boolean;
    screenSharing: boolean;
    systemAudioSharing: boolean;
  };
}

export interface MediaVideoFeed {
  source: string;
  stream?: MediaStream;
  producerId: string;
}

export type MediaAdaptiveEntry = AdaptiveVideoEntry & TopologySourceEntry;
