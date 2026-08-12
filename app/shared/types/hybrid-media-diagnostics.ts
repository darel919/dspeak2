import type { Ref } from "vue";
import type { SignalingMessage } from "./media-signaling.ts";
import type { RtpStatsSample } from "../rtc-media-stats.ts";

export interface DiagnosticSourceEntry {
  source: string;
  key?: string;
  peerId?: string | number | null;
  track: MediaStreamTrack;
  consumer?: { getStats: () => Promise<unknown> };
}

export interface DiagnosticProvider {
  producers?: Map<string, { producer: DiagnosticProducer }>;
  stats?: () => Promise<unknown>;
  diagnosticStats?: () => Promise<unknown>;
  getSnapshot?: () => Promise<unknown>;
  getOutboundTrackStats?: (source: string) => Promise<unknown>;
  getInboundTrackStats?: (
    peerId: string | number | null | undefined,
    track: MediaStreamTrack,
  ) => Promise<unknown>;
  getOutboundTrackParameters?: (source: string) => DiagnosticParameters | null;
}

export interface DiagnosticProducer {
  id?: string;
  getStats: () => Promise<unknown>;
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
    report: unknown,
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
  getP2pMesh: () => unknown;
  getRequestedVideoSettings: (source: string) => { frameRate?: number };
  getLifecycle: () => unknown;
  getProtocolState: () => unknown;
  getReadiness: () => unknown;
  getSfu: () => unknown;
  localSources: Map<string, DiagnosticSourceEntry>;
  playbackState: Ref<string>;
  peerRoundTripTimes: Ref<Record<string, unknown>>;
  remoteAudioFeeds: Ref<Map<string, unknown>>;
  refreshTopologyGraph: (pair: null) => void;
  remoteVideoFeeds: Ref<Map<string, unknown>>;
  send: (message: SignalingMessage) => unknown;
  sfuRoundTripTime: Ref<number | null>;
  topologyGraph: Ref<DiagnosticTopologyGraph>;
  topologyState: Ref<{ epoch?: number }>;
  updateP2pStats: (edges: unknown[]) => unknown;
  rtpStatsSamples: Map<string, RtpStatsSample>;
}

export interface MediaReadinessContext {
  connected: boolean;
  mediaConnectionState: string;
  playbackState: string;
  topologyState: { epoch: number };
  transportReady: boolean;
}
