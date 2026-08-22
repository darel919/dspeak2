import { updateAdaptiveVideoState } from "../../shared/adaptive-video-controller.ts";
import {
  isExternalRecord,
  isExternalString,
} from "../../shared/types/boundary.ts";
import {
  decodeAdaptationAction,
  decodeAdaptationDecision,
} from "../../shared/video-codec-overload.ts";
import type {
  DecodeAdaptationCounters,
  DecodeAdaptationState,
} from "../../shared/video-codec-overload.ts";
import type {
  VideoCodecRuntimeTelemetry,
  VideoDecodeOverloadTelemetry,
} from "../../shared/video-codec-migration.ts";
import type {
  AdaptiveVideoReport,
  AdaptiveVideoSettings,
} from "../../shared/types/adaptive-media.ts";
import type {
  ExternalObject,
  MediaCommandResult,
} from "../../shared/types/boundary.ts";
import { isExternalNumber } from "../../shared/types/boundary.ts";
import type { ExternalField } from "~~/shared/types/external.ts";
import type { VideoSettings } from "../../shared/types/video-settings.ts";
import type { NativeMediaEngine } from "./nativeMediaEngine.ts";
import {
  parseExternalNumber,
  parseExternalRecord,
  parseExternalValue,
  type ExternalValue,
} from "../../utils/external-values.ts";

const NATIVE_VIDEO_ADAPTATION_INTERVAL_MS = 2000;

type ParsedVideoReport = {
  readonly stats: ExternalObject;
  readonly consumerId: ExternalField;
  readonly logicalStreamId: ExternalField;
  readonly codec: ExternalField;
  readonly userId: ExternalField;
  readonly peerId: ExternalField;
  readonly source: ExternalField;
  readonly codecAcceleration: ExternalField;
  readonly codecImplementation: ExternalField;
  readonly generation: ExternalField;
  readonly variantId: ExternalField;
  readonly width: ExternalField;
  readonly height: ExternalField;
  readonly fps: ExternalField;
  readonly bitrate: ExternalField;
  readonly migrationState: ExternalField;
};

export type NativeMediaUserId = {
  readonly value: string;
};

export function parseNativeMediaUserId(
  value: ExternalField,
): NativeMediaUserId | null {
  if (isExternalString(value) && value.trim()) return { value };
  if (isExternalNumber(value)) return { value: String(value) };
  return null;
}

function videoSettingsForAdaptation(
  settings: VideoSettings,
  source: string,
): AdaptiveVideoSettings {
  const maxBitrate = Number(settings.maxBitrate);
  const isScreen = source === "screen";
  const adaptation: AdaptiveVideoSettings = {
    qualityPriority:
      settings.qualityPriority === "resolution" ? "resolution" : "framerate",
    frameRate: Number(settings.frameRate) || 30,
    resolution: String(settings.resolution || "original"),
    minimumBitrate:
      settings.lowSpec === true ? (isScreen ? 300_000 : 200_000) : 500_000,
    minimumFrameRate: settings.lowSpec === true ? 15 : 25,
    adaptBitrate: true,
  };
  if (Number.isFinite(maxBitrate) && maxBitrate > 0)
    adaptation.maxBitrate = maxBitrate;
  return adaptation;
}

function outboundVideoReportEntry(
  value: MediaCommandResult,
  source: string,
): ParsedVideoReport | null {
  return (
    outboundVideoReports(value).find(
      (record) => isExternalString(record.source) && record.source === source,
    ) ?? null
  );
}

function parseVideoReport(value: ExternalField): ParsedVideoReport | null {
  const record = parseExternalRecord(value);
  if (!record || record.kind !== "video") return null;
  const stats = parseExternalRecord(record.stats);
  if (!stats) return null;
  return {
    stats,
    consumerId: record.consumerId,
    logicalStreamId: record.logicalStreamId,
    codec: record.codec,
    userId: record.userId,
    peerId: record.peerId,
    source: record.source,
    codecAcceleration: record.codecAcceleration,
    codecImplementation: record.codecImplementation,
    generation: record.generation,
    variantId: record.variantId,
    width: record.width,
    height: record.height,
    fps: record.fps,
    bitrate: record.bitrate,
    migrationState: record.migrationState,
  };
}

