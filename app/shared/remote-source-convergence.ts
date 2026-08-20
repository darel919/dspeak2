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
  receiverIncarnationId: string;
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

export interface RtpEvidenceBase {
  lastBytesReceived: number;
  lastPacketsReceived: number;
  lastRtpSampleAt: number | null;
  lastRtpProgressAt: number | null;
  lastNetworkProgressAt: number | null;
  samples: Array<{
    timestamp: number;
    bytesReceived: number;
    packetsReceived: number;
  }>;
  rtpFlowingConfirmed: boolean;
  rtpFlowingConfirmedAt: number | null;
}

export interface VideoRtpEvidence extends RtpEvidenceBase {
  kind: "video";
  lastFramesReceived: number;
  lastFramesDecoded: number;
  lastFramesRendered: number;
  lastPacketReceivedTimestamp: number | null;
  lastFrameReceivedProgressAt: number | null;
  lastDecodeProgressAt: number | null;
  lastStatsRenderProgressAt: number | null;
  lastPresentationProgressAt: number | null;
  presentationProgressCount: number;
  observedPresentationProgressCount: number;
  decoderStallSamples: number;
  renderStallSamples: number;
}

export interface AudioRtpEvidence extends RtpEvidenceBase {
  kind: "audio";
  lastTotalAudioEnergy: number;
  lastTotalSamplesReceived: number;
  lastJitterBufferEmittedCount: number;
}

export type RemoteSourceRtpEvidence = VideoRtpEvidence | AudioRtpEvidence;

export type RemoteSourceStallCause =
  "no-rtp" | "first-frame-timeout" | "decoder-stall" | "render-stall";

export type RemotePresentationObservationMode =
  "rvfc" | "native" | "stats" | "unavailable";

export interface RemoteReceiverStats {
  bytesReceived: number;
  packetsReceived: number;
  framesReceived?: number;
  framesDecoded?: number;
  framesRendered?: number;
  framesPerSecond?: number;
  freezeCount?: number;
  totalFreezesDuration?: number;
  pauseCount?: number;
  totalPausesDuration?: number;
  lastPacketReceivedTimestamp?: number;
  totalAudioEnergy?: number;
  totalSamplesReceived?: number;
  jitterBufferEmittedCount?: number;
}

export interface RemoteSourceConvergenceState {
  incarnation: RemoteSourceIncarnation;
  kind: RemoteSourceKind;
  presentationObservationMode: RemotePresentationObservationMode;
  phase: RemoteSourcePhase;
  previousPhase: RemoteSourcePhase | null;
  phaseEnteredAt: number;
  rtpEvidence: RemoteSourceRtpEvidence;
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
    cause: RemoteSourceStallCause | null;
    recoveryAttempt: number;
    recoveryTimer: ReturnType<typeof setTimeout> | null;
  };
  outputBindingReady: boolean;
  intentionalReceivingDisabled: boolean;
  retired: boolean;
  failed: boolean;
  abortController: AbortController;
}

export interface RemoteSourceFSMConfig {
  rtpStallThresholdMs: number;
  firstFrameTimeoutMs: number;
  videoPipelineStallSamples: number;
  maxRecoveryAttempts: number;
  statsSampleIntervalMs: number;
}

export const DEFAULT_REMOTE_SOURCE_FSM_CONFIG: RemoteSourceFSMConfig = {
  rtpStallThresholdMs: 3000,
  firstFrameTimeoutMs: 5000,
  videoPipelineStallSamples: 2,
  maxRecoveryAttempts: 3,
  statsSampleIntervalMs: 1000,
};

function sourceKind(source: string): RemoteSourceKind {
  return source === "camera" || source === "screen" ? "video" : "audio";
}

function receiverIdentityPart(value: unknown): string {
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  return "";
}

