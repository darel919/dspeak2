export type CodecMigrationState =
  | "stable"
  | "preparing"
  | "publishing-candidate"
  | "warming-receivers"
  | "ready"
  | "committing"
  | "abort";

export interface PresentableVideoFrame {
  data?: string | null;
  width?: number;
  height?: number;
  timestamp?: number;
  eventId?: number | string;
}

export interface LogicalVideoStreamState {
  logicalStreamId: string;
  generation: number;
  currentVariantId?: string | null;
  candidateVariantId?: string | null;
  state: CodecMigrationState;
  currentConsumerId?: string | null;
  candidateConsumerId?: string | null;
}

export interface CodecMigrationTelemetry {
  logicalStreamId: string;
  state: CodecMigrationState;
  codec?: string;
  previousCodec?: string;
  generation?: number;
  startedAt: number;
  durationMs?: number;
  abortReason?: string;
  frameCount?: number;
}

export interface VideoDecodeOverloadTelemetry {
  logicalStreamId: string;
  consumerId: string;
  codec?: string | null;
  decodeUtilization?: number | null;
  droppedFrames?: number;
  overloaded: boolean;
  preferredLayers?: {
    spatialLayer?: number;
    temporalLayer?: number;
  };
  action?: "reduce-layers" | "recover-layers" | "video-unavailable" | "hold";
  sampledAt: number;
}

export type VideoCodecTelemetryDirection = "encode" | "decode";

export interface VideoCodecRuntimeTelemetry {
  publisher?: string | null;
  receiver?: string | null;
  logicalStreamId: string;
  source?: string | null;
  direction: VideoCodecTelemetryDirection;
  codec?: string | null;
  codecAcceleration?: string | null;
  codecImplementation?: string | null;
  generation?: number | null;
  variantId?: string | null;
  variantCount?: number | null;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  bitrate?: number | null;
  encodeTimeMs?: number | null;
  decodeTimeMs?: number | null;
  framesEncoded?: number | null;
  framesDecoded?: number | null;
  framesDropped?: number | null;
  renderDelayMs?: number | null;
  qualityLimitationReason?: string | null;
  powerEfficientEncoder?: boolean | null;
  powerEfficientDecoder?: boolean | null;
  cpuLimited?: boolean;
  migrationState?: string | null;
  sampledAt: number;
}

export function logicalVideoStreamId(
  userId: string | number | null | undefined,
  source: string,
) {
  return `user:${String(userId ?? "unknown")}/${String(source || "video")}`;
}

export function isPresentableVideoFrame(
  frame: PresentableVideoFrame | null | undefined,
) {
  return Boolean(
    frame &&
    typeof frame.data === "string" &&
    frame.data.length > 0 &&
    Number(frame.width) > 0 &&
    Number(frame.height) > 0,
  );
}

export function hasAdvancingTimestamp(
  previous: number | null | undefined,
  next: number | null | undefined,
) {
  const nextNumber = next == null ? Number.NaN : Number(next);
  const previousNumber = previous == null ? Number.NaN : Number(previous);
  if (!Number.isFinite(nextNumber)) return false;
  if (!Number.isFinite(previousNumber)) return true;
  return nextNumber > previousNumber;
}

export function candidateFrameCount(
  currentCount: number,
  previousTimestamp: number | null | undefined,
  frame: PresentableVideoFrame | null | undefined,
) {
  if (!isPresentableVideoFrame(frame)) return currentCount;
  if (!hasAdvancingTimestamp(previousTimestamp, frame?.timestamp)) return 0;
  return currentCount + 1;
}

export function candidateReady(
  frameCount: number,
  previousTimestamp: number | null | undefined,
  frame: PresentableVideoFrame | null | undefined,
  requiredFrames = 3,
) {
  return (
    candidateFrameCount(frameCount, previousTimestamp, frame) >= requiredFrames
  );
}

export function createCodecMigrationTelemetry(
  logicalStreamId: string,
  state: CodecMigrationState,
  values: Partial<CodecMigrationTelemetry> = {},
): CodecMigrationTelemetry {
  return {
    logicalStreamId,
    state,
    startedAt: Date.now(),
    ...values,
  };
}

export interface MakeBeforeBreakCallbacks<TCandidate> {
  prepare: () => Promise<unknown>;
  publishCandidate: () => Promise<TCandidate>;
  warmCandidate: (candidate: TCandidate) => Promise<unknown>;
  candidateReady: (candidate: TCandidate) => Promise<boolean>;
  commit: (candidate: TCandidate) => Promise<unknown>;
  abort?: (candidate: TCandidate | null, reason: string) => Promise<unknown>;
  timeoutMs?: number;
}

export async function runMakeBeforeBreakMigration<TCandidate>(
  callbacks: MakeBeforeBreakCallbacks<TCandidate>,
) {
  let state: CodecMigrationState = "stable";
  let candidate: TCandidate | null = null;
  const timeoutMs = Math.max(1000, Number(callbacks.timeoutMs) || 5000);
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutTimer = setTimeout(
      () =>
        reject(
          Object.assign(new Error("codec candidate warm-up timed out"), {
            code: "CODEC_MIGRATION_TIMEOUT",
          }),
        ),
      timeoutMs,
    );
    timeoutTimer.unref?.();
  });
  try {
    state = "preparing";
    await Promise.race([callbacks.prepare(), timeout]);
    state = "publishing-candidate";
    candidate = await Promise.race([callbacks.publishCandidate(), timeout]);
    state = "warming-receivers";
    await Promise.race([callbacks.warmCandidate(candidate), timeout]);
    if (!(await Promise.race([callbacks.candidateReady(candidate), timeout])))
      throw Object.assign(
        new Error("codec candidate did not become presentable"),
        {
          code: "CODEC_MIGRATION_NOT_READY",
        },
      );
    state = "ready";
    state = "committing";
    await Promise.race([callbacks.commit(candidate), timeout]);
    state = "stable";
    return { state, candidate };
  } catch (error) {
    state = "abort";
    const reason = error instanceof Error ? error.message : String(error);
    try {
      await callbacks.abort?.(candidate, reason);
    } catch {}
    return { state, candidate, error, reason };
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer);
  }
}
