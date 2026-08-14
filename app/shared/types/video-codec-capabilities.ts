export const VIDEO_CODEC_NAMES = ["H264", "H265", "VP8", "VP9", "AV1"] as const;

export type VideoCodecName = (typeof VIDEO_CODEC_NAMES)[number];

export type CodecAcceleration = "hardware" | "software" | "unsupported";

export type RealtimeEfficiency =
  "excellent" | "good" | "acceptable" | "poor" | "unusable";

export type CodecPowerClass = "low" | "medium" | "high";

export function normalizeVideoCodecName(value: unknown): VideoCodecName | null {
  const raw = String(value || "")
    .trim()
    .toUpperCase();
  const suffix = raw.includes("/") ? raw.slice(raw.lastIndexOf("/") + 1) : raw;
  const normalized = suffix.replace(/[.\s-]/g, "");
  if (normalized === "H264") return "H264";
  if (normalized === "H265" || normalized === "HEVC") return "H265";
  if (normalized === "VP8") return "VP8";
  if (normalized === "VP9") return "VP9";
  if (normalized === "AV1") return "AV1";
  return null;
}

export function isVideoCodecName(value: unknown): value is VideoCodecName {
  return normalizeVideoCodecName(value) !== null;
}

export interface CodecDirectionCapability {
  supported: boolean;
  acceleration: CodecAcceleration;
  implementation?: string;
  realtimeEfficiency: RealtimeEfficiency;
  maxWidth?: number;
  maxHeight?: number;
  maxFps?: number;
  powerClass?: CodecPowerClass;
  tested?: boolean;
  testedProfile?: string;
  failureReason?: string;
}

export interface VideoCodecCapability {
  encode: CodecDirectionCapability;
  decode: CodecDirectionCapability;
}

export type VideoCodecCapabilities = Record<
  VideoCodecName,
  VideoCodecCapability
>;

export interface ConcurrentEncodeCapability {
  supported: boolean;
  maxHardwareSessions?: number;
  testedCodecPairs?: Array<[VideoCodecName, VideoCodecName]>;
  confidence?: "tested" | "conservative-default" | "unknown";
}

export interface ParticipantMediaCapabilities {
  videoCodecs: VideoCodecCapabilities;
  concurrentEncode: ConcurrentEncodeCapability;
  source?: "native-runtime-probe" | "browser-probe" | "fallback";
  probeVersion?: string;
}

const EFFICIENCY_RANK: Record<RealtimeEfficiency, number> = {
  excellent: 5,
  good: 4,
  acceptable: 3,
  poor: 2,
  unusable: 0,
};

const DEFAULT_SOFTWARE_EFFICIENCY: Record<VideoCodecName, RealtimeEfficiency> =
  {
    H264: "acceptable",
    H265: "poor",
    VP8: "acceptable",
    VP9: "poor",
    AV1: "unusable",
  };

export function efficiencyRank(value: RealtimeEfficiency) {
  return EFFICIENCY_RANK[value] || 0;
}

export function isRealtimeEfficient(
  capability: CodecDirectionCapability | null | undefined,
) {
  return Boolean(
    capability?.supported && efficiencyRank(capability.realtimeEfficiency) >= 3,
  );
}

export function isEmergencyUsable(
  capability: CodecDirectionCapability | null | undefined,
) {
  return Boolean(
    capability?.supported && capability.realtimeEfficiency !== "unusable",
  );
}

export function emptyCodecDirectionCapability(): CodecDirectionCapability {
  return {
    supported: false,
    acceleration: "unsupported",
    realtimeEfficiency: "unusable",
  };
}

export function emptyVideoCodecCapabilities(): VideoCodecCapabilities {
  return Object.fromEntries(
    VIDEO_CODEC_NAMES.map((codec) => [
      codec,
      {
        encode: emptyCodecDirectionCapability(),
        decode: emptyCodecDirectionCapability(),
      },
    ]),
  ) as VideoCodecCapabilities;
}

function normalizeAcceleration(
  value: unknown,
  supported: boolean,
): CodecAcceleration {
  if (!supported) return "unsupported";
  return value === "hardware" || value === "software" ? value : "software";
}