export function buildRemoteReceiverIncarnationId({
  stableFeedKey,
  provider,
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
}): string {
  return [
    provider,
    stableFeedKey,
    connectionEpoch,
    sourceGeneration,
    publicationId,
    producerId,
    consumerId,
    cloudflareSessionId,
    cloudflareTrackName,
    receiverIdentityPart(nativeTrackHandle),
    logicalStreamId,
    variantId,
  ]
    .map((value) => receiverIdentityPart(value))
    .join("|");
}

export function createRemoteSourceIncarnation({
  receiverIncarnationId,
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
  receiverIncarnationId?: string;
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
    receiverIncarnationId: receiverIncarnationId
      ? `${receiverIncarnationId}|${connectionEpoch}|${sourceGeneration}`
      : buildRemoteReceiverIncarnationId({
          stableFeedKey,
          provider,
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
        }),
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
  if (a.connectionEpoch !== b.connectionEpoch)
    return a.connectionEpoch - b.connectionEpoch;
  if (a.sourceGeneration !== b.sourceGeneration)
    return a.sourceGeneration - b.sourceGeneration;
  return 0;
}

export function isIncarnationCurrent(
  current: RemoteSourceIncarnation | null,
  candidate: RemoteSourceIncarnation,
): boolean {
  return Boolean(
    current &&
    current.receiverIncarnationId === candidate.receiverIncarnationId,
  );
}

function createRtpEvidence(kind: RemoteSourceKind): RemoteSourceRtpEvidence {
  const base = {
    lastBytesReceived: 0,
    lastPacketsReceived: 0,
    lastRtpSampleAt: null,
    lastRtpProgressAt: null,
    lastNetworkProgressAt: null,
    samples: [],
    rtpFlowingConfirmed: false,
    rtpFlowingConfirmedAt: null,
  };
  return kind === "video"
    ? {
        ...base,
        kind,
        lastFramesReceived: 0,
        lastFramesDecoded: 0,
        lastFramesRendered: 0,
        lastPacketReceivedTimestamp: null,
        lastFrameReceivedProgressAt: null,
        lastDecodeProgressAt: null,
        lastStatsRenderProgressAt: null,
        lastPresentationProgressAt: null,
        presentationProgressCount: 0,
        observedPresentationProgressCount: 0,
        decoderStallSamples: 0,
        renderStallSamples: 0,
      }
    : {
        ...base,
        kind,
        lastTotalAudioEnergy: 0,
        lastTotalSamplesReceived: 0,
        lastJitterBufferEmittedCount: 0,
      };
}

export function createRemoteSourceConvergenceState(
  incarnation: RemoteSourceIncarnation,
): RemoteSourceConvergenceState {
  return {
    incarnation,
    kind: sourceKind(incarnation.source),
    presentationObservationMode: "unavailable",
    phase: "not-announced",
    previousPhase: null,
    phaseEnteredAt: Date.now(),
    rtpEvidence: createRtpEvidence(sourceKind(incarnation.source)),
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
      cause: null,
      recoveryAttempt: 0,
      recoveryTimer: null,
    },
    outputBindingReady: true,
    intentionalReceivingDisabled: false,
    retired: false,
    failed: false,
    abortController: new AbortController(),
  };
}

const VALID_TRANSITIONS: Record<RemoteSourcePhase, RemoteSourcePhase[]> = {
  "not-announced": ["announced", "retired", "failed"],
  announced: [
    "publication-discovered",
    "subscription-requested",
    "transport-connected",
    "retired",
    "failed",
  ],
  "publication-discovered": [
    "subscription-requested",
    "consumer-created",
    "transport-connected",
    "retired",
    "failed",
  ],
  "subscription-requested": [
    "consumer-created",
    "transport-connected",
    "retired",
    "failed",
  ],
  "consumer-created": ["transport-connected", "retired", "failed"],
  "transport-connected": ["rtp-flowing", "stalled", "retired", "failed"],
  "rtp-flowing": ["first-frame", "renderable", "stalled", "retired", "failed"],
  "first-frame": ["renderable", "stalled", "retired", "failed"],
  renderable: ["stalled", "retired", "failed"],
  stalled: ["recovering", "rtp-flowing", "first-frame", "retired", "failed"],
  recovering: [
    "rtp-flowing",
    "first-frame",
    "renderable",
    "stalled",
    "retired",
    "failed",
  ],
  retired: [],
  failed: [],
};