function videoReports(value: MediaCommandResult): ParsedVideoReport[] {
  if (!Array.isArray(value)) return [];
  const candidates: ExternalField[] = value;
  return candidates.flatMap((candidate) => {
    const report = parseVideoReport(candidate);
    return report ? [report] : [];
  });
}

function inboundVideoReports(value: MediaCommandResult): ParsedVideoReport[] {
  return videoReports(value);
}

function outboundVideoReports(value: MediaCommandResult): ParsedVideoReport[] {
  return videoReports(value);
}

function finiteStat(value: ExternalValue) {
  return parseExternalNumber(value);
}

function averageMilliseconds(total: number | null, count: number | null) {
  if (total == null || count == null || count <= 0) return null;
  return (total * 1000) / count;
}

function runtimeTelemetryTarget(engine: NativeMediaEngine) {
  if (engine.nativeProvider === "p2p")
    return engine.nativeP2pSession?.codecRuntimeTelemetry || null;
  return (
    engine.nativeSession?.cloudflareSession?.codecRuntimeTelemetry ||
    engine.nativeSession?.codecRuntimeTelemetry ||
    null
  );
}

function pushRuntimeTelemetry(
  target: VideoCodecRuntimeTelemetry[] | null,
  sample: VideoCodecRuntimeTelemetry,
) {
  if (!target) return;
  target.push(sample);
  if (target.length > 128) target.splice(0, target.length - 128);
}

async function disableOverloadedVideoReceiver(
  engine: NativeMediaEngine,
  record: ParsedVideoReport,
) {
  const rawUserId = record.userId !== undefined ? record.userId : record.peerId;
  const userId = parseNativeMediaUserId(rawUserId);
  const source = isExternalString(record.source) ? record.source : "";
  if (!userId || !source) return false;
  try {
    const result =
      engine.nativeProvider === "p2p"
        ? await engine.nativeP2pSession?.setRemoteReceiving(
            userId.value,
            source,
            false,
          )
        : await engine.nativeSession?.setRemoteReceiving(
            userId.value,
            source,
            false,
          );
    return result !== false;
  } catch {
    return false;
  }
}

