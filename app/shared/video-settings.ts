import type { AdaptiveFrameCounters } from "./types/adaptive-media.ts";
import type {
  VideoAdaptationState,
  VideoCaptureSelection,
  VideoCapabilityReport,
  VideoCodec,
  VideoFrameMetrics,
  VideoMediaCapabilities,
  VideoPolicy,
  VideoSenderOptions,
  VideoSettings,
  VideoSettingsInput,
  VideoSettingsResolutionInput,
} from "./types/video-settings.ts";

export const VIDEO_FRAME_RATE_MIN = 25;
export const LOW_SPEC_VIDEO_FRAME_RATE_MIN = 15;
export const VIDEO_RESOLUTION_PRIORITY_FRAME_RATE_MIN = 24;
export const VIDEO_FRAME_RATE_MAX = 60;
export const VIDEO_FRAME_RATE_PRESETS = Object.freeze([25, 30, 50, 60]);
export const SFU_VIDEO_MAX_BITRATE = 4_500_000;
export const P2P_VIDEO_MAX_BITRATE = 8_000_000;
export const SFU_VIDEO_MAX_WIDTH = 1920;
export const SFU_VIDEO_MAX_HEIGHT = 1080;
export const SCREEN_SHARE_FPS_HEALTH_RATIO = 0.8;
export const VIDEO_SCALE_STEPS = Object.freeze([1, 1.25, 1.5, 2, 2.5]);
export const VIDEO_QUALITY_PRIORITIES = Object.freeze([
  "framerate",
  "resolution",
]);

export const VIDEO_RESOLUTIONS = Object.freeze({
  original: null,
  "360p": { width: 640, height: 360 },
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
  "1440p": { width: 2560, height: 1440 },
  "2160p": { width: 3840, height: 2160 },
});

export function resolveRequestedVideoSettings({
  policy,
  settings,
  source,
}: {
  policy?: VideoPolicy | null;
  settings: { screenVideo: VideoSettings; cameraVideo: VideoSettings };
  source: string;
}): VideoSettings {
  const base =
    source === "screen" ? settings.screenVideo : settings.cameraVideo;
  return {
    ...base,
    ...(base.lowSpec === true ? { lowSpec: true } : {}),
    maxBitrate:
      Number(source === "screen" ? policy?.screenKbps : policy?.cameraKbps) *
        1000 || null,
  };
}

export function normalizeVideoSettings(
  value: VideoSettingsInput = {},
): VideoSettings {
  const resolution =
    typeof value.resolution === "string" &&
    Object.hasOwn(VIDEO_RESOLUTIONS, value.resolution)
      ? (value.resolution as VideoSettings["resolution"])
      : "original";
  const requestedFrameRate = Number(value.frameRate);
  const frameRatePresets =
    value.lowSpec === true
      ? [LOW_SPEC_VIDEO_FRAME_RATE_MIN, ...VIDEO_FRAME_RATE_PRESETS]
      : VIDEO_FRAME_RATE_PRESETS;
  const frameRate = Number.isFinite(requestedFrameRate)
    ? frameRatePresets.reduce((closest, preset) =>
        Math.abs(preset - requestedFrameRate) <
        Math.abs(closest - requestedFrameRate)
          ? preset
          : closest,
      )
    : 30;
  const qualityPriority =
    value.qualityPriority === "resolution" ||
    value.qualityPriority === "framerate"
      ? value.qualityPriority
      : "framerate";

  return {
    resolution,
    frameRate,
    qualityPriority,
    ...(value.lowSpec === true ? { lowSpec: true } : {}),
  };
}

