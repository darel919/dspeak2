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
  ) => unknown;
  unpublishSource: (source: string) => unknown;
  addSource: (entry: TopologySourceEntry) => unknown;
  removeSource: (source: string) => unknown;
  setSourceTransmission?: (source: string, enabled: boolean) => unknown;
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
  getP2pMesh: () => unknown;
  getSfu: () => unknown;
  getVideoReport?: (
    source: string,
  ) => Promise<Map<string, Record<string, unknown>> | null>;
  getVideoSettings?: (source: string) => AdaptiveVideoSettings;
  localSources: Map<string, TopologySourceEntry>;
  localVideoFeeds: Ref<Map<string, MediaVideoFeed>>;
  onSharedAudioStopped?: () => unknown;
  producerFacade: (entry: TopologySourceEntry) => unknown;
  refreshMediaPolicy?: () => Promise<unknown>;
  refreshPublicMaps: () => unknown;
  reportSfuFailure: (reason: string) => unknown;
  send: (message: Record<string, unknown>) => unknown;
  startLocalVoiceDetection: (entry: TopologySourceEntry) => unknown;
  startSharedAudioMeter: (source: string) => unknown;
  stopLocalVoiceDetection: () => unknown;
  stopSharedAudioMeter: () => unknown;
  topologyState: Ref<TopologyState>;
  queueTargetedReconciliation?: (operationId: string, data: unknown) => unknown;
  processPendingRetirements?: () => Promise<void>;
  sendParticipantVoiceState: (state: {
    muted?: boolean;
    deafened?: boolean;
  }) => unknown;
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
