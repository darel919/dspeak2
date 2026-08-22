import {
  isExternalBoolean,
  isExternalNumber,
  isExternalRecord,
  isExternalString,
} from "./types/boundary.ts";
import type { NormalizedWebRtcPathStats } from "./types/web-rtc-latency.ts";

export function reportStatValues<T>(report: T): Record<string, unknown>[] {
  if (isExternalRecord(report) && report.values instanceof Function) {
    try {
      /* SAFETY: The values() call returned the iterable this report owns. */
      return [...(report.values() as Iterable<unknown>)].filter(
        (value): value is Record<string, unknown> => isExternalRecord(value),
      );
    } catch {
      return [];
    }
  }
  if (report instanceof Map)
    return [...report.values()].filter(
      (value): value is Record<string, unknown> => isExternalRecord(value),
    );
  if (Array.isArray(report))
    return report.filter((value): value is Record<string, unknown> =>
      isExternalRecord(value),
    );
  if (isExternalRecord(report))
    return Object.values(report).filter(
      (value): value is Record<string, unknown> => isExternalRecord(value),
    );
  return [];
}

function finiteOrNull<T>(value: T): number | null {
  if (!isExternalNumber(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stringOrNull<T>(value: T): string | null {
  return isExternalString(value) && value.length > 0 ? value : null;
}

function booleanOrNull<T>(value: T): boolean | null {
  return isExternalBoolean(value) ? value : null;
}

function cumulativeAverageMs<T>(value: T, emittedCount: T) {
  if (!isExternalNumber(value) || !isExternalNumber(emittedCount)) return null;
  if (emittedCount <= 0) return null;
  return (value * 1000) / emittedCount;
}

function optionalRecord<T extends object, U = unknown>(value: U): T | null {
  if (!isExternalRecord(value)) return null;
  /* SAFETY: The cast only relabels the record already validated by isExternalRecord above. */
  return value as T;
}

type PathStatsCandidatePair = {
  currentRoundTripTime?: unknown;
};

type PathStatsInbound = {
  jitter?: unknown;
  jitterBufferDelay?: unknown;
  jitterBufferEmittedCount?: unknown;
  jitterBufferTargetDelay?: unknown;
  jitterBufferMinimumDelay?: unknown;
  packetsLost?: unknown;
  packetsReceived?: unknown;
  framesDecoded?: unknown;
  framesDropped?: unknown;
  framesRendered?: unknown;
  totalProcessingDelay?: unknown;
  encoderImplementation?: unknown;
  decoderImplementation?: unknown;
  powerEfficientEncoder?: unknown;
  powerEfficientDecoder?: unknown;
};

export type NormalizeWebRtcPathStatsInput = {
  timestamp: unknown;
  candidatePair: unknown;
  inboundAudio: unknown;
  inboundVideo: unknown;
};

export function normalizeWebRtcPathStats({
  timestamp,
  candidatePair,
  inboundAudio,
  inboundVideo,
}: NormalizeWebRtcPathStatsInput): NormalizedWebRtcPathStats {
  const pair = optionalRecord<PathStatsCandidatePair>(candidatePair);
  const audio = optionalRecord<PathStatsInbound>(inboundAudio);
  const video = optionalRecord<PathStatsInbound>(inboundVideo);
  const emitted =
    audio?.jitterBufferEmittedCount ?? video?.jitterBufferEmittedCount;
  const currentRoundTripTimeSeconds = finiteOrNull(pair?.currentRoundTripTime);
  const jitterSeconds =
    finiteOrNull(audio?.jitter) ?? finiteOrNull(video?.jitter);
  return {
    timestampMs: finiteOrNull(timestamp),
    rttMs:
      currentRoundTripTimeSeconds == null
        ? null
        : currentRoundTripTimeSeconds * 1000,
    jitterMs: jitterSeconds == null ? null : jitterSeconds * 1000,
    jitterBufferAverageDelayMs: cumulativeAverageMs(
      audio?.jitterBufferDelay ?? video?.jitterBufferDelay,
      emitted,
    ),
    jitterBufferAverageTargetDelayMs: cumulativeAverageMs(
      audio?.jitterBufferTargetDelay ?? video?.jitterBufferTargetDelay,
      emitted,
    ),
    jitterBufferAverageMinimumDelayMs: cumulativeAverageMs(
      audio?.jitterBufferMinimumDelay ?? video?.jitterBufferMinimumDelay,
      emitted,
    ),
    packetsLost:
      finiteOrNull(audio?.packetsLost) ?? finiteOrNull(video?.packetsLost),
    packetsReceived:
      finiteOrNull(audio?.packetsReceived) ??
      finiteOrNull(video?.packetsReceived),
    framesDecoded:
      finiteOrNull(video?.framesDecoded) ?? finiteOrNull(audio?.framesDecoded),
    framesDropped:
      finiteOrNull(video?.framesDropped) ?? finiteOrNull(audio?.framesDropped),
    framesRendered:
      finiteOrNull(video?.framesRendered) ??
      finiteOrNull(audio?.framesRendered),
    totalProcessingDelayMs:
      cumulativeAverageMs(video?.totalProcessingDelay, video?.framesDecoded) ??
      cumulativeAverageMs(audio?.totalProcessingDelay, audio?.framesDecoded),
    encoderImplementation:
      stringOrNull(video?.encoderImplementation) ??
      stringOrNull(audio?.encoderImplementation),
    decoderImplementation:
      stringOrNull(video?.decoderImplementation) ??
      stringOrNull(audio?.decoderImplementation),
    powerEfficientEncoder:
      booleanOrNull(video?.powerEfficientEncoder) ??
      booleanOrNull(audio?.powerEfficientEncoder),
    powerEfficientDecoder:
      booleanOrNull(video?.powerEfficientDecoder) ??
      booleanOrNull(audio?.powerEfficientDecoder),
  };
}
