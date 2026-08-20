export type RemoteSourceProvider =
  "p2p" | "sfu" | "cloudflare-realtime" | "native-p2p" | "native-sfu";

export type RemoteSourceKind = "audio" | "video";

export type RemoteSourcePhase =
  | "not-announced"
  | "announced"
  | "publication-discovered"
  | "subscription-requested"
  | "consumer-created"
  | "transport-connected"
  | "rtp-flowing"
  | "first-frame"
  | "renderable"
  | "stalled"
  | "recovering"
  | "retired"
  | "failed";

export interface RemoteSourceIncarnation {
  stableFeedKey: string;
  provider: RemoteSourceProvider;
  peerId: string;
  userId: string;
  source: string;
  connectionEpoch: number;
  sourceGeneration: number;
  publicationId?: string;
  producerId?: string;
  consumerId?: string;
  cloudflareSessionId?: string;
  cloudflareTrackName?: string;
  nativeTrackHandle?: unknown;
  logicalStreamId?: string;
  variantId?: string;
}

export interface RemoteSourceConvergenceState {
  incarnation: RemoteSourceIncarnation;
  phase: RemoteSourcePhase;
  previousPhase: RemoteSourcePhase | null;
  phaseEnteredAt: number;
  rtpEvidence: {
    lastBytesReceived: number;
    lastPacketsReceived: number;
    lastFramesDecoded: number;
    lastFramesRendered: number;
    samples: Array<{
      timestamp: number;
      bytesReceived: number;
      packetsReceived: number;
      framesDecoded: number;
      framesRendered: number;
    }>;
    rtpFlowingConfirmed: boolean;
    rtpFlowingConfirmedAt: number | null;
  };
  firstFrameEvidence: {
    received: boolean;
    receivedAt: number | null;
    callbackHandle: number | null;
    element: HTMLVideoElement | null;
    stream: MediaStream | null;
    track: MediaStreamTrack | null;
  };
  stallState: {
    detected: boolean;
    detectedAt: number | null;
    recoveryAttempt: number;
    recoveryTimer: ReturnType<typeof setTimeout> | null;
  };
  intentionalReceivingDisabled: boolean;
  retired: boolean;
  failed: boolean;
  abortController: AbortController;
}

export interface RemoteSourceFSMConfig {
  rtpStallThresholdMs: number;
  firstFrameTimeoutMs: number;
  maxRecoveryAttempts: number;
  statsSampleIntervalMs: number;
}

export const DEFAULT_REMOTE_SOURCE_FSM_CONFIG: RemoteSourceFSMConfig = {
  rtpStallThresholdMs: 3000,
  firstFrameTimeoutMs: 5000,
  maxRecoveryAttempts: 3,
  statsSampleIntervalMs: 1000,
};

export function createRemoteSourceIncarnation({
  stableFeedKey,
  provider,
  peerId,
  userId,
  source,
  connectionEpoch,
  sourceGeneration,
  publicationId,
  producerId,
  consumerId,
  cloudflareSessionId,
  cloudflareTrackName,
  nativeTrackHandle,
  logicalStreamId,
  variantId,
}: {
  stableFeedKey: string;
  provider: RemoteSourceProvider;
  peerId: string;
  userId: string;
  source: string;
  connectionEpoch: number;
  sourceGeneration: number;
  publicationId?: string;
  producerId?: string;
  consumerId?: string;
  cloudflareSessionId?: string;
  cloudflareTrackName?: string;
  nativeTrackHandle?: unknown;
  logicalStreamId?: string;
  variantId?: string;
}): RemoteSourceIncarnation {
  return {
    stableFeedKey,
    provider,
    peerId,
    userId,
    source,
    connectionEpoch,
    sourceGeneration,
    publicationId,
    producerId,
    consumerId,
    cloudflareSessionId,
    cloudflareTrackName,
    nativeTrackHandle,
    logicalStreamId,
    variantId,
  };
}

export function compareIncarnationAuthority(
  a: RemoteSourceIncarnation,
  b: RemoteSourceIncarnation,
): number {
  if (a.connectionEpoch !== b.connectionEpoch) {
    return a.connectionEpoch - b.connectionEpoch;
  }
  if (a.sourceGeneration !== b.sourceGeneration) {
    return a.sourceGeneration - b.sourceGeneration;
  }
  return 0;
}

export function isIncarnationCurrent(
  current: RemoteSourceIncarnation | null,
  candidate: RemoteSourceIncarnation,
): boolean {
  if (!current) return false;
  return compareIncarnationAuthority(current, candidate) === 0;
}

