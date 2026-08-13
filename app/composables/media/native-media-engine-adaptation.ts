import { updateAdaptiveVideoState } from "../../shared/adaptive-video-controller.ts";
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

function outboundVideoReport(value: unknown, source: string) {
  if (!Array.isArray(value)) return null;
  const entry = value.find(
    (candidate) =>
      candidate &&
      typeof candidate === "object" &&
      String((candidate as Record<string, unknown>).source || "") === source &&
      String((candidate as Record<string, unknown>).kind || "") === "video",
  ) as Record<string, unknown> | undefined;
  const stats = entry?.stats;
  return stats && typeof stats === "object"
    ? (stats as AdaptiveVideoReport)
    : null;
}

async function sampleNativeVideoAdaptation(
  engine: NativeMediaEngine,
  operation: Promise<unknown>,
) {
  if (!engine.initialized || !engine.nativeSession) return;
  const sources = [...engine.nativeSession.sources.values()].filter(
    (entry) => entry.kind === "video",
  );
  if (sources.length === 0) return;
  const reports = await engine.getOutboundRtpStats();
  if (engine.nativeVideoAdaptationOperation !== operation) return;
  for (const entry of sources) {
    const source = String(entry.source || "");
    const report = outboundVideoReport(reports, source);
    if (!report) continue;
    const totalEncodeTime = Number(report.totalEncodeTime);
    const framesEncoded = Number(report.framesEncoded);
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
          (frameTimeMs * (Number(report.framesPerSecond) || 0)) / 10;
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
        framesPerSecond: Number(report.framesPerSecond),
        qualityLimitationReason: String(report.qualityLimitationReason || ""),
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
    const result =
      engine.nativeProvider === "p2p"
        ? await engine.nativeP2pSession?.updateVideoParameters(
            source,
            parameters,
          )
        : await engine.nativeSession.updateVideoParameters(source, parameters);
    if (result !== false) engine.nativeVideoAdaptationStates.set(source, next);
  }
}

function scheduleNativeVideoAdaptation(engine: NativeMediaEngine) {
  if (!engine.initialized || engine.nativeVideoAdaptationOperation) return;
  engine.nativeVideoAdaptationTimer = setTimeout(() => {
    engine.nativeVideoAdaptationTimer = null;
    let operation: Promise<unknown> = Promise.resolve();
    operation = sampleNativeVideoAdaptation(engine, operation)
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
}
