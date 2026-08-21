import {
  emptyCodecDirectionCapability,
  emptyVideoCodecCapabilities,
  type CodecDirectionCapability,
  type ParticipantMediaCapabilities,
  type RealtimeEfficiency,
  type VideoCodecName,
  VIDEO_CODEC_NAMES,
} from "./types/video-codec-capabilities.ts";
import { isExternalRecord } from "./types/boundary.ts";

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
  encodingInfo?: MediaCapabilities["encodingInfo"];
  decodingInfo?: MediaCapabilities["decodingInfo"];
};

type BrowserRtpCapabilitiesApi = {
  getCapabilities?: (kind: "video") => { codecs?: unknown[] } | null;
};

export interface BrowserVideoCodecProbeEnvironment {
  sender?: BrowserRtpCapabilitiesApi | null;
  receiver?: BrowserRtpCapabilitiesApi | null;
  mediaCapabilities?: BrowserMediaCapabilitiesApi | null;
}

const CODEC_MIME_TYPES = {
  H264: ["video/h264"],
  H265: ["video/h265", "video/hevc"],
  VP8: ["video/vp8"],
  VP9: ["video/vp9"],
  AV1: ["video/av1"],
} satisfies Record<VideoCodecName, string[]>;

const DEFAULT_SOFTWARE_EFFICIENCY = {
  H264: "acceptable",
  H265: "poor",
  VP8: "acceptable",
  VP9: "poor",
  AV1: "unusable",
} satisfies Record<VideoCodecName, RealtimeEfficiency>;

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
  const sender = globalThis.RTCRtpSender;
  const receiver = globalThis.RTCRtpReceiver;
  const mediaCapabilities: BrowserMediaCapabilitiesApi | undefined =
    globalThis.navigator?.mediaCapabilities;
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
    if (!isExternalRecord(value)) return false;
    const mimeType = String(value.mimeType || "")
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
  if (!mediaCapabilities) return { info: null, error: null };
  let best: BrowserCapabilityInfo | null = null;
  let error: string | null = null;
  const candidates = entries.length ? entries.slice(0, 4) : [undefined];
  for (const entry of candidates) {
    try {
      const video = {
        contentType: contentType(codec, entry),
        width: PROBE_WIDTH,
        height: PROBE_HEIGHT,
        bitrate: PROBE_BITRATE,
        framerate: PROBE_FPS,
      } satisfies VideoConfiguration;
      const result =
        direction === "encode"
          ? await mediaCapabilities.encodingInfo?.({ type: "webrtc", video })
          : await mediaCapabilities.decodingInfo?.({ type: "webrtc", video });
      if (!result) continue;
      const info: BrowserCapabilityInfo = result;
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
    const unavailable = emptyCodecDirectionCapability();
    if (error) unavailable.failureReason = error;
    return unavailable;
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
  const result: CodecDirectionCapability = {
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
  };
  if (entries[0]?.sdpFmtpLine)
    result.testedProfile = String(entries[0].sdpFmtpLine);
  if (error) result.failureReason = error;
  return result;
}

export async function probeBrowserVideoCodecCapabilities(
  environment: BrowserVideoCodecProbeEnvironment = {},
): Promise<ParticipantMediaCapabilities> {
  const api = browserApi(environment);
  const videoCodecs = emptyVideoCodecCapabilities();
  const senderCapabilitiesAvailable = Boolean(api.sender?.getCapabilities);
  const receiverCapabilitiesAvailable = Boolean(api.receiver?.getCapabilities);
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
  const concurrentEncode: ParticipantMediaCapabilities["concurrentEncode"] = {
    supported: hardwareEncoders > 0,
    confidence: "conservative-default",
  };
  if (hardwareEncoders > 0) concurrentEncode.maxHardwareSessions = 1;
  return {
    videoCodecs,
    concurrentEncode,
    source: "browser-probe",
    probeVersion: "video-codec-matrix-v1-browser",
  };
}