export function advancePhase(
  state: RemoteSourceConvergenceState,
  newPhase: RemoteSourcePhase,
  now = Date.now(),
): boolean {
  if (!VALID_TRANSITIONS[state.phase]?.includes(newPhase)) return false;
  state.previousPhase = state.phase;
  state.phase = newPhase;
  state.phaseEnteredAt = now;
  if (newPhase === "retired") {
    state.retired = true;
    state.abortController.abort();
  }
  if (newPhase === "failed") state.failed = true;
  return true;
}

function videoNetworkProgressed(
  evidence: VideoRtpEvidence,
  sample: RemoteReceiverStats,
): boolean {
  return (
    sample.bytesReceived > evidence.lastBytesReceived ||
    sample.packetsReceived > evidence.lastPacketsReceived ||
    (sample.lastPacketReceivedTimestamp !== undefined &&
      (evidence.lastPacketReceivedTimestamp === null ||
        sample.lastPacketReceivedTimestamp >
          evidence.lastPacketReceivedTimestamp))
  );
}

function audioProgressed(
  evidence: AudioRtpEvidence,
  sample: RemoteReceiverStats,
): boolean {
  return (
    sample.bytesReceived > evidence.lastBytesReceived ||
    sample.packetsReceived > evidence.lastPacketsReceived ||
    (sample.totalAudioEnergy !== undefined &&
      sample.totalAudioEnergy > evidence.lastTotalAudioEnergy) ||
    (sample.totalSamplesReceived !== undefined &&
      sample.totalSamplesReceived > evidence.lastTotalSamplesReceived) ||
    (sample.jitterBufferEmittedCount !== undefined &&
      sample.jitterBufferEmittedCount > evidence.lastJitterBufferEmittedCount)
  );
}

function recordRtpSample(
  state: RemoteSourceConvergenceState,
  sample: RemoteReceiverStats,
  now: number,
  progression: boolean,
) {
  const evidence = state.rtpEvidence;
  evidence.lastRtpSampleAt = now;
  if (progression) {
    evidence.lastRtpProgressAt = now;
    evidence.lastNetworkProgressAt = now;
  }
  evidence.samples.push({
    timestamp: now,
    bytesReceived: sample.bytesReceived,
    packetsReceived: sample.packetsReceived,
  });
  if (evidence.samples.length > 10) evidence.samples.shift();
  evidence.lastBytesReceived = sample.bytesReceived;
  evidence.lastPacketsReceived = sample.packetsReceived;
  if (evidence.kind === "video") {
    const framesReceivedProgressed =
      sample.framesReceived !== undefined &&
      sample.framesReceived > evidence.lastFramesReceived;
    const framesDecodedProgressed =
      sample.framesDecoded !== undefined &&
      sample.framesDecoded > evidence.lastFramesDecoded;
    const framesRenderedProgressed =
      sample.framesRendered !== undefined &&
      sample.framesRendered > evidence.lastFramesRendered;
    const presentationProgressed =
      framesRenderedProgressed ||
      evidence.presentationProgressCount >
        evidence.observedPresentationProgressCount;
    if (framesReceivedProgressed) evidence.lastFrameReceivedProgressAt = now;
    if (framesDecodedProgressed) evidence.lastDecodeProgressAt = now;
    if (framesRenderedProgressed) evidence.lastStatsRenderProgressAt = now;
    if (
      sample.framesRendered !== undefined &&
      state.presentationObservationMode === "unavailable"
    )
      state.presentationObservationMode = "stats";
    if (sample.framesReceived !== undefined) {
      if (framesReceivedProgressed && !framesDecodedProgressed)
        evidence.decoderStallSamples += 1;
      else if (framesDecodedProgressed || !framesReceivedProgressed)
        evidence.decoderStallSamples = 0;
    }
    if (framesDecodedProgressed && !presentationProgressed)
      evidence.renderStallSamples += 1;
    else if (presentationProgressed || !framesDecodedProgressed)
      evidence.renderStallSamples = 0;
    evidence.observedPresentationProgressCount =
      evidence.presentationProgressCount;
    evidence.lastFramesReceived =
      sample.framesReceived ?? evidence.lastFramesReceived;
    evidence.lastFramesDecoded =
      sample.framesDecoded ?? evidence.lastFramesDecoded;
    evidence.lastFramesRendered =
      sample.framesRendered ?? evidence.lastFramesRendered;
    evidence.lastPacketReceivedTimestamp =
      sample.lastPacketReceivedTimestamp ??
      evidence.lastPacketReceivedTimestamp;
  } else {
    evidence.lastTotalAudioEnergy =
      sample.totalAudioEnergy ?? evidence.lastTotalAudioEnergy;
    evidence.lastTotalSamplesReceived =
      sample.totalSamplesReceived ?? evidence.lastTotalSamplesReceived;
    evidence.lastJitterBufferEmittedCount =
      sample.jitterBufferEmittedCount ?? evidence.lastJitterBufferEmittedCount;
  }
  if (
    progression &&
    evidence.samples.length >= 2 &&
    !evidence.rtpFlowingConfirmed
  ) {
    evidence.rtpFlowingConfirmed = true;
    evidence.rtpFlowingConfirmedAt = now;
  }
}

