import {
  isExternalRecord,
  isExternalString,
  type ExternalObject,
  type ExternalValue,
} from "./boundary.ts";

export const VIDEO_CODEC_NAMES = ["H264", "H265", "VP8", "VP9", "AV1"] as const;

export type VideoCodecName = (typeof VIDEO_CODEC_NAMES)[number];

export type CodecAcceleration = "hardware" | "software" | "unsupported";

export type RealtimeEfficiency =
  "excellent" | "good" | "acceptable" | "poor" | "unusable";

export type CodecPowerClass = "low" | "medium" | "high";

export function normalizeVideoCodecName<T>(value: T): VideoCodecName | null {
  if (!isExternalString(value)) return null;
  const raw = value.trim().toUpperCase();
  const suffix = raw.includes("/") ? raw.slice(raw.lastIndexOf("/") + 1) : raw;
  const normalized = suffix.replace(/[.\s-]/g, "");
  if (normalized === "H264") return "H264";
  if (normalized === "H265" || normalized === "HEVC") return "H265";
  if (normalized === "VP8") return "VP8";
  if (normalized === "VP9") return "VP9";
  if (normalized === "AV1") return "AV1";
  return null;
}

export function isVideoCodecName<T>(value: T): value is T & VideoCodecName {
  return isExternalString(value) && normalizeVideoCodecName(value) === value;
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
  testedProfiles?: string[];
  limitsAre?: "maximum-successfully-tested-profile";
  failureReason?: string;
}

export interface VideoCodecCapability {
  encode: CodecDirectionCapability;
  decode: CodecDirectionCapability;
}

export interface VideoCodecCapabilities {
  H264: VideoCodecCapability;
  H265: VideoCodecCapability;
  VP8: VideoCodecCapability;
  VP9: VideoCodecCapability;
  AV1: VideoCodecCapability;
}

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

const EFFICIENCY_RANK = {
  excellent: 5,
  good: 4,
  acceptable: 3,
  poor: 2,
  unusable: 0,
} satisfies Record<RealtimeEfficiency, number>;

const DEFAULT_SOFTWARE_EFFICIENCY = {
  H264: "acceptable",
  H265: "poor",
  VP8: "acceptable",
  VP9: "poor",
  AV1: "unusable",
} satisfies Record<VideoCodecName, RealtimeEfficiency>;

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
  return {
    H264: {
      encode: emptyCodecDirectionCapability(),
      decode: emptyCodecDirectionCapability(),
    },
    H265: {
      encode: emptyCodecDirectionCapability(),
      decode: emptyCodecDirectionCapability(),
    },
    VP8: {
      encode: emptyCodecDirectionCapability(),
      decode: emptyCodecDirectionCapability(),
    },
    VP9: {
      encode: emptyCodecDirectionCapability(),
      decode: emptyCodecDirectionCapability(),
    },
    AV1: {
      encode: emptyCodecDirectionCapability(),
      decode: emptyCodecDirectionCapability(),
    },
  };
}

function normalizeAcceleration<T>(
  value: T,
  supported: boolean,
): CodecAcceleration {
  if (!supported) return "unsupported";
  if (isExternalString(value)) {
    if (value === "hardware") return "hardware";
    if (value === "software") return "software";
  }
  return "software";
}

function normalizeEfficiency<T>(
  value: T,
  supported: boolean,
  acceleration: CodecAcceleration,
  codec: VideoCodecName,
): RealtimeEfficiency {
  if (!supported || acceleration === "unsupported") return "unusable";
  if (isExternalString(value)) {
    if (value === "excellent") return "excellent";
    if (value === "good") return "good";
    if (value === "acceptable") return "acceptable";
    if (value === "poor") return "poor";
    if (value === "unusable") return "unusable";
  }
  return acceleration === "hardware"
    ? "good"
    : DEFAULT_SOFTWARE_EFFICIENCY[codec];
}