export function isLowSpecNativeRuntime(): boolean {
  if (typeof navigator === "undefined") return false;
  const hardwareConcurrency = Number(navigator.hardwareConcurrency);
  const deviceMemory = Number(
    (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
  );
  return (
    (Number.isFinite(hardwareConcurrency) && hardwareConcurrency <= 4) ||
    (Number.isFinite(deviceMemory) && deviceMemory <= 4)
  );
}

export function applyLowSpecNativeVideoProfile(
  settings: VideoSettings,
  source: string,
  enabled: boolean,
): VideoSettings {
  if (!enabled || (source !== "camera" && source !== "screen")) return settings;
  const screen = source === "screen";
  const maximum = screen
    ? { width: 1280, height: 720, resolution: "720p" as const }
    : { width: 640, height: 360, resolution: "360p" as const };
  const width = Number(settings.width);
  const height = Number(settings.height);
  const requestedWidth = Number.isFinite(width) && width > 0 ? width : null;
  const requestedHeight = Number.isFinite(height) && height > 0 ? height : null;
  const requestedFrameRate = Number(settings.frameRate);
  const frameRate = Number.isFinite(requestedFrameRate)
    ? Math.min(15, requestedFrameRate)
    : 15;
  const maxBitrate = Number(settings.maxBitrate);
  const bitrateCeiling = screen ? 1_800_000 : 900_000;
  return {
    ...settings,
    resolution: maximum.resolution,
    width: Math.min(requestedWidth || maximum.width, maximum.width),
    height: Math.min(requestedHeight || maximum.height, maximum.height),
    frameRate: Math.max(LOW_SPEC_VIDEO_FRAME_RATE_MIN, frameRate),
    lowSpec: true,
    ...(Number.isFinite(maxBitrate) && maxBitrate > 0
      ? { maxBitrate: Math.min(maxBitrate, bitrateCeiling) }
      : { maxBitrate: bitrateCeiling }),
  };
}

export function buildVideoConstraints(
  settings: VideoSettingsInput,
  { deviceId = null, display = false }: VideoSettingsResolutionInput = {},
) {
  const normalized = normalizeVideoSettings(settings);
  const resolution = VIDEO_RESOLUTIONS[normalized.resolution];
  const minimumFrameRate =
    normalized.lowSpec === true
      ? LOW_SPEC_VIDEO_FRAME_RATE_MIN
      : normalized.qualityPriority === "resolution"
        ? VIDEO_RESOLUTION_PRIORITY_FRAME_RATE_MIN
        : VIDEO_FRAME_RATE_MIN;
  const constraints: MediaTrackConstraints = {
    frameRate: display
      ? { ideal: normalized.frameRate, max: normalized.frameRate }
      : {
          min: minimumFrameRate,
          ideal: normalized.frameRate,
          max: normalized.frameRate,
        },
  };

  if (resolution) {
    constraints.width = { ideal: resolution.width, max: resolution.width };
    constraints.height = { ideal: resolution.height, max: resolution.height };
  }
  if (!display && deviceId) constraints.deviceId = { exact: deviceId };

  return constraints;
}

export function buildVideoProduceOptions({
  width,
  height,
  frameRate,
  screen = false,
  qualityPriority = "framerate",
  maxBitrate: requestedMaxBitrate,
  lowSpec = false,
}: VideoSenderOptions = {}) {
  const pixels =
    Math.max(1, Number(width) || 1280) * Math.max(1, Number(height) || 720);
  const minimumFrameRate = lowSpec
    ? LOW_SPEC_VIDEO_FRAME_RATE_MIN
    : VIDEO_FRAME_RATE_MIN;
  const fps = Math.min(
    VIDEO_FRAME_RATE_MAX,
    Math.max(minimumFrameRate, Number(frameRate) || 30),
  );
  const bitsPerPixel = screen ? 0.06 : 0.05;
  const calculatedMinimum = lowSpec ? (screen ? 300_000 : 200_000) : 2_000_000;
  const calculatedMaximum = lowSpec
    ? screen
      ? 1_800_000
      : 900_000
    : SFU_VIDEO_MAX_BITRATE;
  const calculatedMaxBitrate = Math.min(
    calculatedMaximum,
    Math.max(calculatedMinimum, Math.round(pixels * fps * bitsPerPixel)),
  );
  const configuredMaxBitrate = Number(requestedMaxBitrate);
  const maxBitrate =
    Number.isFinite(configuredMaxBitrate) && configuredMaxBitrate > 0
      ? Math.min(
          calculatedMaximum,
          Math.max(
            lowSpec ? 100_000 : 100_000,
            Math.floor(configuredMaxBitrate),
          ),
        )
      : calculatedMaxBitrate;
  const scaleResolutionDownBy = Math.max(
    1,
    (Number(width) || 1280) / SFU_VIDEO_MAX_WIDTH,
    (Number(height) || 720) / SFU_VIDEO_MAX_HEIGHT,
  );

  return {
    encodings: [
      {
        maxBitrate,
        maxFramerate: Math.round(fps),
        scaleResolutionDownBy,
        networkPriority: "high",
        priority: "high",
      },
    ],
    codecOptions: {
      videoGoogleStartBitrate: Math.max(
        1000,
        Math.round((maxBitrate * 0.7) / 1000),
      ),
    },
    degradationPreference:
      qualityPriority === "resolution"
        ? "maintain-resolution"
        : "maintain-framerate",
  };
}

export function buildP2pVideoSenderOptions(options: VideoSenderOptions = {}) {
  const settings = buildVideoProduceOptions(options);
  const pixels =
    Math.max(1, Number(options.width) || 1280) *
    Math.max(1, Number(options.height) || 720);
  const fps = Math.min(
    VIDEO_FRAME_RATE_MAX,
    Math.max(
      options.lowSpec ? LOW_SPEC_VIDEO_FRAME_RATE_MIN : VIDEO_FRAME_RATE_MIN,
      Number(options.frameRate) || 30,
    ),
  );
  const bitsPerPixel = options.screen ? 0.065 : 0.055;
  const calculatedMinimum = options.lowSpec
    ? options.screen
      ? 400_000
      : 250_000
    : 2_000_000;
  const calculatedMaximum = options.lowSpec
    ? options.screen
      ? 2_000_000
      : 1_000_000
    : P2P_VIDEO_MAX_BITRATE;
  const calculatedMaxBitrate = Math.min(
    calculatedMaximum,
    Math.max(calculatedMinimum, Math.round(pixels * fps * bitsPerPixel)),
  );
  const configuredMaxBitrate = Number(options.maxBitrate);
  const maxBitrate =
    Number.isFinite(configuredMaxBitrate) && configuredMaxBitrate > 0
      ? Math.min(
          calculatedMaximum,
          Math.max(100_000, Math.floor(configuredMaxBitrate)),
        )
      : calculatedMaxBitrate;
  return {
    ...settings,
    encodings: settings.encodings.map((encoding) => ({
      ...encoding,
      maxBitrate,
      scaleResolutionDownBy: 1,
    })),
  };
}

export function resolveNativeCaptureVideoSettings(
  captureSelection: VideoCaptureSelection | null = null,
  requestedSettings: VideoSettingsInput = {},
) {
  const captureVideo =
    captureSelection?.video && typeof captureSelection.video === "object"
      ? captureSelection.video
      : {};
  const bounds =
    captureSelection?.bounds && typeof captureSelection.bounds === "object"
      ? captureSelection.bounds
      : {};
  const requestedResolution =
    typeof requestedSettings.resolution === "string" &&
    Object.hasOwn(VIDEO_RESOLUTIONS, requestedSettings.resolution) &&
    requestedSettings.resolution !== "original"
      ? VIDEO_RESOLUTIONS[requestedSettings.resolution]
      : null;
  const positiveNumber = (value: unknown) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  };
  const width =
    positiveNumber(requestedSettings.width) ||
    positiveNumber(requestedResolution?.width) ||
    positiveNumber(captureVideo.width) ||
    positiveNumber(bounds.width);
  const height =
    positiveNumber(requestedSettings.height) ||
    positiveNumber(requestedResolution?.height) ||
    positiveNumber(captureVideo.height) ||
    positiveNumber(bounds.height);
  const frameRate =
    positiveNumber(requestedSettings.frameRate) ||
    positiveNumber(captureVideo.frameRate);
  return {
    ...captureVideo,
    ...requestedSettings,
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ...(frameRate ? { frameRate } : {}),
    ...(requestedSettings.qualityPriority
      ? { qualityPriority: requestedSettings.qualityPriority }
      : {}),
    ...(requestedSettings.maxBitrate
      ? { maxBitrate: requestedSettings.maxBitrate }
      : {}),
  };
}