export function isIncarnationNewer(
  current: RemoteSourceIncarnation | null,
  candidate: RemoteSourceIncarnation,
): boolean {
  if (!current) return true;
  return compareIncarnationAuthority(current, candidate) < 0;
}

export function isIncarnationOlder(
  current: RemoteSourceIncarnation | null,
  candidate: RemoteSourceIncarnation,
): boolean {
  if (!current) return false;
  return compareIncarnationAuthority(current, candidate) > 0;
}

export function createRemoteSourceConvergenceState(
  incarnation: RemoteSourceIncarnation,
): RemoteSourceConvergenceState {
  return {
    incarnation,
    phase: "not-announced",
    previousPhase: null,
    phaseEnteredAt: Date.now(),
    rtpEvidence: {
      lastBytesReceived: 0,
      lastPacketsReceived: 0,
      lastFramesDecoded: 0,
      lastFramesRendered: 0,
      samples: [],
      rtpFlowingConfirmed: false,
      rtpFlowingConfirmedAt: null,
    },
    firstFrameEvidence: {
      received: false,
      receivedAt: null,
      callbackHandle: null,
      element: null,
      stream: null,
      track: null,
    },
    stallState: {
      detected: false,
      detectedAt: null,
      recoveryAttempt: 0,
      recoveryTimer: null,
    },
    intentionalReceivingDisabled: false,
    retired: false,
    failed: false,
    abortController: new AbortController(),
  };
}

export function advancePhase(
  state: RemoteSourceConvergenceState,
  newPhase: RemoteSourcePhase,
  now = Date.now(),
): boolean {
  const validTransitions: Record<RemoteSourcePhase, RemoteSourcePhase[]> = {
    "not-announced": ["announced", "retired", "failed"],
    announced: [
      "publication-discovered",
      "subscription-requested",
      "retired",
      "failed",
    ],
    "publication-discovered": [
      "subscription-requested",
      "consumer-created",
      "retired",
      "failed",
    ],
    "subscription-requested": ["consumer-created", "retired", "failed"],
    "consumer-created": ["transport-connected", "retired", "failed"],
    "transport-connected": ["rtp-flowing", "stalled", "retired", "failed"],
    "rtp-flowing": [
      "first-frame",
      "renderable",
      "stalled",
      "retired",
      "failed",
    ],
    "first-frame": ["renderable", "stalled", "retired", "failed"],
    renderable: ["stalled", "retired", "failed"],
    stalled: ["recovering", "rtp-flowing", "first-frame", "retired", "failed"],
    recovering: [
      "rtp-flowing",
      "first-frame",
      "renderable",
      "stalled",
      "failed",
    ],
    retired: [],
    failed: [],
  };

  const allowed = validTransitions[state.phase] || [];
  if (!allowed.includes(newPhase)) {
    return false;
  }

  state.previousPhase = state.phase;
  state.phase = newPhase;
  state.phaseEnteredAt = now;

  // Set terminal state flags
  if (newPhase === "retired") {
    state.retired = true;
    state.abortController.abort();
  }
  if (newPhase === "failed") {
    state.failed = true;
  }

  return true;
}

export function checkRtpProgression(
  state: RemoteSourceConvergenceState,
  sample: {
    bytesReceived: number;
    packetsReceived: number;
    framesDecoded?: number;
    framesRendered?: number;
  },
  now = Date.now(),
): boolean {
  const { rtpEvidence } = state;

  // First sample establishes baseline - no progression detected yet
  const isFirstSample = rtpEvidence.samples.length === 0;

  const progression =
    !isFirstSample &&
    (sample.bytesReceived > rtpEvidence.lastBytesReceived ||
      sample.packetsReceived > rtpEvidence.lastPacketsReceived ||
      (sample.framesDecoded !== undefined &&
        sample.framesDecoded > rtpEvidence.lastFramesDecoded) ||
      (sample.framesRendered !== undefined &&
        sample.framesRendered > rtpEvidence.lastFramesRendered));

  rtpEvidence.samples.push({
    timestamp: now,
    bytesReceived: sample.bytesReceived,
    packetsReceived: sample.packetsReceived,
    framesDecoded: sample.framesDecoded ?? rtpEvidence.lastFramesDecoded,
    framesRendered: sample.framesRendered ?? rtpEvidence.lastFramesRendered,
  });

  if (rtpEvidence.samples.length > 10) {
    rtpEvidence.samples.shift();
  }

  rtpEvidence.lastBytesReceived = sample.bytesReceived;
  rtpEvidence.lastPacketsReceived = sample.packetsReceived;
  if (sample.framesDecoded !== undefined)
    rtpEvidence.lastFramesDecoded = sample.framesDecoded;
  if (sample.framesRendered !== undefined)
    rtpEvidence.lastFramesRendered = sample.framesRendered;

  // Require at least 2 samples to confirm RTP flowing (progression over time)
  if (
    progression &&
    rtpEvidence.samples.length >= 2 &&
    !rtpEvidence.rtpFlowingConfirmed
  ) {
    rtpEvidence.rtpFlowingConfirmed = true;
    rtpEvidence.rtpFlowingConfirmedAt = now;
  }

  return progression;
}