async function sampleNativeVideoDecodeAdaptation(engine: NativeMediaEngine) {
  const nativeReceiveSession =
    engine.nativeProvider === "p2p"
      ? engine.nativeP2pSession
      : engine.nativeSession;
  if (!engine.initialized || !nativeReceiveSession) return;
  const reports = await engine.getInboundRtpStats();
  for (const record of inboundVideoReports(reports)) {
    const stats = record.stats;
    const consumerId = String(
      record.consumerId || record.logicalStreamId || "",
    );
    const logicalStreamId = String(record.logicalStreamId || consumerId);
    if (!consumerId || !logicalStreamId) continue;
    const totalDecodeTime = finiteStat(
      parseExternalValue(stats.totalDecodeTime),
    );
    const framesDecoded = finiteStat(parseExternalValue(stats.framesDecoded));
    const framesDropped = finiteStat(parseExternalValue(stats.framesDropped));
    if (
      totalDecodeTime == null ||
      framesDecoded == null ||
      framesDropped == null
    )
      continue;
    const counters: DecodeAdaptationCounters = {
      totalDecodeTime,
      framesDecoded,
      framesDropped,
    };
    const previousCounters =
      engine.nativeVideoDecodeAdaptationCounters.get(consumerId) || null;
    const previousState: DecodeAdaptationState =
      engine.nativeVideoDecodeAdaptationStates.get(logicalStreamId) || {
        spatialLayer: 2,
        temporalLayer: 2,
        pressureSamples: 0,
        healthySamples: 0,
      };
    const decision = decodeAdaptationDecision(
      previousCounters,
      counters,
      previousState,
      finiteStat(parseExternalValue(stats.framesPerSecond)),
    );
    const action = decodeAdaptationAction(decision);
    engine.nativeVideoDecodeAdaptationCounters.set(consumerId, counters);
    engine.nativeVideoDecodeAdaptationStates.set(
      logicalStreamId,
      decision.state,
    );
    const telemetry: VideoDecodeOverloadTelemetry = {
      logicalStreamId,
      consumerId,
      codec: isExternalString(record.codec) ? record.codec : null,
      decodeUtilization: decision.decodeUtilization,
      droppedFrames: decision.droppedFrames,
      overloaded: decision.overloaded,
      preferredLayers: decision.state,
      action,
      sampledAt: Date.now(),
    };
    const session = engine.nativeSession;
    const telemetryTarget =
      engine.nativeProvider === "p2p"
        ? engine.nativeP2pSession?.videoDecodeOverloadTelemetry
        : session?.videoDecodeOverloadTelemetry;
    if (telemetryTarget) {
      telemetryTarget.push(telemetry);
      if (telemetryTarget.length > 64)
        telemetryTarget.splice(0, telemetryTarget.length - 64);
    }
    const inboundReports = inboundVideoReports(reports);
    const decodeTimeMs = averageMilliseconds(totalDecodeTime, framesDecoded);
    const emittedFrames = finiteStat(
      parseExternalValue(stats.jitterBufferEmittedCount),
    );
    const jitterBufferDelay = finiteStat(
      parseExternalValue(stats.jitterBufferDelay),
    );
    pushRuntimeTelemetry(runtimeTelemetryTarget(engine), {
      publisher:
        record.userId == null && record.peerId == null
          ? null
          : (parseNativeMediaUserId(
              record.userId !== undefined ? record.userId : record.peerId,
            )?.value ?? null),
      receiver:
        engine.nativeP2pSession?.localPeerId ||
        engine.nativeSession?.localPeerId ||
        null,
      logicalStreamId,
      source: isExternalString(record.source) ? record.source : null,
      direction: "decode",
      codec: isExternalString(record.codec) ? record.codec : null,
      codecAcceleration: isExternalString(record.codecAcceleration)
        ? record.codecAcceleration
        : null,
      codecImplementation: isExternalString(record.codecImplementation)
        ? record.codecImplementation
        : null,
      generation: finiteStat(parseExternalValue(record.generation)),
      variantId: isExternalString(record.variantId) ? record.variantId : null,
      variantCount: inboundReports.filter(
        (candidate) => candidate.logicalStreamId === logicalStreamId,
      ).length,
      width: finiteStat(parseExternalValue(record.width)),
      height: finiteStat(parseExternalValue(record.height)),
      fps: finiteStat(parseExternalValue(record.fps ?? stats.framesPerSecond)),
      bitrate: finiteStat(parseExternalValue(record.bitrate ?? stats.bitrate)),
      decodeTimeMs,
      framesDecoded,
      framesDropped,
      renderDelayMs: averageMilliseconds(jitterBufferDelay, emittedFrames),
      qualityLimitationReason: isExternalString(stats.qualityLimitationReason)
        ? stats.qualityLimitationReason
        : null,
      powerEfficientDecoder:
        stats.powerEfficientDecoder === true ||
        stats.powerEfficientDecoder === false
          ? stats.powerEfficientDecoder
          : null,
      cpuLimited: stats.qualityLimitationReason === "cpu",
      migrationState: isExternalString(record.migrationState)
        ? record.migrationState
        : null,
      sampledAt: Date.now(),
    });
    if (action === "video-unavailable") {
      await disableOverloadedVideoReceiver(engine, record);
      continue;
    }
    if (!decision.changed) continue;
    const result =
      engine.nativeProvider === "p2p"
        ? await engine.nativeP2pSession?.adaptVideoReceiver(
            logicalStreamId,
            decision.state,
          )
        : await session?.adaptVideoReceiver(logicalStreamId, decision.state);
    if (result === false)
      engine.nativeVideoDecodeAdaptationStates.set(logicalStreamId, {
        ...previousState,
        pressureSamples: decision.state.pressureSamples,
        healthySamples: decision.state.healthySamples,
      });
  }
}