export function sortP2pVideoCodecPreferences<
  T extends Pick<VideoCodec, "mimeType">,
>(codecs: T[] = []) {
  const priorities = ["video/H264", "video/VP9", "video/VP8"];
  return [...codecs].sort((left, right) => {
    const leftIndex = priorities.findIndex(
      (value) => value.toLowerCase() === left?.mimeType?.toLowerCase(),
    );
    const rightIndex = priorities.findIndex(
      (value) => value.toLowerCase() === right?.mimeType?.toLowerCase(),
    );
    return (
      (leftIndex < 0 ? priorities.length : leftIndex) -
      (rightIndex < 0 ? priorities.length : rightIndex)
    );
  });
}

export function updateVideoAdaptationState(
  state: VideoAdaptationState = {},
  sendFps: unknown,
  targetFps: unknown,
) {
  const currentScale =
    state.scale !== undefined && VIDEO_SCALE_STEPS.includes(state.scale)
      ? state.scale
      : 1;
  const actual = Number(sendFps);
  const target = Number(targetFps);
  if (!Number.isFinite(actual) || !Number.isFinite(target) || target <= 0) {
    return {
      scale: currentScale,
      lowSamples: 0,
      healthySamples: 0,
      changed: false,
    };
  }

  const lowSamples = actual < target * 0.8 ? (state.lowSamples || 0) + 1 : 0;
  const healthySamples =
    actual >= target * 0.93 ? (state.healthySamples || 0) + 1 : 0;
  let scale = currentScale;

  if (lowSamples >= 3) {
    scale =
      VIDEO_SCALE_STEPS[
        Math.min(
          VIDEO_SCALE_STEPS.length - 1,
          VIDEO_SCALE_STEPS.indexOf(currentScale) + 1,
        )
      ] ?? currentScale;
  } else if (healthySamples >= 5) {
    scale =
      VIDEO_SCALE_STEPS[
        Math.max(0, VIDEO_SCALE_STEPS.indexOf(currentScale) - 1)
      ] ?? currentScale;
  }

  const changed = scale !== currentScale;
  return {
    scale,
    lowSamples: changed ? 0 : lowSamples,
    healthySamples: changed ? 0 : healthySamples,
    changed,
  };
}