export function checkAudioRtpProgression(
  state: RemoteSourceConvergenceState,
  sample: {
    bytesReceived: number;
    packetsReceived: number;
    totalAudioEnergy?: number;
    totalSamplesReceived?: number;
    jitterBufferEmittedCount?: number;
  },
  now = Date.now(),
): boolean {
  const { rtpEvidence } = state;
  const evidence = state.rtpEvidence as any;

  // Initialize audio-specific fields if not present
  if (evidence.lastTotalAudioEnergy === undefined)
    evidence.lastTotalAudioEnergy = 0;
  if (evidence.lastTotalSamplesReceived === undefined)
    evidence.lastTotalSamplesReceived = 0;
  if (evidence.lastJitterBufferEmittedCount === undefined)
    evidence.lastJitterBufferEmittedCount = 0;

  // First sample establishes baseline - no progression detected yet
  const isFirstSample = evidence.samples.length === 0;

  const progression =
    !isFirstSample &&
    (sample.bytesReceived > evidence.lastBytesReceived ||
      sample.packetsReceived > evidence.lastPacketsReceived ||
      (sample.totalAudioEnergy !== undefined &&
        sample.totalAudioEnergy > evidence.lastTotalAudioEnergy) ||
      (sample.totalSamplesReceived !== undefined &&
        sample.totalSamplesReceived > evidence.lastTotalSamplesReceived) ||
      (sample.jitterBufferEmittedCount !== undefined &&
        sample.jitterBufferEmittedCount >
          evidence.lastJitterBufferEmittedCount));

  evidence.samples.push({
    timestamp: now,
    bytesReceived: sample.bytesReceived,
    packetsReceived: sample.packetsReceived,
    framesDecoded: evidence.lastFramesDecoded,
    framesRendered: evidence.lastFramesRendered,
  });

  if (evidence.samples.length > 10) {
    evidence.samples.shift();
  }

  evidence.lastBytesReceived = sample.bytesReceived;
  evidence.lastPacketsReceived = sample.packetsReceived;
  if (sample.totalAudioEnergy !== undefined)
    evidence.lastTotalAudioEnergy = sample.totalAudioEnergy;
  if (sample.totalSamplesReceived !== undefined)
    evidence.lastTotalSamplesReceived = sample.totalSamplesReceived;
  if (sample.jitterBufferEmittedCount !== undefined)
    evidence.lastJitterBufferEmittedCount = sample.jitterBufferEmittedCount;

  // Require at least 2 samples to confirm RTP flowing
  if (
    progression &&
    evidence.samples.length >= 2 &&
    !evidence.rtpFlowingConfirmed
  ) {
    evidence.rtpFlowingConfirmed = true;
    evidence.rtpFlowingConfirmedAt = now;
  }

  return progression;
}

export function hasRtpFlowingEvidence(
  state: RemoteSourceConvergenceState,
): boolean {
  return (
    state.rtpEvidence.rtpFlowingConfirmed ||
    (state.rtpEvidence as any).rtpFlowingConfirmed === true
  );
}

export function hasFirstFrameEvidence(
  state: RemoteSourceConvergenceState,
): boolean {
  return state.firstFrameEvidence.received;
}

export function canBecomeRenderable(
  state: RemoteSourceConvergenceState,
): boolean {
  return (
    hasRtpFlowingEvidence(state) &&
    hasFirstFrameEvidence(state) &&
    state.phase === "first-frame"
  );
}

export function canBecomeAudioRenderable(
  state: RemoteSourceConvergenceState,
): boolean {
  return (
    hasRtpFlowingEvidence(state) &&
    (state.phase === "rtp-flowing" || state.phase === "transport-connected")
  );
}

