import type { Ref } from "vue";
import type { RtpStatsSample } from "./rtc-media-stats.ts";
import type { PeerMetric } from "../../../shared/types/media.ts";

export interface RtcTransportPair {
  currentRoundTripTime?: unknown;
  packetLoss?: unknown;
  bytesSent?: number;
  bytesReceived?: number;
  availableOutgoingBitrate?: number;
  availableIncomingBitrate?: number;
  local?: { candidateType?: unknown; protocol?: unknown };
  [key: string]: unknown;
}

interface RtcInboundAudioStats {
  jitter?: unknown;
  jitterBufferDelay?: unknown;
  averageJitterBufferTargetDelay?: unknown;
  averageJitterBufferMinimumDelay?: unknown;
  averageJitterBufferTargetDelayMs?: unknown;
  averageJitterBufferMinimumDelayMs?: unknown;
  jitterBufferEmittedCount?: unknown;
}

interface RtcPeerConnectionStates {
  connectionState?: unknown;
  iceConnectionState?: unknown;
  signalingState?: unknown;
}

export interface RtcTransportSnapshot extends PeerMetric {
  id?: unknown;
  rttMs?: unknown;
  jitterMs?: unknown;
  packetLossPercent?: unknown;
  availableOutgoingBitrate?: unknown;
  availableIncomingBitrate?: unknown;
  jitterBufferDelayMs?: unknown;
  jitterBufferTargetDelayMs?: unknown;
  jitterBufferMinimumDelayMs?: unknown;
  jitterBufferEmittedCount?: unknown;
  candidateType?: unknown;
  protocol?: unknown;
  pcStates?: RtcPeerConnectionStates;
  inboundAudio?: RtcInboundAudioStats;
  candidatePair?:
    (RtcTransportPair & NonNullable<PeerMetric["candidatePair"]>) | null;
  [key: string]: unknown;
}

export interface RtcStatsSnapshot {
  timestamp: number;
  transports?: RtcTransportSnapshot[];
  protocol?: unknown;
  lifecycle?: unknown[];
  readiness?: unknown;
  [key: string]: unknown;
}

export interface RtcStatsSession {
  getWebRTCStatsSnapshot: () => Promise<RtcStatsSnapshot>;
  getOutboundRtpStats?: () => Promise<unknown>;
  getInboundRtpStats?: () => Promise<unknown>;
  getWebRTCDiagnosticStats?: () => Promise<unknown>;
}

export interface RtcDiagnosticError {
  label: string;
  message: string;
}

export interface RtcTrafficSample {
  bytesSent: number | null;
  bytesReceived: number | null;
  timestamp: number;
}

export interface RtcHistorySample {
  value: number | null;
  timestamp: number;
}

export interface RtcHistory {
  rtt: RtcHistorySample[];
  availableOutgoingBitrate: RtcHistorySample[];
  outgoingBitrate: RtcHistorySample[];
  incomingAvailableBitrate: RtcHistorySample[];
  incomingBitrate: RtcHistorySample[];
  jitter: RtcHistorySample[];
  loss: RtcHistorySample[];
}

export type RtcMetricValue = number | string | null | undefined;

export type RtcHistoryRef = Ref<RtcHistorySample[]>;

export type RtcSample = RtpStatsSample;
