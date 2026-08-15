import { updateAdaptiveVideoState } from "../../shared/adaptive-video-controller.ts";
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
import type { NativeMediaEngine } from "./nativeMediaEngine.ts";

const NATIVE_VIDEO_ADAPTATION_INTERVAL_MS = 2000;

function videoSettingsForAdaptation(
  settings: Record<string, unknown>,
  source: string,
): AdaptiveVideoSettings {
  const maxBitrate = Number(settings.maxBitrate);
  const isScreen = source === "screen";
  return {
    qualityPriority:
      settings.qualityPriority === "resolution" ? "resolution" : "framerate",
    frameRate: Number(settings.frameRate) || 30,
    resolution: String(settings.resolution || "original"),
    ...(Number.isFinite(maxBitrate) && maxBitrate > 0 ? { maxBitrate } : {}),
    minimumBitrate:
      settings.lowSpec === true ? (isScreen ? 300_000 : 200_000) : 500_000,
    minimumFrameRate: settings.lowSpec === true ? 15 : 25,
    frameRateFirst: true,
    adaptBitrate: true,
  };
}

function outboundVideoReportEntry(value: unknown, source: string) {
  if (!Array.isArray(value)) return null;
  const entry = value.find(
    (candidate) =>
      candidate &&
      typeof candidate === "object" &&
      String((candidate as Record<string, unknown>).source || "") === source &&
      String((candidate as Record<string, unknown>).kind || "") === "video",
  ) as Record<string, unknown> | undefined;
  return entry || null;
}

function inboundVideoReports(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((candidate) => {
    if (!candidate || typeof candidate !== "object") return false;
    const record = candidate as Record<string, unknown>;
    return (
      record.kind === "video" &&
      record.stats &&
      typeof record.stats === "object"
    );
  }) as Array<Record<string, unknown>>;
}

function finiteStat(value: unknown) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
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
  record: Record<string, unknown>,
) {
  const userId = record.userId ?? record.peerId;
  const source = typeof record.source === "string" ? record.source : "";
  if ((typeof userId !== "string" && typeof userId !== "number") || !source)
    return false;
  try {
    const result =
      engine.nativeProvider === "p2p"
        ? await engine.nativeP2pSession?.setRemoteReceiving(
            String(userId),
            source,
            false,
          )
        : await engine.nativeSession?.setRemoteReceiving(
            String(userId),
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
    const stats = record.stats as Record<string, unknown>;
    const consumerId = String(
      record.consumerId || record.logicalStreamId || "",
    );
    const logicalStreamId = String(record.logicalStreamId || consumerId);
    if (!consumerId || !logicalStreamId) continue;
    const totalDecodeTime = finiteStat(stats.totalDecodeTime);
    const framesDecoded = finiteStat(stats.framesDecoded);
    const framesDropped = finiteStat(stats.framesDropped);
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
      finiteStat(stats.framesPerSecond),
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
      codec: typeof record.codec === "string" ? record.codec : null,
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
    const emittedFrames = finiteStat(stats.jitterBufferEmittedCount);
    const jitterBufferDelay = finiteStat(stats.jitterBufferDelay);
    pushRuntimeTelemetry(runtimeTelemetryTarget(engine), {
      publisher:
        record.userId == null && record.peerId == null
          ? null
          : String(record.userId ?? record.peerId),
      receiver:
        engine.nativeP2pSession?.localPeerId ||
        engine.nativeSession?.localPeerId ||
        null,
      logicalStreamId,
      source: typeof record.source === "string" ? record.source : null,
      direction: "decode",
      codec: typeof record.codec === "string" ? record.codec : null,
      codecAcceleration:
        typeof record.codecAcceleration === "string"
          ? record.codecAcceleration
          : null,
      codecImplementation:
        typeof record.codecImplementation === "string"
          ? record.codecImplementation
          : null,
      generation: finiteStat(record.generation),
      variantId: typeof record.variantId === "string" ? record.variantId : null,
      variantCount: inboundReports.filter(
        (candidate) => candidate.logicalStreamId === logicalStreamId,
      ).length,
      width: finiteStat(record.width),
      height: finiteStat(record.height),
      fps: finiteStat(record.fps || stats.framesPerSecond),
      bitrate: finiteStat(record.bitrate || stats.bitrate),
      decodeTimeMs,
      framesDecoded,
      framesDropped,
      renderDelayMs: averageMilliseconds(jitterBufferDelay, emittedFrames),
      qualityLimitationReason:
        typeof stats.qualityLimitationReason === "string"
          ? stats.qualityLimitationReason
          : null,
      powerEfficientDecoder:
        typeof stats.powerEfficientDecoder === "boolean"
          ? stats.powerEfficientDecoder
          : null,
      cpuLimited: stats.qualityLimitationReason === "cpu",
      migrationState:
        typeof record.migrationState === "string"
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
    if (!report || typeof report !== "object") continue;
    const reportStats = report as AdaptiveVideoReport;
    const reportRecord = report as Record<string, unknown>;
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
    const settings = engine.getVideoSettings(source) as Record<string, unknown>;
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
      ...(Number.isFinite(Number(next.maxBitrate))
        ? { maxBitrate: Math.floor(Number(next.maxBitrate)) }
        : {}),
    };
    const result = await nativeSendSession.updateVideoParameters(
      source,
      parameters,
    );
    if (result !== false) engine.nativeVideoAdaptationStates.set(source, next);
  }
  const outboundReports = Array.isArray(reports)
    ? (reports.filter((candidate) => {
        if (!candidate || typeof candidate !== "object") return false;
        const record = candidate as Record<string, unknown>;
        return (
          record.kind === "video" &&
          record.stats &&
          typeof record.stats === "object"
        );
      }) as Array<Record<string, unknown>>)
    : [];
  for (const record of outboundReports) {
    const stats = record.stats as Record<string, unknown>;
    const logicalStreamId = String(
      record.logicalStreamId || `source:${String(record.source || "video")}`,
    );
    const framesEncoded = finiteStat(stats.framesEncoded);
    const totalEncodeTime = finiteStat(stats.totalEncodeTime);
    const qualityLimitationReason =
      typeof stats.qualityLimitationReason === "string"
        ? stats.qualityLimitationReason
        : null;
    pushRuntimeTelemetry(runtimeTelemetryTarget(engine), {
      publisher:
        engine.nativeP2pSession?.localPeerId ||
        engine.nativeSession?.localPeerId ||
        null,
      receiver: null,
      logicalStreamId,
      source: typeof record.source === "string" ? record.source : null,
      direction: "encode",
      codec: typeof record.codec === "string" ? record.codec : null,
      codecAcceleration:
        typeof record.codecAcceleration === "string"
          ? record.codecAcceleration
          : null,
      codecImplementation:
        typeof record.codecImplementation === "string"
          ? record.codecImplementation
          : null,
      generation: finiteStat(record.generation),
      variantId: typeof record.variantId === "string" ? record.variantId : null,
      variantCount: outboundReports.filter(
        (candidate) => candidate.logicalStreamId === logicalStreamId,
      ).length,
      width: finiteStat(record.width),
      height: finiteStat(record.height),
      fps: finiteStat(record.fps || stats.framesPerSecond),
      bitrate: finiteStat(record.bitrate || stats.bitrate),
      encodeTimeMs: averageMilliseconds(totalEncodeTime, framesEncoded),
      framesEncoded,
      framesDropped: finiteStat(stats.framesDropped),
      qualityLimitationReason,
      powerEfficientEncoder:
        typeof stats.powerEfficientEncoder === "boolean"
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
    let operation: Promise<unknown> = Promise.resolve();
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
