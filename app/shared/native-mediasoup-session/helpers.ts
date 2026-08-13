import {
  buildVideoProduceOptions,
  resolveNativeCaptureVideoSettings,
  VIDEO_RESOLUTIONS,
} from "../video-settings.ts";
import { getAudioCodecPolicy } from "#shared/audio-codec-policy.ts";
import type { NativeSourceEntry } from "../types/native-mediasoup-session.ts";

const CLOUDFLARE_REQUEST_TIMEOUT_MS = 15000;

function nativeProducerAppData(
  entry: NativeSourceEntry,
  kind: "audio" | "video",
): Record<string, unknown> {
  const appData: Record<string, unknown> = {
    source: entry.source,
    ...(entry.ownerSource ? { ownerSource: entry.ownerSource } : {}),
    ...(entry.captureSelection
      ? { captureSelection: entry.captureSelection }
      : {}),
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
  const options = buildVideoProduceOptions({
    width: video.width || resolution?.width || 1920,
    height: video.height || resolution?.height || 1080,
    frameRate: video.frameRate || 30,
    qualityPriority: video.qualityPriority || "framerate",
    screen: entry.source === "screen",
    maxBitrate: video.maxBitrate,
    lowSpec: video.lowSpec === true,
  });
  appData.encodings = options.encodings;
  appData.codecOptions = options.codecOptions;
  appData.degradationPreference = options.degradationPreference;
  return appData;
}

export { CLOUDFLARE_REQUEST_TIMEOUT_MS, nativeProducerAppData };