export function isScreenShareFpsBelowTarget(
  sendFps: unknown,
  targetFps: unknown,
  ratio = SCREEN_SHARE_FPS_HEALTH_RATIO,
) {
  if (sendFps == null || targetFps == null) return false;
  const actual = Number(sendFps);
  const target = Number(targetFps);
  return (
    Number.isFinite(actual) &&
    Number.isFinite(target) &&
    target > 0 &&
    actual < target * ratio
  );
}

export function calculateFrameTimeMs(
  totalEncodeTime: unknown,
  framesEncoded: unknown,
  previous: AdaptiveFrameCounters | null = null,
) {
  const total = Number(totalEncodeTime);
  const frames = Number(framesEncoded);
  if (!Number.isFinite(total) || !Number.isFinite(frames) || frames <= 0)
    return null;

  const previousTotal = Number(previous?.totalEncodeTime);
  const previousFrames = Number(previous?.framesEncoded);
  const hasPrevious =
    Number.isFinite(previousTotal) && Number.isFinite(previousFrames);
  const encodeTime = hasPrevious ? total - previousTotal : total;
  const encodedFrames = hasPrevious ? frames - previousFrames : frames;
  if (encodeTime < 0 || encodedFrames <= 0) return null;
  return (encodeTime / encodedFrames) * 1000;
}