export function normalizeCodecDirectionCapability<T>(
  value: T,
  codec: VideoCodecName,
): CodecDirectionCapability {
  const record: Record<string, unknown> = isExternalRecord(value) ? value : {};
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
    if (isExternalString(record[key]) && record[key])
      normalized[key] = record[key];
  if (Array.isArray(record.testedProfiles)) {
    const testedProfiles = record.testedProfiles.filter(
      (profile): profile is string =>
        isExternalString(profile) && profile.length > 0,
    );
    if (testedProfiles.length) normalized.testedProfiles = testedProfiles;
  }
  if (record.limitsAre === "maximum-successfully-tested-profile")
    normalized.limitsAre = record.limitsAre;
  if (
    record.powerClass === "low" ||
    record.powerClass === "medium" ||
    record.powerClass === "high"
  )
    normalized.powerClass = record.powerClass;
  if (record.tested === true) normalized.tested = true;
  return normalized;
}

export function normalizeVideoCodecCapabilities<T>(
  value: T,
): VideoCodecCapabilities {
  const record: Record<string, unknown> = isExternalRecord(value) ? value : {};
  const result = emptyVideoCodecCapabilities();
  for (const codec of VIDEO_CODEC_NAMES) {
    const candidate = record[codec] || record[codec.toLowerCase()];
    const candidateRecord = isExternalRecord(candidate) ? candidate : {};
    result[codec] = {
      encode: normalizeCodecDirectionCapability(candidateRecord.encode, codec),
      decode: normalizeCodecDirectionCapability(candidateRecord.decode, codec),
    };
  }
  return result;
}

function legacyDirectionFromEntry<T>(
  entries: T,
  codec: VideoCodecName,
): CodecDirectionCapability {
  const list = Array.isArray(entries) ? entries : [];
  const matches = list.filter(
    (entry): entry is Record<string, unknown> =>
      isExternalRecord(entry) && normalizeVideoCodecName(entry.codec) === codec,
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

function hasExplicitCodecDirection<T>(
  codecs: T,
  codec: VideoCodecName,
  direction: "encode" | "decode",
) {
  if (!isExternalRecord(codecs)) return false;
  const record = codecs;
  const candidate = record[codec] || record[codec.toLowerCase()];
  return Boolean(
    isExternalRecord(candidate) &&
    Object.prototype.hasOwnProperty.call(candidate, direction),
  );
}

export function normalizeParticipantMediaCapabilities<T>(
  value: T,
): ParticipantMediaCapabilities {
  const record: ExternalObject = isExternalRecord(value) ? value : {};
  const diagnostics: ExternalObject = isExternalRecord(
    record.videoCodecDiagnostics,
  )
    ? record.videoCodecDiagnostics
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
  const concurrentRecord: Record<string, unknown> = isExternalRecord(
    rawConcurrent,
  )
    ? rawConcurrent
    : {};
  const maxHardwareSessions = Number(concurrentRecord.maxHardwareSessions);
  const rawCodecPairs = Array.isArray(concurrentRecord.testedCodecPairs)
    ? concurrentRecord.testedCodecPairs
    : [];
  const testedCodecPairs = rawCodecPairs
    .filter(
      (pair: ExternalValue): pair is [ExternalValue, ExternalValue] =>
        Array.isArray(pair) && pair.length === 2,
    )
    .map((pair) => [
      normalizeVideoCodecName(pair[0]),
      normalizeVideoCodecName(pair[1]),
    ])
    .filter(
      (pair): pair is [VideoCodecName, VideoCodecName] =>
        pair[0] !== null && pair[1] !== null,
    );
  const concurrentEncode: ConcurrentEncodeCapability = {
    supported: concurrentRecord.supported === true,
    confidence:
      concurrentRecord.confidence === "tested" ||
      concurrentRecord.confidence === "conservative-default" ||
      concurrentRecord.confidence === "unknown"
        ? concurrentRecord.confidence
        : "unknown",
  };
  if (Number.isFinite(maxHardwareSessions) && maxHardwareSessions > 0)
    concurrentEncode.maxHardwareSessions = Math.floor(maxHardwareSessions);
  if (testedCodecPairs.length)
    concurrentEncode.testedCodecPairs = testedCodecPairs;

  const result: ParticipantMediaCapabilities = {
    videoCodecs: normalizedCodecs,
    concurrentEncode,
    source:
      record.source === "native-runtime-probe" ||
      record.source === "browser-probe" ||
      record.source === "fallback"
        ? record.source
        : "fallback",
  };
  if (isExternalString(record.probeVersion))
    result.probeVersion = record.probeVersion;
  return result;
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
