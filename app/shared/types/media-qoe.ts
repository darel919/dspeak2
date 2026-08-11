export type MediaQoeRecord = {
  [key: string]: unknown;
  routeId?: unknown;
  peerOrProvider?: unknown;
  fractionLost?: unknown;
  packetLossFraction?: unknown;
  packetLossPercent?: unknown;
  packetLoss?: unknown;
  rttMs?: unknown;
  rtt?: unknown;
  jitterMs?: unknown;
  jitter?: unknown;
  jitterBufferDelayMs?: unknown;
  jitterBufferDelay?: unknown;
  availableOutgoingBitrate?: unknown;
  availableOutgoingBitrateBps?: unknown;
  concealedAudioRatio?: unknown;
  concealedAudio?: unknown;
  candidateType?: unknown;
  protocol?: unknown;
  sampledAt?: unknown;
  paths?: unknown;
  transports?: unknown;
  id?: unknown;
  viable?: unknown;
  requiredParticipants?: unknown;
  readyParticipants?: unknown;
  stabilityScore?: unknown;
  infrastructureCost?: unknown;
  stableSince?: unknown;
  failed?: unknown;
};

export type QoeDecisionOptions = {
  now?: number;
  minimumImprovementMs?: number;
  stabilityMs?: number;
  failure?: boolean;
};