export function checkRtpProgression(
  state: RemoteSourceConvergenceState,
  sample: RemoteReceiverStats,
  now = Date.now(),
): boolean {
  if (state.rtpEvidence.kind !== "video") return false;
  const evidence = state.rtpEvidence;
  const progression =
    evidence.samples.length > 0 && videoNetworkProgressed(evidence, sample);
  recordRtpSample(state, sample, now, progression);
  return progression;
}

export function checkAudioRtpProgression(
  state: RemoteSourceConvergenceState,
  sample: RemoteReceiverStats,
  now = Date.now(),
): boolean {
  if (state.rtpEvidence.kind !== "audio") return false;
  const evidence = state.rtpEvidence;
  const progression =
    evidence.samples.length > 0 && audioProgressed(evidence, sample);
  recordRtpSample(state, sample, now, progression);
  return progression;
}

export function hasRtpFlowingEvidence(
  state: RemoteSourceConvergenceState,
): boolean {
  return state.rtpEvidence.rtpFlowingConfirmed;
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
    state.kind === "video" &&
    hasRtpFlowingEvidence(state) &&
    hasFirstFrameEvidence(state) &&
    !state.retired &&
    !state.failed
  );
}

export function canBecomeAudioRenderable(
  state: RemoteSourceConvergenceState,
): boolean {
  return (
    state.kind === "audio" &&
    hasRtpFlowingEvidence(state) &&
    state.outputBindingReady &&
    !state.retired &&
    !state.failed
  );
}

export function promoteConvergence(
  state: RemoteSourceConvergenceState,
  now = Date.now(),
): boolean {
  if (state.retired || state.failed) return false;
  let changed = false;
  if (
    hasRtpFlowingEvidence(state) &&
    ["transport-connected", "recovering"].includes(state.phase)
  )
    changed = advancePhase(state, "rtp-flowing", now) || changed;
  if (state.kind === "audio" && canBecomeAudioRenderable(state))
    changed = advancePhase(state, "renderable", now) || changed;
  if (state.kind === "video" && canBecomeRenderable(state)) {
    if (state.phase === "rtp-flowing")
      changed = advancePhase(state, "first-frame", now) || changed;
    if (state.phase === "first-frame")
      changed = advancePhase(state, "renderable", now) || changed;
  }
  return changed;
}

