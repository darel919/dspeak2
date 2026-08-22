export type WebRtcLatencyCapabilityState =
  "supported" | "unsupported" | "unknown";

export type WebRtcLatencyProfile = "standard" | "ultra-low";

export type WebRtcLatencyCapabilitiesV1 = {
  version: 1;
  receiverJitterBufferTarget: WebRtcLatencyCapabilityState;
  receiverTargetLatency: WebRtcLatencyCapabilityState;
  senderSetParameters: WebRtcLatencyCapabilityState;
  senderMaxBitrate: WebRtcLatencyCapabilityState;
  senderMaxFramerate: WebRtcLatencyCapabilityState;
  senderScaleResolutionDownBy: WebRtcLatencyCapabilityState;
  senderDegradationPreference: WebRtcLatencyCapabilityState;
  rtcStats: {
    selectedCandidatePairRtt: WebRtcLatencyCapabilityState;
    inboundJitter: WebRtcLatencyCapabilityState;
    jitterBufferDelay: WebRtcLatencyCapabilityState;
    jitterBufferTargetDelay: WebRtcLatencyCapabilityState;
    jitterBufferMinimumDelay: WebRtcLatencyCapabilityState;
    framesDropped: WebRtcLatencyCapabilityState;
    framesDecoded: WebRtcLatencyCapabilityState;
    framesRendered: WebRtcLatencyCapabilityState;
    totalProcessingDelay: WebRtcLatencyCapabilityState;
    estimatedPlayoutTimestamp: WebRtcLatencyCapabilityState;
    encoderImplementation: WebRtcLatencyCapabilityState;
    decoderImplementation: WebRtcLatencyCapabilityState;
    powerEfficientEncoder: WebRtcLatencyCapabilityState;
    powerEfficientDecoder: WebRtcLatencyCapabilityState;
  };
};

export type WebRtcEnvironmentCapabilities = {
  peerConnection: boolean;
  receiverJitterBufferTargetProperty: boolean;
  receiverTargetLatencyProperty: boolean;
  getStats: boolean;
};

export type VideoQualityPriority = "framerate" | "resolution";

export type BrowserMediaTuningContext = {
  profile: WebRtcLatencyProfile;
  qualityPriority: VideoQualityPriority;
  configuredFrameRate: number;
  configuredWidth: number | null;
  configuredHeight: number | null;
};

export type BrowserReceiverTuningReason =
  | "applied"
  | "unsupported"
  | "rejected"
  | "standard-unchanged"
  | "missing-target";

export type BrowserReceiverTuningResult = {
  requestedTargetMs: number | null;
  assignedTargetMs: number | null;
  observedTargetMs: number | null;
  jitterBufferTargetSupported: boolean;
  targetLatencySupported: boolean;
  applied: boolean;
  reason: BrowserReceiverTuningReason;
};

export type BrowserSenderControlName =
  | "maxBitrate"
  | "maxFramerate"
  | "scaleResolutionDownBy"
  | "degradationPreference";

export type BrowserSenderEffectiveParameters = {
  degradationPreference: string | null;
  maxFramerate: number | null;
  scaleResolutionDownBy: number | null;
  maxBitrate: number | null;
};

export type BrowserSenderTuningResult = {
  attempted: boolean;
  applied: boolean;
  verified: boolean;
  changed: boolean;
  appliedControls: readonly BrowserSenderControlName[];
  rejectedControls: readonly BrowserSenderControlName[];
  errorName: string | null;
  effective: BrowserSenderEffectiveParameters;
};

export type NormalizedWebRtcPathStats = {
  timestampMs: number | null;
  rttMs: number | null;
  jitterMs: number | null;
  jitterBufferAverageDelayMs: number | null;
  jitterBufferAverageTargetDelayMs: number | null;
  jitterBufferAverageMinimumDelayMs: number | null;
  packetsLost: number | null;
  packetsReceived: number | null;
  framesDecoded: number | null;
  framesDropped: number | null;
  framesRendered: number | null;
  totalProcessingDelayMs: number | null;
  encoderImplementation: string | null;
  decoderImplementation: string | null;
  powerEfficientEncoder: boolean | null;
  powerEfficientDecoder: boolean | null;
};

export type EffectiveLatencyLevel =
  "ultra-low" | "web-tuned" | "compatibility" | "inactive";

export type WebMediaLatencyTier = "standard-webrtc" | "latency-tuned-webrtc";

export type LatencyWarningReason =
  | "rtt"
  | "jitter"
  | "packet-loss"
  | "jitter-buffer"
  | "audio-concealment"
  | "video-frame-age"
  | "system-overload";

export type ParticipantLatencyStatus = {
  requested: WebRtcLatencyProfile;
  audioSend: EffectiveLatencyLevel;
  audioReceive: EffectiveLatencyLevel;
  videoSend: EffectiveLatencyLevel;
  videoReceive: EffectiveLatencyLevel;
  mediaRttMs: number | null;
  networkWarning: boolean;
  warningReasons: readonly LatencyWarningReason[];
};

export type WebLatencyCapabilitySummary = {
  version: 1;
  runtime: "web";
  latencyTuning: boolean;
  receiverJitterTarget: boolean;
  strictVideoSenderPolicy: boolean;
};
