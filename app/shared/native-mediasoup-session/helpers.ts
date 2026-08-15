import {
  buildVideoProduceOptions,
  resolveNativeCaptureVideoSettings,
  VIDEO_RESOLUTIONS,
} from "../video-settings.ts";
import { getAudioCodecPolicy } from "#shared/audio-codec-policy.ts";
import type { NativeSourceEntry } from "../types/native-mediasoup-session.ts";

const CLOUDFLARE_REQUEST_TIMEOUT_MS = 15000;

function positiveVideoMetadata(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

function nativeVideoMetadata(entry: NativeSourceEntry) {
  const video = resolveNativeCaptureVideoSettings(
    entry.captureSelection,
    entry.videoSettings || undefined,
  );
  const resolutionKey = String(
    video.resolution || "",
  ) as keyof typeof VIDEO_RESOLUTIONS;
  const resolution = VIDEO_RESOLUTIONS[resolutionKey];
  const width = Number(entry.width || video.width || resolution?.width || 1920);
  const height = Number(
    entry.height || video.height || resolution?.height || 1080,
  );
  const options = buildVideoProduceOptions({
    width,
    height,
    frameRate: video.frameRate || 30,
    qualityPriority: video.qualityPriority || "framerate",
    screen: entry.source === "screen",
    maxBitrate: video.maxBitrate,
    lowSpec: video.lowSpec === true,
  });
  const encoding = options.encodings?.[0] as
    Record<string, unknown> | undefined;
  return {
    width: positiveVideoMetadata(width),
    height: positiveVideoMetadata(height),
    fps: positiveVideoMetadata(entry.fps || encoding?.maxFramerate),
    bitrate: positiveVideoMetadata(entry.bitrate || encoding?.maxBitrate),
  };
}

function nativeProducerAppData(
  entry: NativeSourceEntry,
  kind: "audio" | "video",
): Record<string, unknown> {
  const appData: Record<string, unknown> = {
    source: entry.source,
    ...(entry.logicalStreamId
      ? { logicalStreamId: entry.logicalStreamId }
      : {}),
    ...(Number.isFinite(Number(entry.generation))
      ? { generation: Math.max(1, Math.floor(Number(entry.generation))) }
      : {}),
    ...(entry.variantId ? { variantId: entry.variantId } : {}),
    ...(entry.codec ? { codec: entry.codec } : {}),
    ...(entry.producerKey ? { producerKey: entry.producerKey } : {}),
    ...(entry.ownerSource ? { ownerSource: entry.ownerSource } : {}),
    ...(entry.captureSelection
      ? { captureSelection: entry.captureSelection }
      : {}),
    ...(Array.isArray(entry.receivers) ? { receivers: entry.receivers } : {}),
    ...(entry.emergency === true ? { emergency: true } : {}),
    ...(Number.isFinite(Number(entry.routingScore))
      ? { routingScore: Number(entry.routingScore) }
      : {}),
    ...(entry.target ? { target: entry.target } : {}),
    ...(entry.targetAdjusted ? { targetAdjusted: true } : {}),
  };
  if (kind === "audio") {
    const audioSelection =
      entry.captureSelection?.audio &&
      typeof entry.captureSelection.audio === "object"
        ? (entry.captureSelection.audio as Record<string, unknown>)
        : null;
    const policy = getAudioCodecPolicy(
      entry.source === "screen-audio" ? "shared-audio" : "microphone",
      entry.audioStereo === true,
    );
    const maxBitrate = Number(
      audioSelection?.maxBitrateBps ||
        entry.audioBitrate ||
        entry.roomBitrateBps ||
        policy.maxBitrateBps,
    );
    appData.encodings = [
      {
        ...(Number.isFinite(maxBitrate) && maxBitrate > 0
          ? { maxBitrate: Math.floor(maxBitrate) }
          : {}),
        priority: "high",
        networkPriority: "high",
      },
    ];
    appData.codecOptions = {
      opusDtx: false,
      opusFec: true,
      opusNack: true,
      opusStereo:
        entry.audioStereo === undefined
          ? entry.source === "screen-audio"
          : entry.audioStereo === true,
      opusPtime: 10,
    };
    return appData;
  }
  const video = resolveNativeCaptureVideoSettings(
    entry.captureSelection,
    entry.videoSettings || undefined,
  );
  const resolutionKey = String(
    video.resolution || "",
  ) as keyof typeof VIDEO_RESOLUTIONS;
  const resolution = VIDEO_RESOLUTIONS[resolutionKey];
  const captureWidth =
    Number(video.width) ||
    Number(resolution?.width) ||
    Number(entry.width) ||
    1920;
  const captureHeight =
    Number(video.height) ||
    Number(resolution?.height) ||
    Number(entry.height) ||
    1080;
  const captureFrameRate = Number(video.frameRate) || Number(entry.fps) || 30;
  const captureBitrate =
    Number(video.maxBitrate) || Number(entry.bitrate) || undefined;
  const target =
    entry.target && typeof entry.target === "object" ? entry.target : {};
  const targetWidth = Number(target.width) || captureWidth;
  const targetHeight = Number(target.height) || captureHeight;
  const targetFrameRate = Number(target.fps) || captureFrameRate;
  const targetBitrate = Number(target.bitrate) || captureBitrate;
  const options = buildVideoProduceOptions({
    width: captureWidth,
    height: captureHeight,
    frameRate: captureFrameRate,
    qualityPriority: video.qualityPriority || "framerate",
    screen: entry.source === "screen",
    maxBitrate: captureBitrate,
    lowSpec: video.lowSpec === true,
  });
  const encodings = options.encodings as Array<Record<string, unknown>>;
  appData.encodings = encodings;
  const encoding = encodings[0];
  if (encoding && typeof encoding === "object") {
    encoding.maxFramerate = Math.min(
      Number(encoding.maxFramerate) || targetFrameRate,
      targetFrameRate,
    );
    if (targetBitrate)
      encoding.maxBitrate = Math.min(
        Number(encoding.maxBitrate) || targetBitrate,
        targetBitrate,
      );
    encoding.scaleResolutionDownBy = Math.max(
      Number(encoding.scaleResolutionDownBy) || 1,
      captureWidth / Math.max(1, targetWidth),
      captureHeight / Math.max(1, targetHeight),
    );
  }
  appData.codecOptions = options.codecOptions;
  appData.degradationPreference = options.degradationPreference;
  Object.assign(appData, nativeVideoMetadata(entry));
  return appData;
}

export {
  CLOUDFLARE_REQUEST_TIMEOUT_MS,
  nativeProducerAppData,
  nativeVideoMetadata,
};