export function recordFirstFrameEvidence(
  state: RemoteSourceConvergenceState,
  at = Date.now(),
  options: {
    element?: HTMLVideoElement | null;
    stream?: MediaStream | null;
    track?: MediaStreamTrack | null;
    fallback?: boolean;
  } = {},
): boolean {
  if (
    state.kind !== "video" ||
    state.retired ||
    state.failed ||
    state.firstFrameEvidence.received
  )
    return false;
  if (
    options.fallback &&
    (!hasRtpFlowingEvidence(state) ||
      state.rtpEvidence.kind !== "video" ||
      state.rtpEvidence.lastFramesDecoded <= 0)
  )
    return false;
  state.firstFrameEvidence.received = true;
  state.firstFrameEvidence.receivedAt = at;
  state.firstFrameEvidence.element = options.element ?? null;
  state.firstFrameEvidence.stream = options.stream ?? null;
  state.firstFrameEvidence.track = options.track ?? null;
  promoteConvergence(state, at);
  return true;
}

export function recordPresentationProgress(
  state: RemoteSourceConvergenceState,
  at = Date.now(),
  mode: Exclude<RemotePresentationObservationMode, "unavailable"> = "native",
): boolean {
  if (state.kind !== "video" || state.retired || state.failed) return false;
  const evidence = state.rtpEvidence;
  if (evidence.kind !== "video") return false;
  state.presentationObservationMode = mode;
  evidence.lastPresentationProgressAt = at;
  evidence.presentationProgressCount += 1;
  return true;
}

export function scheduleFirstFrameCallback(
  state: RemoteSourceConvergenceState,
  element: HTMLVideoElement,
  stream: MediaStream,
  track: MediaStreamTrack,
  onFirstFrame: () => void,
): void {
  cancelFirstFrameCallback(state);
  state.firstFrameEvidence.element = element;
  state.firstFrameEvidence.stream = stream;
  state.firstFrameEvidence.track = track;
  if (typeof element.requestVideoFrameCallback !== "function") return;
  const handle = element.requestVideoFrameCallback(() => {
    if (
      state.firstFrameEvidence.callbackHandle !== handle ||
      state.retired ||
      state.abortController.signal.aborted ||
      state.firstFrameEvidence.element !== element ||
      state.firstFrameEvidence.stream !== stream ||
      state.firstFrameEvidence.track !== track
    )
      return;
    state.firstFrameEvidence.callbackHandle = null;
    if (
      recordFirstFrameEvidence(state, Date.now(), {
        element,
        stream,
        track,
      })
    )
      onFirstFrame();
  });
  state.firstFrameEvidence.callbackHandle = handle;
}

export function cancelFirstFrameCallback(
  state: RemoteSourceConvergenceState,
): void {
  const handle = state.firstFrameEvidence.callbackHandle;
  const element = state.firstFrameEvidence.element;
  if (handle !== null && element) element.cancelVideoFrameCallback?.(handle);
  state.firstFrameEvidence.callbackHandle = null;
  state.firstFrameEvidence.element = null;
  state.firstFrameEvidence.stream = null;
  state.firstFrameEvidence.track = null;
}

