import {
  calculateFrameTimeMs,
  VIDEO_FRAME_RATE_MIN,
  VIDEO_RESOLUTIONS,
  VIDEO_SCALE_STEPS,
  isVideoResolution,
} from "./video-settings.ts";
import type {
  AdaptiveFrameCounters,
  AdaptiveTrackConstraints,
  AdaptiveVideoEntry,
  AdaptiveVideoReport,
  AdaptiveVideoSample,
  AdaptiveVideoSettings,
  AdaptiveVideoState,
} from "./types/adaptive-media.ts";
import type { OwnedErrorValue } from "./types/shared-utilities.ts";
import {
  isExternalBoolean,
  isExternalNumber,
  isExternalRecord,
  isExternalString,
} from "./types/boundary.ts";

const ADAPTIVE_FRAME_RATES = Object.freeze([15, 25, 30, 50, 60]);

export function updateAdaptiveVideoState(
  state: AdaptiveVideoState | null,
  sample: AdaptiveVideoSample,
  settings: AdaptiveVideoSettings,
) {
  const priority = settings.qualityPriority;
  const targetFrameRate = Number(settings.frameRate) || 30;
  const minimumFrameRate = Math.max(
    1,
    Number(settings.minimumFrameRate) || VIDEO_FRAME_RATE_MIN,
  );
  const frameRateFirst = settings.frameRateFirst === true;
  const currentScale = state?.scale;
  const scale =
    currentScale !== undefined && VIDEO_SCALE_STEPS.includes(currentScale)
      ? currentScale
      : 1;
  const frameRate = Math.min(
    targetFrameRate,
    Number(state?.frameRate) || targetFrameRate,
  );
  const targetBitrate = Number(settings.maxBitrate);
  const hasBitrateCeiling =
    settings.adaptBitrate === true &&
    Number.isFinite(targetBitrate) &&
    targetBitrate > 0;
  const bitrate = hasBitrateCeiling
    ? Math.min(targetBitrate, Number(state?.maxBitrate) || targetBitrate)
    : null;
  const minimumBitrate = hasBitrateCeiling
    ? Math.min(
        targetBitrate,
        Math.max(100_000, Number(settings.minimumBitrate) || 100_000),
      )
    : null;
  const pressured =
    sample?.qualityLimitationReason === "cpu" ||
    sample?.qualityLimitationReason === "bandwidth" ||
    Number(sample?.encodeUtilization) >= 55 ||
    (Number.isFinite(Number(sample?.framesPerSecond)) &&
      Number(sample.framesPerSecond) < frameRate * 0.8);
  const healthy =
    !pressured &&
    sample?.qualityLimitationReason !== "bandwidth" &&
    (!Number.isFinite(Number(sample?.encodeUtilization)) ||
      Number(sample.encodeUtilization) < 35) &&
    (!Number.isFinite(Number(sample?.framesPerSecond)) ||
      Number(sample.framesPerSecond) >= frameRate * 0.93);
  const pressureSamples = pressured ? (state?.pressureSamples || 0) + 1 : 0;
  const healthySamples = healthy ? (state?.healthySamples || 0) + 1 : 0;
  let nextScale = scale;
  let nextFrameRate = frameRate;
  let nextBitrate = bitrate;

  if (pressureSamples >= 3) {
    if (priority === "resolution" || frameRateFirst) {
      const lowerRates = ADAPTIVE_FRAME_RATES.filter(
        (candidate) => candidate < frameRate && candidate >= minimumFrameRate,
      );
      if (lowerRates.length > 0) nextFrameRate = lowerRates.at(-1) || frameRate;
      else if (frameRateFirst)
        nextScale =
          VIDEO_SCALE_STEPS[
            Math.min(
              VIDEO_SCALE_STEPS.length - 1,
              VIDEO_SCALE_STEPS.indexOf(scale) + 1,
            )
          ] ?? scale;
    } else {
      nextScale =
        VIDEO_SCALE_STEPS[
          Math.min(
            VIDEO_SCALE_STEPS.length - 1,
            VIDEO_SCALE_STEPS.indexOf(scale) + 1,
          )
        ] ?? scale;
    }
    if (
      hasBitrateCeiling &&
      nextScale === scale &&
      nextFrameRate === frameRate &&
      bitrate !== null &&
      minimumBitrate !== null
    )
      nextBitrate = Math.max(minimumBitrate, Math.floor(bitrate * 0.75));
  } else if (healthySamples >= 6) {
    if (priority === "resolution" || frameRateFirst) {
      const higherRates = ADAPTIVE_FRAME_RATES.filter(
        (candidate) => candidate > frameRate && candidate <= targetFrameRate,
      );
      if (higherRates.length > 0) nextFrameRate = higherRates[0] || frameRate;
      else if (frameRateFirst)
        nextScale =
          VIDEO_SCALE_STEPS[
            Math.max(0, VIDEO_SCALE_STEPS.indexOf(scale) - 1)
          ] ?? scale;
    } else {
      nextScale =
        VIDEO_SCALE_STEPS[Math.max(0, VIDEO_SCALE_STEPS.indexOf(scale) - 1)] ??
        scale;
    }
    if (
      hasBitrateCeiling &&
      nextScale === scale &&
      nextFrameRate === frameRate &&
      bitrate !== null
    )
      nextBitrate = Math.min(targetBitrate, Math.ceil(bitrate * 1.1));
  }

  const changed =
    nextScale !== scale ||
    nextFrameRate !== frameRate ||
    nextBitrate !== bitrate;
  const result = {
    scale: nextScale,
    frameRate: nextFrameRate,
    pressureSamples: changed ? 0 : pressureSamples,
    healthySamples: changed ? 0 : healthySamples,
    changed,
  };
  if (nextBitrate !== null) Object.assign(result, { maxBitrate: nextBitrate });
  return result;
}