function normalizeEfficiency(
  value: unknown,
  supported: boolean,
  acceleration: CodecAcceleration,
  codec: VideoCodecName,
): RealtimeEfficiency {
  if (!supported || acceleration === "unsupported") return "unusable";
  if (
    value === "excellent" ||
    value === "good" ||
    value === "acceptable" ||
    value === "poor" ||
    value === "unusable"
  )
    return value;
  return acceleration === "hardware"
    ? "good"
    : DEFAULT_SOFTWARE_EFFICIENCY[codec];
}

export function normalizeCodecDirectionCapability(
  value: unknown,
  codec: VideoCodecName,
): CodecDirectionCapability {
  const source = value && typeof value === "object" ? value : {};
  const record = source as Record<string, unknown>;
  const supported = record.supported === true;
  const acceleration = normalizeAcceleration(record.acceleration, supported);
  const normalized: CodecDirectionCapability = {
    supported,
    acceleration,
    realtimeEfficiency: normalizeEfficiency(
      record.realtimeEfficiency,
      supported,
      acceleration,
      codec,
    ),
  };
  for (const key of ["maxWidth", "maxHeight", "maxFps"] as const) {
    const number = Number(record[key]);
    if (Number.isFinite(number) && number > 0)
      normalized[key] = Math.floor(number);
  }
  for (const key of [
    "implementation",
    "testedProfile",
    "failureReason",
  ] as const)
    if (typeof record[key] === "string" && record[key])
      normalized[key] = record[key];
  if (
    record.powerClass === "low" ||
    record.powerClass === "medium" ||
    record.powerClass === "high"
  )
    normalized.powerClass = record.powerClass;
  if (record.tested === true) normalized.tested = true;
  return normalized;
}

export function normalizeVideoCodecCapabilities(
  value: unknown,
): VideoCodecCapabilities {
  const source = value && typeof value === "object" ? value : {};
  const record = source as Record<string, unknown>;
  const result = emptyVideoCodecCapabilities();
  for (const codec of VIDEO_CODEC_NAMES) {
    const candidate = record[codec] || record[codec.toLowerCase()];
    const candidateRecord =
      candidate && typeof candidate === "object"
        ? (candidate as Record<string, unknown>)
        : {};
    result[codec] = {
      encode: normalizeCodecDirectionCapability(candidateRecord.encode, codec),
      decode: normalizeCodecDirectionCapability(candidateRecord.decode, codec),
    };
  }
  return result;
}

function legacyDirectionFromEntry(
  entries: unknown,
  codec: VideoCodecName,
): CodecDirectionCapability {
  const list = Array.isArray(entries) ? entries : [];
  const matches = list.filter(
    (entry): entry is Record<string, unknown> =>
      Boolean(entry) &&
      typeof entry === "object" &&
      normalizeVideoCodecName(entry.codec) === codec,
  );
  const hardware = matches.find((entry) => entry.hardware === true);
  const selected = hardware || matches[0];
  if (!selected) return emptyCodecDirectionCapability();
  const supported = selected.supported !== false;
  const acceleration = selected.hardware === true ? "hardware" : "software";
  return normalizeCodecDirectionCapability(
    {
      supported,
      acceleration,
      implementation: selected.implementation,
      realtimeEfficiency:
        selected.realtimeEfficiency ||
        (acceleration === "hardware"
          ? "good"
          : DEFAULT_SOFTWARE_EFFICIENCY[codec]),
      tested: selected.tested === true,
    },
    codec,
  );
}

function hasExplicitCodecDirection(
  codecs: unknown,
  codec: VideoCodecName,
  direction: "encode" | "decode",
) {
  if (!codecs || typeof codecs !== "object") return false;
  const record = codecs as Record<string, unknown>;
  const candidate = record[codec] || record[codec.toLowerCase()];
  return Boolean(
    candidate &&
    typeof candidate === "object" &&
    Object.prototype.hasOwnProperty.call(candidate, direction),
  );
}