async function sampleNativeVideoAdaptation(engine: NativeMediaEngine) {
  const nativeSendSession =
    engine.nativeProvider === "p2p"
      ? engine.nativeP2pSession
      : engine.nativeSession;
  if (!engine.initialized || !nativeSendSession) return;
  const sources = [...nativeSendSession.sources.values()].filter(
    (entry) => entry.kind === "video",
  );
  if (sources.length === 0) {
    await sampleNativeVideoDecodeAdaptation(engine);
    return;
  }
  const reports = await engine.getOutboundRtpStats();
  for (const entry of sources) {
    const source = String(entry.source || "");
    const reportEntry = outboundVideoReportEntry(reports, source);
    const report = reportEntry?.stats;
    if (!isExternalRecord(report)) continue;
    const reportStats: AdaptiveVideoReport = {
      totalEncodeTime: finiteStat(parseExternalValue(report.totalEncodeTime)),
      framesEncoded: finiteStat(parseExternalValue(report.framesEncoded)),
      framesPerSecond: finiteStat(parseExternalValue(report.framesPerSecond)),
      qualityLimitationReason: isExternalString(report.qualityLimitationReason)
        ? report.qualityLimitationReason
        : undefined,
    };
    const totalEncodeTime = Number(reportStats.totalEncodeTime);
    const framesEncoded = Number(reportStats.framesEncoded);
    const previousCounters = engine.nativeVideoAdaptationCounters.get(source);
    let encodeUtilization: number | null = null;
    if (
      previousCounters &&
      Number.isFinite(totalEncodeTime) &&
      Number.isFinite(framesEncoded)
    ) {
      const encodeDelta = totalEncodeTime - previousCounters.totalEncodeTime;
      const frameDelta = framesEncoded - previousCounters.framesEncoded;
      if (encodeDelta >= 0 && frameDelta > 0) {
        const frameTimeMs = (encodeDelta * 1000) / frameDelta;
        encodeUtilization =
          (frameTimeMs * (Number(reportStats.framesPerSecond) || 0)) / 10;
      }
    }
    if (Number.isFinite(totalEncodeTime) && Number.isFinite(framesEncoded))
      engine.nativeVideoAdaptationCounters.set(source, {
        totalEncodeTime,
        framesEncoded,
      });
    const settings = engine.getVideoSettings(source);
    const previous = engine.nativeVideoAdaptationStates.get(source) || {
      scale: Math.max(1, Number(settings.scaleResolutionDownBy) || 1),
      frameRate: Number(settings.frameRate) || 30,
      pressureSamples: 0,
      healthySamples: 0,
    };
    const next = updateAdaptiveVideoState(
      previous,
      {
        encodeUtilization,
        framesPerSecond: Number(reportStats.framesPerSecond),
        qualityLimitationReason: String(
          reportStats.qualityLimitationReason || "",
        ),
      },
      videoSettingsForAdaptation(settings, source),
    );
    if (!next.changed) {
      engine.nativeVideoAdaptationStates.set(source, next);
      continue;
    }
    const parameters = {
      maxFramerate: next.frameRate,
      scaleResolutionDownBy: next.scale,
    };
    const nextMaxBitrate = "maxBitrate" in next ? next.maxBitrate : null;
    if (Number.isFinite(Number(nextMaxBitrate)))
      Object.assign(parameters, {
        maxBitrate: Math.floor(Number(nextMaxBitrate)),
      });
    const result = await nativeSendSession.updateVideoParameters(
      source,
      parameters,
    );
    if (result !== false) engine.nativeVideoAdaptationStates.set(source, next);
  }
  const outboundReports = outboundVideoReports(reports);
  for (const record of outboundReports) {
    const stats = record.stats;
    const logicalStreamId = String(
      record.logicalStreamId || `source:${String(record.source || "video")}`,
    );
    const framesEncoded = finiteStat(parseExternalValue(stats.framesEncoded));
    const totalEncodeTime = finiteStat(
      parseExternalValue(stats.totalEncodeTime),
    );
    const qualityLimitationReason = isExternalString(
      stats.qualityLimitationReason,
    )
      ? stats.qualityLimitationReason
      : null;
    pushRuntimeTelemetry(runtimeTelemetryTarget(engine), {
      publisher:
        engine.nativeP2pSession?.localPeerId ||
        engine.nativeSession?.localPeerId ||
        null,
      receiver: null,
      logicalStreamId,
      source: isExternalString(record.source) ? record.source : null,
      direction: "encode",
      codec: isExternalString(record.codec) ? record.codec : null,
      codecAcceleration: isExternalString(record.codecAcceleration)
        ? record.codecAcceleration
        : null,
      codecImplementation: isExternalString(record.codecImplementation)
        ? record.codecImplementation
        : null,
      generation: finiteStat(parseExternalValue(record.generation)),
      variantId: isExternalString(record.variantId) ? record.variantId : null,
      variantCount: outboundReports.filter(
        (candidate) => candidate.logicalStreamId === logicalStreamId,
      ).length,
      width: finiteStat(parseExternalValue(record.width)),
      height: finiteStat(parseExternalValue(record.height)),
      fps: finiteStat(parseExternalValue(record.fps ?? stats.framesPerSecond)),
      bitrate: finiteStat(parseExternalValue(record.bitrate ?? stats.bitrate)),
      encodeTimeMs: averageMilliseconds(totalEncodeTime, framesEncoded),
      framesEncoded,
      framesDropped: finiteStat(parseExternalValue(stats.framesDropped)),
      qualityLimitationReason,
      powerEfficientEncoder:
        stats.powerEfficientEncoder === true ||
        stats.powerEfficientEncoder === false
          ? stats.powerEfficientEncoder
          : null,
      cpuLimited: qualityLimitationReason === "cpu",
      migrationState: null,
      sampledAt: Date.now(),
    });
  }
  await sampleNativeVideoDecodeAdaptation(engine);
}