export function createAdaptiveVideoController({
  apply,
  getReport,
  getSettings,
  intervalMs = 2000,
  onError,
}: {
  apply: (
    entry: Record<string, unknown>,
    state: AdaptiveVideoState,
    settings: AdaptiveVideoSettings,
  ) => Promise<void> | void;
  getReport: (
    source: string,
  ) => Promise<Map<string, Record<string, unknown>> | null>;
  getSettings: (source: string) => AdaptiveVideoSettings;
  intervalMs?: number;
  onError?: (error: OwnedErrorValue) => void;
}) {
  let active: AdaptiveVideoEntry | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let previous: AdaptiveFrameCounters | null = null;
  let state: AdaptiveVideoState | null = null;

  function stop() {
    if (timer) clearTimeout(timer);
    timer = null;
    active = null;
    previous = null;
    state = null;
  }

  function schedule() {
    timer = setTimeout(sample, intervalMs);
    timer?.unref?.();
  }

  async function sample() {
    timer = null;
    if (!active) return;
    try {
      const report = await getReport(active.source);
      const outbound = report
        ? [...report.values()]
            .flatMap((value) => {
              if (!isExternalRecord(value)) return [];
              const parsed: AdaptiveVideoReport = {
                type: isExternalString(value.type) ? value.type : undefined,
                isRemote: isExternalBoolean(value.isRemote)
                  ? value.isRemote
                  : undefined,
                kind: isExternalString(value.kind) ? value.kind : undefined,
                mediaType: isExternalString(value.mediaType)
                  ? value.mediaType
                  : undefined,
                totalEncodeTime: isExternalNumber(value.totalEncodeTime)
                  ? value.totalEncodeTime
                  : null,
                framesEncoded: isExternalNumber(value.framesEncoded)
                  ? value.framesEncoded
                  : null,
                framesPerSecond: isExternalNumber(value.framesPerSecond)
                  ? value.framesPerSecond
                  : null,
                qualityLimitationReason: isExternalString(
                  value.qualityLimitationReason,
                )
                  ? value.qualityLimitationReason
                  : undefined,
              };
              return [parsed];
            })
            .find(
              (stat) =>
                stat.type === "outbound-rtp" &&
                !stat.isRemote &&
                (stat.kind === "video" || stat.mediaType === "video"),
            )
        : null;
      if (outbound) {
        const frameTimeMs = calculateFrameTimeMs(
          Number(outbound.totalEncodeTime),
          Number(outbound.framesEncoded),
          previous,
        );
        previous = {
          totalEncodeTime: Number(outbound.totalEncodeTime),
          framesEncoded: Number(outbound.framesEncoded),
        };
        const settings = getSettings(active.source);
        const next = updateAdaptiveVideoState(
          state,
          {
            encodeUtilization:
              frameTimeMs == null
                ? null
                : (frameTimeMs * (Number(outbound.framesPerSecond) || 0)) / 10,
            framesPerSecond: outbound.framesPerSecond,
            qualityLimitationReason: outbound.qualityLimitationReason,
          },
          settings,
        );
        state = next;
        if (next.changed) await apply(active, next, settings);
      }
    } catch (error) {
      onError?.(error instanceof Error ? error : String(error));
    }
    if (active) schedule();
  }

  function start(entry: AdaptiveVideoEntry) {
    stop();
    const trackSettings = entry.track.getSettings?.() || {};
    const requested = getSettings(entry.source);
    const resolution = isVideoResolution(requested.resolution)
      ? VIDEO_RESOLUTIONS[requested.resolution]
      : null;
    active = {
      ...entry,
      ceilingWidth:
        Math.min(
          Number(trackSettings.width) || Infinity,
          Number(resolution?.width) || Infinity,
        ) || null,
      ceilingHeight:
        Math.min(
          Number(trackSettings.height) || Infinity,
          Number(resolution?.height) || Infinity,
        ) || null,
    };
    state = {
      scale: 1,
      frameRate: Number(requested.frameRate) || 30,
      pressureSamples: 0,
      healthySamples: 0,
    };
    schedule();
  }

  return { start, stop };
}

export function adaptiveTrackConstraints(
  entry: AdaptiveVideoEntry,
  state: AdaptiveVideoState,
  settings: AdaptiveVideoSettings,
): AdaptiveTrackConstraints {
  const scale = settings.qualityPriority === "framerate" ? state.scale : 1;
  const resolution = isVideoResolution(settings.resolution)
    ? VIDEO_RESOLUTIONS[settings.resolution]
    : null;
  const ceilingWidth = Math.min(
    Number(entry.ceilingWidth) || Infinity,
    Number(resolution?.width) || Infinity,
  );
  const ceilingHeight = Math.min(
    Number(entry.ceilingHeight) || Infinity,
    Number(resolution?.height) || Infinity,
  );
  const constraints: AdaptiveTrackConstraints = {
    frameRate: {
      ideal: state.frameRate,
      max: state.frameRate,
    },
  };
  if (Number.isFinite(ceilingWidth))
    constraints.width = {
      ideal: Math.max(1, Math.round(ceilingWidth / scale)),
      max: Math.max(1, Math.round(ceilingWidth / scale)),
    };
  if (Number.isFinite(ceilingHeight))
    constraints.height = {
      ideal: Math.max(1, Math.round(ceilingHeight / scale)),
      max: Math.max(1, Math.round(ceilingHeight / scale)),
    };
  return constraints;
}
