import {
  buildVideoProduceOptions,
  isVideoResolution,
  resolveNativeCaptureVideoSettings,
  VIDEO_RESOLUTIONS,
} from "../video-settings.ts";
import { getAudioCodecPolicy } from "#shared/audio-codec-policy.ts";
import type { NativeSourceEntry } from "../types/native-mediasoup-session.ts";
import { isExternalRecord } from "../types/boundary.ts";

const CLOUDFLARE_REQUEST_TIMEOUT_MS = 15000;

function positiveVideoMetadata<T>(value: T) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

type NativeProducerEncoding = {
  maxBitrate?: number;
  maxFramerate?: number;
  scaleResolutionDownBy?: number;
  priority?: string;
  networkPriority?: string;
};

type NativeProducerAppData = {
  source: string;
  logicalStreamId?: string;
  generation?: number;
  variantId?: string;
  codec?: string;
  producerKey?: string;
  ownerSource?: string;
  captureSelection?: NativeSourceEntry["captureSelection"];
  receivers?: string[];
  emergency?: boolean;
  routingScore?: number;
  target?: NativeSourceEntry["target"];
  targetAdjusted?: boolean;
  encodings?: NativeProducerEncoding[];
  codecOptions?:
    | {
        opusDtx: boolean;
        opusFec: boolean;
        opusNack: boolean;
        opusStereo: boolean;
        opusPtime: number;
      }
    | {
        videoGoogleStartBitrate: number;
      };
  codecParameters?: Record<string, unknown>;
  codecAcceleration?: string | null;
  codecImplementation?: string | null;
  degradationPreference?: string;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  bitrate?: number | null;
};

function nativeVideoMetadata(entry: NativeSourceEntry) {
  const video = resolveNativeCaptureVideoSettings(
    entry.captureSelection,
    entry.videoSettings || undefined,
  );
  const resolution = isVideoResolution(video.resolution)
    ? VIDEO_RESOLUTIONS[video.resolution]
    : undefined;
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
  const encoding = options.encodings?.[0];
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
): NativeProducerAppData {
  const appData: NativeProducerAppData = { source: entry.source };
  if (entry.logicalStreamId) appData.logicalStreamId = entry.logicalStreamId;
  const generation = Number(entry.generation);
  if (Number.isFinite(generation))
    appData.generation = Math.max(1, Math.floor(generation));
  if (entry.variantId) appData.variantId = entry.variantId;
  if (entry.codec) appData.codec = entry.codec;
  if (entry.producerKey) appData.producerKey = entry.producerKey;
  if (entry.ownerSource) appData.ownerSource = entry.ownerSource;
  if (entry.captureSelection) appData.captureSelection = entry.captureSelection;
  if (Array.isArray(entry.receivers)) appData.receivers = entry.receivers;
  if (entry.emergency === true) appData.emergency = true;
  const routingScore = Number(entry.routingScore);
  if (Number.isFinite(routingScore)) appData.routingScore = routingScore;
  if (entry.target) appData.target = entry.target;
  if (entry.targetAdjusted) appData.targetAdjusted = true;
  if (kind === "audio") {
    const audioSelection = isExternalRecord(entry.captureSelection?.audio)
      ? entry.captureSelection.audio
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
    const audioEncoding: NativeProducerEncoding = {
      priority: "high",
      networkPriority: "high",
    };
    if (Number.isFinite(maxBitrate) && maxBitrate > 0)
      audioEncoding.maxBitrate = Math.floor(maxBitrate);
    appData.encodings = [audioEncoding];
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
  const resolution = isVideoResolution(video.resolution)
    ? VIDEO_RESOLUTIONS[video.resolution]
    : undefined;
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
  const target = entry.target || {};
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
  const encodings = options.encodings;
  appData.encodings = encodings;
  const encoding = encodings[0];
  if (encoding) {
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