export function scheduleFirstFrameCallback(
  state: RemoteSourceConvergenceState,
  element: HTMLVideoElement,
  stream: MediaStream,
  track: MediaStreamTrack,
  onFirstFrame: () => void,
): void {
  if (state.firstFrameEvidence.callbackHandle) {
    element.cancelVideoFrameCallback(state.firstFrameEvidence.callbackHandle);
  }

  state.firstFrameEvidence.element = element;
  state.firstFrameEvidence.stream = stream;
  state.firstFrameEvidence.track = track;

  if (typeof element.requestVideoFrameCallback === "function") {
    const handle = element.requestVideoFrameCallback(() => {
      if (state.firstFrameEvidence.callbackHandle === handle) {
        state.firstFrameEvidence.callbackHandle = null;
        state.firstFrameEvidence.received = true;
        state.firstFrameEvidence.receivedAt = Date.now();
        onFirstFrame();
      }
    });
    state.firstFrameEvidence.callbackHandle = handle;
  } else {
    state.firstFrameEvidence.received = true;
    state.firstFrameEvidence.receivedAt = Date.now();
    onFirstFrame();
  }
}

export function cancelFirstFrameCallback(
  state: RemoteSourceConvergenceState,
): void {
  if (
    state.firstFrameEvidence.callbackHandle &&
    state.firstFrameEvidence.element
  ) {
    state.firstFrameEvidence.element.cancelVideoFrameCallback(
      state.firstFrameEvidence.callbackHandle,
    );
  }
  state.firstFrameEvidence.callbackHandle = null;
  state.firstFrameEvidence.element = null;
  state.firstFrameEvidence.stream = null;
  state.firstFrameEvidence.track = null;
}

export function retireIncarnation(state: RemoteSourceConvergenceState): void {
  state.retired = true;
  state.abortController.abort();
  cancelFirstFrameCallback(state);
  if (state.stallState.recoveryTimer) {
    clearTimeout(state.stallState.recoveryTimer);
    state.stallState.recoveryTimer = null;
  }
}

export function setIntentionalReceivingDisabled(
  state: RemoteSourceConvergenceState,
  disabled: boolean,
): void {
  state.intentionalReceivingDisabled = disabled;
  if (disabled && state.stallState.recoveryTimer) {
    clearTimeout(state.stallState.recoveryTimer);
    state.stallState.recoveryTimer = null;
  }
}

export function detectStall(
  state: RemoteSourceConvergenceState,
  config: RemoteSourceFSMConfig,
  now = Date.now(),
): boolean {
  if (
    state.intentionalReceivingDisabled ||
    state.retired ||
    state.failed ||
    state.phase === "not-announced" ||
    state.phase === "announced" ||
    state.phase === "publication-discovered" ||
    state.phase === "subscription-requested" ||
    state.phase === "consumer-created"
  ) {
    return false;
  }

  const timeSincePhase = now - state.phaseEnteredAt;

  if (state.phase === "transport-connected") {
    if (
      timeSincePhase >= config.rtpStallThresholdMs &&
      !hasRtpFlowingEvidence(state)
    ) {
      state.stallState.detected = true;
      state.stallState.detectedAt = now;
      return true;
    }
  }

  if (state.phase === "rtp-flowing" || state.phase === "first-frame") {
    if (
      timeSincePhase >= config.firstFrameTimeoutMs &&
      !hasFirstFrameEvidence(state)
    ) {
      state.stallState.detected = true;
      state.stallState.detectedAt = now;
      return true;
    }
  }

  if (state.phase === "renderable" && !hasRtpFlowingEvidence(state)) {
    if (timeSincePhase >= config.rtpStallThresholdMs) {
      state.stallState.detected = true;
      state.stallState.detectedAt = now;
      return true;
    }
  }

  return false;
}

export function scheduleRecovery(
  state: RemoteSourceConvergenceState,
  config: RemoteSourceFSMConfig,
  onRecovery: () => void,
): void {
  if (state.intentionalReceivingDisabled || state.retired || state.failed) {
    state.failed = true;
    return;
  }

  state.stallState.recoveryAttempt++;

  if (state.stallState.recoveryAttempt >= config.maxRecoveryAttempts) {
    state.failed = true;
    return;
  }

  state.phase = "recovering";

  if (state.stallState.recoveryTimer) {
    clearTimeout(state.stallState.recoveryTimer);
  }

  const delay = Math.min(
    1000 * 2 ** (state.stallState.recoveryAttempt - 1),
    10000,
  );
  state.stallState.recoveryTimer = setTimeout(() => {
    state.stallState.recoveryTimer = null;
    onRecovery();
  }, delay);
}

export function clearStall(state: RemoteSourceConvergenceState): void {
  state.stallState.detected = false;
  state.stallState.detectedAt = null;
  state.stallState.recoveryAttempt = 0;
  if (state.stallState.recoveryTimer) {
    clearTimeout(state.stallState.recoveryTimer);
    state.stallState.recoveryTimer = null;
  }
  if (state.phase === "recovering" || state.phase === "stalled") {
    state.phase = "rtp-flowing";
  }
}