export function retireIncarnation(state: RemoteSourceConvergenceState): void {
  if (state.phase !== "retired") {
    state.previousPhase = state.phase;
    state.phase = "retired";
    state.phaseEnteredAt = Date.now();
  }
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

function markStalled(
  state: RemoteSourceConvergenceState,
  now: number,
  cause: RemoteSourceStallCause,
): boolean {
  if (state.stallState.detected) return false;
  state.stallState.detected = true;
  state.stallState.detectedAt = now;
  state.stallState.cause = cause;
  if (state.phase !== "stalled") advancePhase(state, "stalled", now);
  return true;
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
    [
      "not-announced",
      "announced",
      "publication-discovered",
      "subscription-requested",
      "consumer-created",
    ].includes(state.phase)
  )
    return false;
  const evidence = state.rtpEvidence;
  const progressTimes = [
    evidence.lastNetworkProgressAt,
    evidence.lastRtpProgressAt,
  ].filter((value): value is number => value !== null);
  const lastProgressAt = progressTimes.length
    ? Math.min(...progressTimes)
    : null;
  if (!hasRtpFlowingEvidence(state))
    return now - state.phaseEnteredAt >= config.rtpStallThresholdMs
      ? markStalled(state, now, "no-rtp")
      : false;
  if (
    state.kind === "video" &&
    !state.firstFrameEvidence.received &&
    state.rtpEvidence.rtpFlowingConfirmedAt !== null &&
    now - state.rtpEvidence.rtpFlowingConfirmedAt >= config.firstFrameTimeoutMs
  )
    return markStalled(state, now, "first-frame-timeout");
  if (
    state.kind === "video" &&
    evidence.kind === "video" &&
    evidence.lastFramesReceived > 0 &&
    state.phase === "renderable"
  ) {
    if (
      evidence.decoderStallSamples >= config.videoPipelineStallSamples &&
      lastProgressAt !== null &&
      now - lastProgressAt < config.rtpStallThresholdMs
    )
      return markStalled(state, now, "decoder-stall");
    if (
      state.presentationObservationMode !== "unavailable" &&
      evidence.renderStallSamples >= config.videoPipelineStallSamples &&
      lastProgressAt !== null &&
      now - lastProgressAt < config.rtpStallThresholdMs
    )
      return markStalled(state, now, "render-stall");
  }
  if (
    lastProgressAt === null ||
    now - lastProgressAt < config.rtpStallThresholdMs
  )
    return false;
  return markStalled(state, now, "no-rtp");
}

export function scheduleRecovery(
  state: RemoteSourceConvergenceState,
  config: RemoteSourceFSMConfig,
  onRecovery: () => void,
): boolean {
  if (
    state.intentionalReceivingDisabled ||
    state.retired ||
    state.failed ||
    state.stallState.recoveryTimer
  )
    return false;
  if (state.stallState.recoveryAttempt >= config.maxRecoveryAttempts) {
    state.failed = true;
    state.phase = "failed";
    return false;
  }
  state.stallState.recoveryAttempt += 1;
  state.phase = "recovering";
  state.phaseEnteredAt = Date.now();
  const delay = Math.min(
    1000 * 2 ** (state.stallState.recoveryAttempt - 1),
    10000,
  );
  state.stallState.recoveryTimer = setTimeout(() => {
    state.stallState.recoveryTimer = null;
    if (
      !state.retired &&
      !state.failed &&
      !state.intentionalReceivingDisabled &&
      !state.abortController.signal.aborted
    )
      onRecovery();
  }, delay);
  state.stallState.recoveryTimer.unref?.();
  return true;
}

export function clearStall(state: RemoteSourceConvergenceState): void {
  const cause = state.stallState.cause;
  if (state.rtpEvidence.kind === "video") {
    if (cause === "decoder-stall") state.rtpEvidence.decoderStallSamples = 0;
    if (cause === "render-stall") state.rtpEvidence.renderStallSamples = 0;
  }
  state.stallState.detected = false;
  state.stallState.detectedAt = null;
  state.stallState.cause = null;
  state.stallState.recoveryAttempt = 0;
  if (state.stallState.recoveryTimer) {
    clearTimeout(state.stallState.recoveryTimer);
    state.stallState.recoveryTimer = null;
  }
  if (state.phase === "recovering" || state.phase === "stalled") {
    state.phase = hasRtpFlowingEvidence(state)
      ? "rtp-flowing"
      : "transport-connected";
    state.phaseEnteredAt = Date.now();
    promoteConvergence(state);
  }
}