export function calculateEncodedFps(
  framesEncoded: unknown,
  timestamp: unknown,
  previous: VideoFrameMetrics | null = null,
) {
  const frames = Number(framesEncoded);
  const time = Number(timestamp);
  const previousFrames = Number(previous?.framesEncoded);
  const previousTime = Number(previous?.timestamp);
  if (![frames, time, previousFrames, previousTime].every(Number.isFinite))
    return null;
  const elapsedMs = time - previousTime;
  const encodedFrames = frames - previousFrames;
  if (elapsedMs <= 0 || encodedFrames < 0) return null;
  return (encodedFrames * 1000) / elapsedMs;
}

export function calculateBitrateKbps(
  bytes: unknown,
  timestamp: unknown,
  previous: VideoFrameMetrics | null = null,
) {
  const currentBytes = Number(bytes);
  const currentTime = Number(timestamp);
  const previousBytes = Number(previous?.bytes);
  const previousTime = Number(previous?.timestamp);
  if (
    ![currentBytes, currentTime, previousBytes, previousTime].every(
      Number.isFinite,
    )
  )
    return null;
  const elapsedMs = currentTime - previousTime;
  const transferredBytes = currentBytes - previousBytes;
  if (elapsedMs <= 0 || transferredBytes < 0) return null;
  return (transferredBytes * 8) / elapsedMs;
}

export function classifyCodecImplementation(implementation: unknown) {
  const value = typeof implementation === "string" ? implementation.trim() : "";
  if (!value) return { type: "unknown", label: "Not reported by browser" };

  const normalized = value.toLowerCase();
  const hardwareMarkers = [
    "hardware",
    "videotoolbox",
    "vaapi",
    "va-api",
    "nvenc",
    "nvdec",
    "qsv",
    "media foundation",
    "mediacodec",
  ];
  const softwareMarkers = [
    "software",
    "libvpx",
    "libaom",
    "openh264",
    "ffmpeg",
    "dav1d",
  ];
  const type = hardwareMarkers.some((marker) => normalized.includes(marker))
    ? "hardware"
    : softwareMarkers.some((marker) => normalized.includes(marker))
      ? "software"
      : "unknown";

  return {
    type,
    label: `${type === "unknown" ? "Unknown" : type.charAt(0).toUpperCase() + type.slice(1)} (${value})`,
  };
}

export function calculateMediaEngineUtilization(
  processingTimeMs: unknown,
  fps: unknown,
) {
  if (processingTimeMs == null || fps == null) return null;
  const time = Number(processingTimeMs);
  const rate = Number(fps);
  if (!Number.isFinite(time) || !Number.isFinite(rate) || time < 0 || rate <= 0)
    return null;
  return Math.min(100, Math.max(0, (time * rate) / 10));
}

export function selectHardwarePreferredVideoCodec(codecs: VideoCodec[] = []) {
  const videoCodecs = codecs.filter(
    (codec) =>
      codec?.kind === "video" &&
      !/\/(rtx|red|ulpfec|flexfec)/i.test(codec.mimeType || ""),
  );
  const priorities = [
    "video/H264",
    "video/H265",
    "video/VP9",
    "video/AV1",
    "video/VP8",
  ];
  return (
    priorities
      .map((mimeType) =>
        videoCodecs.find(
          (codec) => codec.mimeType?.toLowerCase() === mimeType.toLowerCase(),
        ),
      )
      .find(Boolean) ||
    videoCodecs[0] ||
    null
  );
}

export function buildWebRtcCodecContentType(
  codec: VideoCodec | null | undefined,
) {
  const mimeType = codec?.mimeType || "";
  const parameters = Object.entries(codec?.parameters || {})
    .filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    )
    .map(([key, value]) => `${key}=${value}`);
  return parameters.length ? `${mimeType};${parameters.join(";")}` : mimeType;
}

