import {
  buildVideoProduceOptions,
  resolveNativeCaptureVideoSettings,
  VIDEO_RESOLUTIONS,
} from "../video-settings.js";

const CLOUDFLARE_REQUEST_TIMEOUT_MS = 15000;

function nativeProducerAppData(entry, kind) {
  const appData = {
    source: entry.source,
    ...(entry.ownerSource ? { ownerSource: entry.ownerSource } : {}),
    ...(entry.captureSelection
      ? { captureSelection: entry.captureSelection }
      : {}),
  };
  if (kind === "audio") {
    const maxBitrate = Number(
      entry.captureSelection?.audio?.maxBitrateBps ||
        entry.audioBitrate ||
        entry.roomBitrateBps,
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
    entry.videoSettings || {},
  );
  const resolution = VIDEO_RESOLUTIONS[video.resolution];
  const options = buildVideoProduceOptions({
    width: video.width || resolution?.width || 1920,
    height: video.height || resolution?.height || 1080,
    frameRate: video.frameRate || 60,
    qualityPriority: video.qualityPriority || "framerate",
    screen: entry.source === "screen",
    maxBitrate: video.maxBitrate,
  });
  appData.encodings = options.encodings;
  appData.codecOptions = options.codecOptions;
  appData.degradationPreference = options.degradationPreference;
  return appData;
}

export { CLOUDFLARE_REQUEST_TIMEOUT_MS, nativeProducerAppData };
