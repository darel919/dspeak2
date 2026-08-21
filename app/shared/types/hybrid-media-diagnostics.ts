import type { ExternalValue } from "./boundary.ts";

import type { MediaCommandResult } from "./boundary.ts";

import type { Ref } from "vue";
import type { SignalingMessage } from "./media-signaling.ts";
import type { RtpStatsSample } from "../rtc-media-stats.ts";

export interface DiagnosticSourceEntry {
  source: string;
  key?: string;
  peerId?: string | number | null;
  track: MediaStreamTrack;
  consumer?: { getStats: () => Promise<MediaCommandResult> };
  incarnationId?: string;
}

export interface DiagnosticProvider {
  producers?: ReadonlyMap<string, { producer?: DiagnosticProducer }>;
  stats?: () => Promise<MediaCommandResult>;
  diagnosticStats?: () => Promise<MediaCommandResult>;
  getSnapshot?: () => Promise<MediaCommandResult>;
  getOutboundTrackStats?: (source: string) => Promise<MediaCommandResult>;
  getInboundTrackStats?: (
    peerId: string | number,
    track: MediaStreamTrack,
  ) => Promise<MediaCommandResult>;
  getOutboundTrackParameters?: (source: string) => MediaCommandResult;
}

export interface DiagnosticProducer {
  id?: string;
  getStats: () => Promise<MediaCommandResult>;
  rtpParameters?: DiagnosticParameters;
}

export interface DiagnosticParameters {
  encodings?: Array<Record<string, unknown>>;
  degradationPreference?: string;
}

export interface DiagnosticTopologyGraph {
  topology: Record<string, unknown>;
  nodes: unknown[];
  edges: unknown[];
}

export interface HybridMediaDiagnosticsContext {
  collectRtpStats: (
    report: ExternalValue,
    direction: string,
    settings: MediaTrackSettings | Record<string, unknown>,
    previous?: RtpStatsSample | null,
    kind?: string | null,
  ) => {
    sample?: RtpStatsSample | null;
    stats?: Record<string, unknown> | null;
  } | null;
  getActiveProvider: () => string | null;
  getActiveRouteProvider?: () => string | null;
  getAudioLatencySnapshot?: () => Record<string, unknown>;
  getP2pMesh: () => DiagnosticProvider | null;
  getRequestedVideoSettings: (source: string) => { frameRate?: number };
  getLifecycle: () => MediaCommandResult;
  getProtocolState: () => MediaCommandResult;
  getReadiness: () => MediaCommandResult;
  getSfu: () => DiagnosticProvider | null;
  localSources: Map<string, DiagnosticSourceEntry>;
  playbackState: Ref<string>;
  peerRoundTripTimes: Ref<Record<string, unknown>>;
  remoteAudioFeeds: Ref<Map<string, unknown>>;
  refreshTopologyGraph: (pair: ExternalValue) => void;
  remoteVideoFeeds: Ref<Map<string, unknown>>;
  send: (message: SignalingMessage) => MediaCommandResult;
  sfuRoundTripTime: Ref<number | null>;
  topologyGraph: Ref<DiagnosticTopologyGraph>;
  topologyState: Ref<{ epoch?: number }>;
  updateP2pStats: (edges: unknown[]) => MediaCommandResult;
  rtpStatsSamples: Map<string, RtpStatsSample>;
}

export interface MediaReadinessContext {
  connected: boolean;
  mediaConnectionState: string;
  playbackState: string;
  topologyState: { epoch: number };
  transportReady: boolean;
}