function scheduleNativeVideoAdaptation(engine: NativeMediaEngine) {
  if (!engine.initialized || engine.nativeVideoAdaptationOperation) return;
  engine.nativeVideoAdaptationTimer = setTimeout(() => {
    engine.nativeVideoAdaptationTimer = null;
    let operation: Promise<MediaCommandResult> = Promise.resolve();
    operation = sampleNativeVideoAdaptation(engine)
      .catch(() => {})
      .finally(() => {
        if (engine.nativeVideoAdaptationOperation !== operation) return;
        engine.nativeVideoAdaptationOperation = null;
        scheduleNativeVideoAdaptation(engine);
      });
    engine.nativeVideoAdaptationOperation = operation;
  }, NATIVE_VIDEO_ADAPTATION_INTERVAL_MS);
  engine.nativeVideoAdaptationTimer?.unref?.();
}

export function startNativeVideoAdaptation(engine: NativeMediaEngine) {
  stopNativeVideoAdaptation(engine);
  scheduleNativeVideoAdaptation(engine);
}

export function stopNativeVideoAdaptation(engine: NativeMediaEngine) {
  if (engine.nativeVideoAdaptationTimer)
    clearTimeout(engine.nativeVideoAdaptationTimer);
  engine.nativeVideoAdaptationTimer = null;
  engine.nativeVideoAdaptationOperation = null;
  engine.nativeVideoAdaptationStates.clear();
  engine.nativeVideoAdaptationCounters.clear();
  engine.nativeVideoDecodeAdaptationStates.clear();
  engine.nativeVideoDecodeAdaptationCounters.clear();
}