export function normalizeParticipantMediaCapabilities(
  value: unknown,
): ParticipantMediaCapabilities {
  const source = value && typeof value === "object" ? value : {};
  const record = source as Record<string, unknown>;
  const diagnostics =
    record.videoCodecDiagnostics &&
    typeof record.videoCodecDiagnostics === "object"
      ? (record.videoCodecDiagnostics as Record<string, unknown>)
      : record;
  const rawCodecs =
    record.videoCodecs ||
    record.videoCodecCapabilities ||
    diagnostics.videoCodecs ||
    diagnostics.capabilities;
  const normalizedCodecs = normalizeVideoCodecCapabilities(rawCodecs);
  const encoders = diagnostics.encoders;
  const decoders = diagnostics.decoders;
  for (const codec of VIDEO_CODEC_NAMES) {
    if (
      !normalizedCodecs[codec].encode.supported &&
      !hasExplicitCodecDirection(rawCodecs, codec, "encode")
    )
      normalizedCodecs[codec].encode = legacyDirectionFromEntry(
        encoders,
        codec,
      );
    if (
      !normalizedCodecs[codec].decode.supported &&
      !hasExplicitCodecDirection(rawCodecs, codec, "decode")
    )
      normalizedCodecs[codec].decode = legacyDirectionFromEntry(
        decoders,
        codec,
      );
  }
  const rawConcurrent =
    record.concurrentEncode || diagnostics.concurrentEncode || {};
  const concurrentRecord =
    rawConcurrent && typeof rawConcurrent === "object"
      ? (rawConcurrent as Record<string, unknown>)
      : {};
  const maxHardwareSessions = Number(concurrentRecord.maxHardwareSessions);
  const testedCodecPairs = Array.isArray(concurrentRecord.testedCodecPairs)
    ? concurrentRecord.testedCodecPairs
        .filter(
          (pair): pair is unknown[] => Array.isArray(pair) && pair.length === 2,
        )
        .map((pair) => [
          normalizeVideoCodecName(pair[0]),
          normalizeVideoCodecName(pair[1]),
        ])
        .filter(
          (pair): pair is [VideoCodecName, VideoCodecName] =>
            pair[0] !== null && pair[1] !== null,
        )
    : [];
  return {
    videoCodecs: normalizedCodecs,
    concurrentEncode: {
      supported: concurrentRecord.supported === true,
      ...(Number.isFinite(maxHardwareSessions) && maxHardwareSessions > 0
        ? { maxHardwareSessions: Math.floor(maxHardwareSessions) }
        : {}),
      ...(testedCodecPairs.length ? { testedCodecPairs } : {}),
      confidence:
        concurrentRecord.confidence === "tested" ||
        concurrentRecord.confidence === "conservative-default" ||
        concurrentRecord.confidence === "unknown"
          ? concurrentRecord.confidence
          : "unknown",
    },
    source:
      record.source === "native-runtime-probe" ||
      record.source === "browser-probe" ||
      record.source === "fallback"
        ? record.source
        : "fallback",
    ...(typeof record.probeVersion === "string"
      ? { probeVersion: record.probeVersion }
      : {}),
  };
}

export function efficientEncodeCodecs(
  capabilities: ParticipantMediaCapabilities,
): VideoCodecName[] {
  return VIDEO_CODEC_NAMES.filter((codec) =>
    isRealtimeEfficient(capabilities.videoCodecs[codec].encode),
  );
}

export function efficientDecodeCodecs(
  capabilities: ParticipantMediaCapabilities,
): VideoCodecName[] {
  return VIDEO_CODEC_NAMES.filter((codec) =>
    isRealtimeEfficient(capabilities.videoCodecs[codec].decode),
  );
}

export function maxConcurrentHardwareEncodeSessions(
  capabilities: ParticipantMediaCapabilities,
) {
  const hasHardwareEncoder = VIDEO_CODEC_NAMES.some(
    (codec) =>
      capabilities.videoCodecs[codec].encode.acceleration === "hardware",
  );
  if (!hasHardwareEncoder) return 0;
  const reported = Number(capabilities.concurrentEncode.maxHardwareSessions);
  if (Number.isFinite(reported) && reported > 0)
    return Math.max(1, Math.floor(reported));
  return 1;
}

export function emergencyEncodeCodecs(
  capabilities: ParticipantMediaCapabilities,
): VideoCodecName[] {
  return VIDEO_CODEC_NAMES.filter((codec) =>
    isEmergencyUsable(capabilities.videoCodecs[codec].encode),
  );
}

export function emergencyDecodeCodecs(
  capabilities: ParticipantMediaCapabilities,
): VideoCodecName[] {
  return VIDEO_CODEC_NAMES.filter((codec) =>
    isEmergencyUsable(capabilities.videoCodecs[codec].decode),
  );
}
