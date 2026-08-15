import {
  emptyCodecDirectionCapability,
  emptyVideoCodecCapabilities,
  type CodecDirectionCapability,
  type ParticipantMediaCapabilities,
  type RealtimeEfficiency,
  type VideoCodecName,
  VIDEO_CODEC_NAMES,
} from "./types/video-codec-capabilities.ts";

type BrowserCodecEntry = {
  mimeType?: unknown;
  sdpFmtpLine?: unknown;
};

type BrowserCapabilityInfo = {
  supported?: boolean;
  smooth?: boolean;
  powerEfficient?: boolean;
};

type BrowserMediaCapabilitiesApi = {
  encodingInfo?: (
    configuration: Record<string, unknown>,
  ) => Promise<BrowserCapabilityInfo>;
  decodingInfo?: (
    configuration: Record<string, unknown>,
  ) => Promise<BrowserCapabilityInfo>;
};

type BrowserRtpCapabilitiesApi = {
  getCapabilities?: (kind: "video") => { codecs?: unknown[] } | null;
};

export interface BrowserVideoCodecProbeEnvironment {
  sender?: BrowserRtpCapabilitiesApi | null;
  receiver?: BrowserRtpCapabilitiesApi | null;
  mediaCapabilities?: BrowserMediaCapabilitiesApi | null;
}

const CODEC_MIME_TYPES: Record<VideoCodecName, string[]> = {
  H264: ["video/h264"],
  H265: ["video/h265", "video/hevc"],
  VP8: ["video/vp8"],
  VP9: ["video/vp9"],
  AV1: ["video/av1"],
};

const DEFAULT_SOFTWARE_EFFICIENCY: Record<VideoCodecName, RealtimeEfficiency> =
  {
    H264: "acceptable",
    H265: "poor",
    VP8: "acceptable",
    VP9: "poor",
    AV1: "unusable",
  };

const PROBE_WIDTH = 1280;
const PROBE_HEIGHT = 720;
const PROBE_FPS = 30;
const PROBE_BITRATE = 2_000_000;

function browserApi(
  environment: BrowserVideoCodecProbeEnvironment = {},
): BrowserVideoCodecProbeEnvironment {
  if (
    environment.sender ||
    environment.receiver ||
    environment.mediaCapabilities
  )
    return environment;
  const sender = (globalThis as { RTCRtpSender?: BrowserRtpCapabilitiesApi })
    .RTCRtpSender;
  const receiver = (
    globalThis as { RTCRtpReceiver?: BrowserRtpCapabilitiesApi }
  ).RTCRtpReceiver;
  const mediaCapabilities = (
    globalThis.navigator as unknown as {
      mediaCapabilities?: BrowserMediaCapabilitiesApi;
    }
  )?.mediaCapabilities;
  return { sender, receiver, mediaCapabilities };
}

function codecEntries(
  api: BrowserRtpCapabilitiesApi | null | undefined,
  codec: VideoCodecName,
) {
  let entries: unknown[] = [];
  try {
    const capabilities = api?.getCapabilities?.("video");
    entries = Array.isArray(capabilities?.codecs) ? capabilities.codecs : [];
  } catch {}
  const mimeTypes = CODEC_MIME_TYPES[codec];
  return entries.filter((value): value is BrowserCodecEntry => {
    if (!value || typeof value !== "object") return false;
    const mimeType = String((value as BrowserCodecEntry).mimeType || "")
      .trim()
      .toLowerCase();
    return (
      mimeTypes.includes(mimeType) &&
      !/(rtx|red|ulpfec|flexfec)/i.test(mimeType)
    );
  });
}

function contentType(codec: VideoCodecName, entry?: BrowserCodecEntry) {
  const mimeType = String(
    entry?.mimeType || CODEC_MIME_TYPES[codec][0] || "video/H264",
  );
  const fmtp = String(entry?.sdpFmtpLine || "").trim();
  return fmtp ? `${mimeType};${fmtp}` : mimeType;
}

