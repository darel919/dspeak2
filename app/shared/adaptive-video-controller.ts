import {
  calculateFrameTimeMs,
  VIDEO_RESOLUTIONS,
  VIDEO_SCALE_STEPS,
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

const ADAPTIVE_FRAME_RATES = Object.freeze([25, 30, 50, 60]);

export function updateAdaptiveVideoState(
  state: AdaptiveVideoState | null,
  sample: AdaptiveVideoSample,
  settings: AdaptiveVideoSettings,
) {
  const priority = settings.qualityPriority;
  const targetFrameRate = Number(settings.frameRate) || 30;
  const currentScale = state?.scale;
  const scale =
    currentScale !== undefined && VIDEO_SCALE_STEPS.includes(currentScale)
      ? currentScale
      : 1;
  const frameRate = Math.min(
    targetFrameRate,
    Number(state?.frameRate) || targetFrameRate,
  );
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

  if (pressureSamples >= 3) {
    if (priority === "resolution") {
      const lowerRates = ADAPTIVE_FRAME_RATES.filter(
        (candidate) => candidate < frameRate,
      );
      nextFrameRate = lowerRates.at(-1) || frameRate;
    } else {
      nextScale =
        VIDEO_SCALE_STEPS[
          Math.min(
            VIDEO_SCALE_STEPS.length - 1,
            VIDEO_SCALE_STEPS.indexOf(scale) + 1,
          )
        ] ?? scale;
    }
  } else if (healthySamples >= 6) {
    if (priority === "resolution") {
      const higherRates = ADAPTIVE_FRAME_RATES.filter(
        (candidate) => candidate > frameRate && candidate <= targetFrameRate,
      );
      nextFrameRate = higherRates[0] || frameRate;
    } else {
      nextScale =
        VIDEO_SCALE_STEPS[Math.max(0, VIDEO_SCALE_STEPS.indexOf(scale) - 1)] ??
        scale;
    }
  }

  const changed = nextScale !== scale || nextFrameRate !== frameRate;
  return {
    scale: nextScale,
    frameRate: nextFrameRate,
    pressureSamples: changed ? 0 : pressureSamples,
    healthySamples: changed ? 0 : healthySamples,
    changed,
  };
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
  onError?: (error: unknown) => void;
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
        ? ([...report.values()] as AdaptiveVideoReport[]).find(
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
      onError?.(error);
    }
    if (active) schedule();
  }

  function start(entry: AdaptiveVideoEntry) {
    stop();
    const trackSettings = entry.track.getSettings?.() || {};
    const requested = getSettings(entry.source);
    const resolution =
      VIDEO_RESOLUTIONS[requested.resolution as keyof typeof VIDEO_RESOLUTIONS];
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
  const resolution =
    VIDEO_RESOLUTIONS[settings.resolution as keyof typeof VIDEO_RESOLUTIONS];
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