export async function selectPowerEfficientVideoCodec(
  codecs: VideoCodec[] = [],
  video: VideoSenderOptions = {},
  mediaCapabilities: VideoMediaCapabilities | undefined = globalThis.navigator
    ?.mediaCapabilities,
) {
  const ranked = await rankVideoCodecsByHardwarePreference(
    codecs,
    video,
    mediaCapabilities,
  );
  return ranked[0] || null;
}

export async function inspectVideoCodecCapabilities(
  codecs: VideoCodec[] = [],
  video: VideoSenderOptions = {},
  mediaCapabilities: VideoMediaCapabilities | undefined = globalThis.navigator
    ?.mediaCapabilities,
) {
  const fallback = selectHardwarePreferredVideoCodec(codecs);
  const remaining = codecs.filter(
    (codec) =>
      codec?.kind === "video" &&
      !/\/(rtx|red|ulpfec|flexfec)/i.test(codec.mimeType || ""),
  );
  const ordered: VideoCodec[] = [];
  let next = fallback;
  while (next) {
    ordered.push(next);
    remaining.splice(remaining.indexOf(next), 1);
    next = selectHardwarePreferredVideoCodec(remaining);
  }

  const reports: VideoCapabilityReport[] = [];
  for (const codec of ordered) {
    const contentType = buildWebRtcCodecContentType(codec);
    const report: VideoCapabilityReport = {
      codec,
      mimeType: codec.mimeType || "",
      contentType,
      supported: null,
      smooth: null,
      powerEfficient: null,
      error: null,
    };
    if (!mediaCapabilities?.encodingInfo) {
      reports.push(report);
      continue;
    }

    try {
      const info = await mediaCapabilities.encodingInfo({
        type: "webrtc",
        video: {
          contentType,
          width: Math.max(1, Math.round(Number(video.width) || 1280)),
          height: Math.max(1, Math.round(Number(video.height) || 720)),
          bitrate: Math.max(1, Math.round(Number(video.bitrate) || 8_000_000)),
          framerate: Math.max(1, Number(video.framerate) || 30),
        },
      });
      report.supported =
        typeof info.supported === "boolean" ? info.supported : null;
      report.smooth = typeof info.smooth === "boolean" ? info.smooth : null;
      report.powerEfficient =
        typeof info.powerEfficient === "boolean" ? info.powerEfficient : null;
    } catch (error) {
      report.error = error instanceof Error ? error.message : String(error);
    }
    reports.push(report);
  }
  return reports;
}

export async function inspectH264ProfileCapabilities(
  video: VideoSenderOptions = {},
  mediaCapabilities: VideoMediaCapabilities | undefined = globalThis.navigator
    ?.mediaCapabilities,
) {
  const profiles = ["42e01f", "42001f", "4d001f", "42e02a"];
  const codecs = profiles.map((profileLevelId) => ({
    kind: "video",
    mimeType: "video/H264",
    parameters: {
      "packetization-mode": 1,
      "level-asymmetry-allowed": 1,
      "profile-level-id": profileLevelId,
    },
  }));
  const reports = await inspectVideoCodecCapabilities(
    codecs,
    video,
    mediaCapabilities,
  );
  return reports.map(({ codec, ...report }, index) => ({
    ...report,
    profileLevelId: profiles[index],
  }));
}

export async function rankVideoCodecsByHardwarePreference(
  codecs: VideoCodec[] = [],
  video: VideoSenderOptions = {},
  mediaCapabilities: VideoMediaCapabilities | undefined = globalThis.navigator
    ?.mediaCapabilities,
  capabilityReports: VideoCapabilityReport[] | null = null,
) {
  const reports =
    capabilityReports ||
    (await inspectVideoCodecCapabilities(codecs, video, mediaCapabilities));
  const hardware: VideoCodec[] = [];
  const softwareOrUnknown: VideoCodec[] = [];
  for (const report of reports) {
    if (report.supported && report.powerEfficient) hardware.push(report.codec);
    else softwareOrUnknown.push(report.codec);
  }
  return [...hardware, ...softwareOrUnknown];
}