async function queryDirection(
  codec: VideoCodecName,
  direction: "encode" | "decode",
  entries: BrowserCodecEntry[],
  mediaCapabilities: BrowserMediaCapabilitiesApi | null | undefined,
) {
  const query =
    direction === "encode"
      ? mediaCapabilities?.encodingInfo
      : mediaCapabilities?.decodingInfo;
  if (!query) return { info: null, error: null };
  let best: BrowserCapabilityInfo | null = null;
  let error: string | null = null;
  const candidates = entries.length ? entries.slice(0, 4) : [undefined];
  for (const entry of candidates) {
    try {
      const result = await query.call(mediaCapabilities, {
        type: "webrtc",
        video: {
          contentType: contentType(codec, entry),
          width: PROBE_WIDTH,
          height: PROBE_HEIGHT,
          bitrate: PROBE_BITRATE,
          framerate: PROBE_FPS,
        },
      });
      const info: BrowserCapabilityInfo =
        result && typeof result === "object" ? result : {};
      if (!best || (info.supported === true && best.supported !== true))
        best = info;
      if (info.supported === true && info.smooth !== false) break;
    } catch (queryError) {
      error =
        queryError instanceof Error ? queryError.message : String(queryError);
    }
  }
  return { info: best, error };
}

function directionCapability(
  codec: VideoCodecName,
  entries: BrowserCodecEntry[],
  info: BrowserCapabilityInfo | null,
  error: string | null,
  rtpCapabilitiesAvailable: boolean,
): CodecDirectionCapability {
  const supported =
    info?.supported === false
      ? false
      : rtpCapabilitiesAvailable
        ? entries.length > 0
        : info?.supported === true;
  if (!supported) {
    return {
      ...emptyCodecDirectionCapability(),
      ...(error ? { failureReason: error } : {}),
    };
  }
  const powerEfficient = info?.powerEfficient === true;
  const smooth = info?.smooth !== false;
  const realtimeEfficiency: RealtimeEfficiency = powerEfficient
    ? smooth
      ? "good"
      : "acceptable"
    : smooth
      ? DEFAULT_SOFTWARE_EFFICIENCY[codec]
      : "poor";
  return {
    supported: true,
    acceleration: powerEfficient ? "hardware" : "software",
    implementation: powerEfficient
      ? "browser-mediacapabilities-power-efficient"
      : "browser-webrtc",
    realtimeEfficiency,
    maxWidth: PROBE_WIDTH,
    maxHeight: PROBE_HEIGHT,
    maxFps: PROBE_FPS,
    tested: info !== null,
    ...(entries[0]?.sdpFmtpLine
      ? { testedProfile: String(entries[0].sdpFmtpLine) }
      : {}),
    ...(error ? { failureReason: error } : {}),
  };
}

export async function probeBrowserVideoCodecCapabilities(
  environment: BrowserVideoCodecProbeEnvironment = {},
): Promise<ParticipantMediaCapabilities> {
  const api = browserApi(environment);
  const videoCodecs = emptyVideoCodecCapabilities();
  const senderCapabilitiesAvailable =
    typeof api.sender?.getCapabilities === "function";
  const receiverCapabilitiesAvailable =
    typeof api.receiver?.getCapabilities === "function";
  let hardwareEncoders = 0;
  for (const codec of VIDEO_CODEC_NAMES) {
    const encodeEntries = codecEntries(api.sender, codec);
    const decodeEntries = codecEntries(api.receiver, codec);
    const [encodeProbe, decodeProbe] = await Promise.all([
      queryDirection(codec, "encode", encodeEntries, api.mediaCapabilities),
      queryDirection(codec, "decode", decodeEntries, api.mediaCapabilities),
    ]);
    videoCodecs[codec] = {
      encode: directionCapability(
        codec,
        encodeEntries,
        encodeProbe.info,
        encodeProbe.error,
        senderCapabilitiesAvailable,
      ),
      decode: directionCapability(
        codec,
        decodeEntries,
        decodeProbe.info,
        decodeProbe.error,
        receiverCapabilitiesAvailable,
      ),
    };
    if (videoCodecs[codec].encode.acceleration === "hardware")
      hardwareEncoders += 1;
  }
  return {
    videoCodecs,
    concurrentEncode: {
      supported: hardwareEncoders > 0,
      ...(hardwareEncoders > 0 ? { maxHardwareSessions: 1 } : {}),
      confidence: "conservative-default",
    },
    source: "browser-probe",
    probeVersion: "video-codec-matrix-v1-browser",
  };
}
