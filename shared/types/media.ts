export type CircuitBreakerState = "closed" | "open" | "half-open";

export type CircuitBreaker = {
  state: CircuitBreakerState;
  failureCount: number;
  lastFailure: number;
  nextAttempt: number;
};

export type RouteMetrics = {
  [field: string]: number | null | undefined;
};

export type PeerMetric = {
  peerId?: unknown;
  userId?: unknown;
  rtt?: unknown;
  packetLoss?: unknown;
  jitter?: unknown;
  pcStates?: { iceConnectionState?: unknown };
  candidatePair?: {
    currentRoundTripTime?: unknown;
    packetLoss?: unknown;
  } | null;
  inboundAudio?: { jitter?: unknown };
  outboundAudio?: { packetsSent?: unknown };
  remoteInboundAudio?: { fractionLost?: unknown };
};

export type JitterBufferStat = {
  jitterBufferDelay?: unknown;
  jitterBufferEmittedCount?: unknown;
  averageMs?: number | null;
};

export type ConnectionMetric = {
  rttMs: number | null;
  packetLossPercent: number | null;
  jitterMs: number | null;
};

export type PolicyLimits = {
  min: number;
  max: number;
  default: number;
};

export type MediaPolicyInput = {
  microphoneKbps?: unknown;
  cameraKbps?: unknown;
  screenKbps?: unknown;
  sharedAudioKbps?: unknown;
  hdAudio?: unknown;
  connectionMode?: unknown;
  audioLatencyProfile?: unknown;
  revision?: unknown;
  updatedAt?: unknown;
};

export type AudioLatencyProfile = "standard" | "ultra-low";

export type ConnectionMode = "auto" | "direct";
export type MediaRouteKind = "local" | "p2p" | "sfu";
export type P2PPath = "direct" | "relay";
export type SFUProvider = "cloudflare-realtime" | "mediasoup";

export type LocalRoute = {
  kind: "local";
  epoch: number;
  sourceRevision: number;
  reason: string;
};

export type P2PRoute = {
  kind: "p2p";
  path: P2PPath;
  epoch: number;
  sourceRevision: number;
  reason: string;
};

export type SFURoute = {
  kind: "sfu";
  provider: SFUProvider;
  providerId?: string | null;
  epoch: number;
  sourceRevision: number;
  reason: string;
};

export type MediaRoute = LocalRoute | P2PRoute | SFURoute;

export type MediaPathMetrics = {
  routeId: string;
  peerOrProvider: string;
  rttMs: number | null;
  jitterMs: number | null;
  packetLossPercent: number | null;
  jitterBufferDelayMs: number | null;
  availableOutgoingBitrate: number | null;
  concealedAudioRatio: number | null;
  candidateType?: "host" | "srflx" | "relay";
  protocol?: "udp" | "tcp" | "tls";
  sampledAt: number;
};

export type RawMediaPathMetrics = {
  routeId?: unknown;
  peerOrProvider?: unknown;
  packetLossFraction?: unknown;
  packetLossPercent?: unknown;
  rttMs?: unknown;
  rttSeconds?: unknown;
  jitterMs?: unknown;
  jitterSeconds?: unknown;
  jitterBufferDelayMs?: unknown;
  jitterBufferDelaySeconds?: unknown;
  availableOutgoingBitrate?: unknown;
  concealedAudioRatio?: unknown;
  candidateType?: "host" | "srflx" | "relay";
  protocol?: "udp" | "tcp" | "tls";
  sampledAt?: unknown;
};

export type MediaSignalingRecord = {
  protocolVersion?: unknown;
  contractRevision?: unknown;
  mediaSessionId?: unknown;
  heartbeatIntervalMs?: unknown;
  heartbeatTimeoutMs?: unknown;
  serverTime?: unknown;
};

export type MediaSignalingServerHello = MediaSignalingRecord & {
  protocolVersion: number;
  contractRevision: number;
  mediaSessionId: string;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  serverTime: number;
};

export type P2PSource = "camera" | "screen" | string;
export type ProviderHealth = Record<string, { healthy: boolean }>;
export type IceCandidate = { type?: unknown } | null | undefined;
