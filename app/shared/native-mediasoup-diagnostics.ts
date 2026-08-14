import { buildTopologyGraph } from "./rtc-topology.ts";
import {
  normalizeVideoCodecName,
  type CodecAcceleration,
  type VideoCodecName,
} from "./types/video-codec-capabilities.ts";

type StatsRecord = Record<string, unknown>;

type NativeCodecEntry = {
  kind?: string | null;
  codec?: unknown;
  codecAcceleration?: unknown;
  codecImplementation?: unknown;
  trackId?: string | number | null;
  trackName?: string | number | null;
  source?: string | null;
  consumerId?: string | number | null;
  mid?: string | number | null;
  trackIdentifier?: string | null;
};

function finite(value: unknown) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function toMilliseconds(value: unknown) {
  const number = finite(value);
  if (number == null) return null;
  return Math.abs(number) < 1 ? number * 1000 : number;
}

function asStatObjects(value: unknown): StatsRecord[] {
  if (Array.isArray(value))
    return value.flatMap((candidate) => asStatObjects(candidate));
  if (!value || typeof value !== "object") return [];
  const record = value as StatsRecord;
  if (record.type) return [record];
  if (Array.isArray(record.stats)) return asStatObjects(record.stats);
  if (record.stats && typeof record.stats === "object")
    return asStatObjects(record.stats);
  return Object.values(record).flatMap((candidate) => asStatObjects(candidate));
}

export function nativeStatsObjects(value: unknown) {
  return asStatObjects(value);
}

export function nativeRtpStat(value: unknown, type: string, kind?: string) {
  return asStatObjects(value).find((stat) => {
    if (stat.type !== type || stat.isRemote) return false;
    const statKind = stat.kind || stat.mediaType;
    return !kind || !statKind || statKind === kind;
  });
}

export function nativeRtpStatForTrack(
  value: unknown,
  type: string,
  entry: NativeCodecEntry = {},
) {
  const stats = asStatObjects(value);
  const identifiers = new Set(
    [
      entry.trackId,
      entry.trackName,
      entry.consumerId,
      entry.mid,
      entry.trackIdentifier,
      entry.source,
    ]
      .map((identifier) =>
        identifier == null ? "" : String(identifier).trim(),
      )
      .filter(Boolean),
  );
  const source = String(entry.source || "")
    .trim()
    .toLowerCase();
  if (source) {
    const sourceAliases: Record<string, string[]> = {
      audio: ["microphone_capture_audio"],
      camera: ["camera_capture_video"],
      screen: ["desktop_capture_video"],
      "screen-audio": ["desktop_capture_audio"],
    };
    for (const alias of sourceAliases[source] || []) identifiers.add(alias);
  }
  const byId = new Map(
    stats
      .filter((stat) => stat?.id != null)
      .map((stat) => [String(stat.id), stat]),
  );
  const identityValues = (stat: StatsRecord) => {
    const relatedTrack =
      stat.trackId == null ? null : byId.get(String(stat.trackId));
    const mediaSource =
      stat.mediaSourceId == null ? null : byId.get(String(stat.mediaSourceId));
    return [
      stat.id,
      stat.trackIdentifier,
      stat.trackId,
      stat.mid,
      stat.mediaSourceId,
      relatedTrack?.id,
      relatedTrack?.trackIdentifier,
      mediaSource?.id,
      mediaSource?.trackIdentifier,
    ]
      .map((identifier) =>
        identifier == null ? "" : String(identifier).trim(),
      )
      .filter(Boolean);
  };
  const candidates = stats.filter((stat) => {
    if (stat.type !== type || stat.isRemote) return false;
    const statKind = stat.kind || stat.mediaType;
    return !entry.kind || !statKind || statKind === entry.kind;
  });
  const matching = candidates.find((stat) => {
    return identityValues(stat).some((identifier) =>
      identifiers.has(identifier),
    );
  });
  return matching || (candidates.length === 1 ? candidates[0] : null);
}

function codecStatForRtp(stats: StatsRecord[], rtpStat: StatsRecord | null) {
  const codecId = rtpStat?.codecId;
  if (codecId == null) return null;
  return (
    stats.find(
      (stat) =>
        stat.type === "codec" && String(stat.id || "") === String(codecId),
    ) || null
  );
}

function implementationString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function actualAcceleration(
  implementation: string | null,
  powerEfficient: unknown,
): CodecAcceleration | null {
  const normalized = String(implementation || "").toLowerCase();
  if (
    normalized.includes("libvpx") ||
    normalized.includes("openh264") ||
    normalized.includes("dav1d") ||
    normalized.includes("software") ||
    powerEfficient === false
  )
    return "software";
  if (
    normalized.includes("videotoolbox") ||
    normalized.includes("media foundation") ||
    normalized.includes("mediafoundation") ||
    normalized.includes("nvenc") ||
    normalized.includes("quick sync") ||
    normalized.includes("quicksync") ||
    normalized.includes("vaapi") ||
    normalized.includes("amf") ||
    normalized.includes("hardware") ||
    powerEfficient === true
  )
    return "hardware";
  return null;
}

function nativeCodecMetadata(
  value: unknown,
  type: string,
  entry: NativeCodecEntry,
) {
  const isVideo = String(entry.kind || "") === "video";
  const plannedCodec = isVideo ? normalizeVideoCodecName(entry.codec) : null;
  const plannedCodecAcceleration = isVideo
    ? entry.codecAcceleration === "hardware" ||
      entry.codecAcceleration === "software"
      ? entry.codecAcceleration
      : null
    : null;
  const plannedCodecImplementation = isVideo
    ? implementationString(entry.codecImplementation)
    : null;
  const stats = nativeStatsObjects(value);
  const rtpStat = nativeRtpStatForTrack(value, type, entry);
  const codecStat = codecStatForRtp(stats, rtpStat || null);
  const actualCodec = isVideo
    ? normalizeVideoCodecName(
        codecStat?.mimeType || rtpStat?.mimeType || rtpStat?.codec,
      )
    : null;
  const implementation = isVideo
    ? implementationString(
        type === "outbound-rtp"
          ? rtpStat?.encoderImplementation
          : rtpStat?.decoderImplementation,
      )
    : null;
  const powerEfficient = isVideo
    ? type === "outbound-rtp"
      ? typeof rtpStat?.powerEfficientEncoder === "boolean"
        ? rtpStat.powerEfficientEncoder
        : null
      : typeof rtpStat?.powerEfficientDecoder === "boolean"
        ? rtpStat.powerEfficientDecoder
        : null
    : null;
  const acceleration = actualCodec
    ? actualAcceleration(implementation, powerEfficient)
    : null;
  const hasRtpStat = Boolean(rtpStat);
  const codecSource = actualCodec
    ? "rtp-stats"
    : hasRtpStat
      ? "rtp-stats-unresolved"
      : plannedCodec
        ? "routing-plan"
        : "unknown";
  const codec = actualCodec || (hasRtpStat ? null : plannedCodec);
  return {
    codec,
    codecAcceleration:
      acceleration || (hasRtpStat ? null : plannedCodecAcceleration),
    codecImplementation:
      implementation || (hasRtpStat ? null : plannedCodecImplementation),
    plannedCodec,
    plannedCodecAcceleration,
    plannedCodecImplementation,
    actualCodec,
    actualCodecAcceleration: acceleration,
    actualCodecImplementation: implementation,
    codecSource,
    codecMismatch: Boolean(
      actualCodec && plannedCodec && actualCodec !== plannedCodec,
    ),
    stats: rtpStat || null,
    codecStats: codecStat,
  } as {
    codec: VideoCodecName | null;
    codecAcceleration: CodecAcceleration | null;
    codecImplementation: string | null;
    plannedCodec: VideoCodecName | null;
    plannedCodecAcceleration: CodecAcceleration | null;
    plannedCodecImplementation: string | null;
    actualCodec: VideoCodecName | null;
    actualCodecAcceleration: CodecAcceleration | null;
    actualCodecImplementation: string | null;
    codecSource: string;
    codecMismatch: boolean;
    stats: StatsRecord | null;
    codecStats: StatsRecord | null;
  };
}

export function nativeRtpCodecMetadata(
  value: unknown,
  type: string,
  entry: NativeCodecEntry,
) {
  return nativeCodecMetadata(value, type, entry);
}

function candidateDetails(candidate: StatsRecord | null) {
  if (!candidate) return null;
  return {
    address: candidate.address || candidate.ip || null,
    port: candidate.port ?? null,
    protocol: candidate.protocol || null,
    candidateType: candidate.candidateType || null,
  };
}

function findCandidatePair(stats: StatsRecord[]) {
  const transport = stats.find(
    (stat) => stat.type === "transport" && stat.selectedCandidatePairId,
  );
  return (
    (transport &&
      stats.find((stat) => stat.id === transport.selectedCandidatePairId)) ||
    stats.find(
      (stat) =>
        stat.type === "candidate-pair" &&
        (stat.state === "succeeded" || stat.nominated === true),
    ) ||
    stats.find((stat) => stat.type === "candidate-pair") ||
    null
  );
}

function findCandidate(stats: StatsRecord[], id: unknown) {
  if (!id) return null;
  return stats.find((stat) => stat.id === id) || null;
}

function normalizeCandidatePair(
  pair: StatsRecord | null,
  stats: StatsRecord[],
) {
  if (!pair) return null;
  const local = findCandidate(stats, pair.localCandidateId);
  const remote = findCandidate(stats, pair.remoteCandidateId);
  return {
    currentRoundTripTime: finite(pair.currentRoundTripTime),
    availableOutgoingBitrate: finite(pair.availableOutgoingBitrate),
    availableIncomingBitrate: finite(pair.availableIncomingBitrate),
    totalRoundTripTime: finite(pair.totalRoundTripTime),
    responsesReceived: finite(pair.responsesReceived),
    requestsSent: finite(pair.requestsSent),
    consentRequestsSent: finite(pair.consentRequestsSent),
    bytesSent: finite(pair.bytesSent),
    bytesReceived: finite(pair.bytesReceived),
    packetsSent: finite(pair.packetsSent),
    packetsReceived: finite(pair.packetsReceived),
    packetLoss: finite(pair.packetLoss),
    local: candidateDetails(
      local || (pair.local as StatsRecord | null | undefined) || null,
    ),
    remote: candidateDetails(
      remote || (pair.remote as StatsRecord | null | undefined) || null,
    ),
  };
}

function averageJitterDelay(value: unknown, emitted: number | null) {
  return emitted != null && emitted > 0 && finite(value) != null
    ? (Number(value) * 1000) / emitted
    : null;
}

export function normalizeNativeTransportStats(
  value: unknown,
  kind: string,
  transportState = "unknown",
) {
  const stats = asStatObjects(value);
  const pair = findCandidatePair(stats);
  const inboundAudioStat = stats.find(
    (stat) =>
      stat.type === "inbound-rtp" &&
      !stat.isRemote &&
      (stat.kind === "audio" || stat.mediaType === "audio"),
  );
  const outboundAudioStat = stats.find(
    (stat) =>
      stat.type === "outbound-rtp" &&
      !stat.isRemote &&
      (stat.kind === "audio" || stat.mediaType === "audio"),
  );
  const remoteInboundAudioStat = stats.find(
    (stat) =>
      stat.type === "remote-inbound-rtp" &&
      (stat.kind === "audio" || stat.mediaType === "audio"),
  );
  const inboundAudio = inboundAudioStat
    ? {
        packetsReceived: finite(inboundAudioStat.packetsReceived),
        packetsLost: finite(inboundAudioStat.packetsLost),
        bytesReceived: finite(inboundAudioStat.bytesReceived),
        jitter: toMilliseconds(inboundAudioStat.jitter),
        averageJitterBufferDelayMs: averageJitterDelay(
          inboundAudioStat.jitterBufferDelay,
          finite(inboundAudioStat.jitterBufferEmittedCount),
        ),
        averageJitterBufferTargetDelayMs: averageJitterDelay(
          inboundAudioStat.jitterBufferTargetDelay,
          finite(inboundAudioStat.jitterBufferEmittedCount),
        ),
        averageJitterBufferMinimumDelayMs: averageJitterDelay(
          inboundAudioStat.jitterBufferMinimumDelay,
          finite(inboundAudioStat.jitterBufferEmittedCount),
        ),
      }
    : null;
  const outboundAudio = outboundAudioStat
    ? {
        packetsSent: finite(outboundAudioStat.packetsSent),
        bytesSent: finite(outboundAudioStat.bytesSent),
        targetBitrate: finite(outboundAudioStat.targetBitrate),
      }
    : null;
  const remoteInboundAudio = remoteInboundAudioStat
    ? {
        roundTripTime: toMilliseconds(remoteInboundAudioStat.roundTripTime),
        fractionLost: finite(remoteInboundAudioStat.fractionLost),
        packetsLost: finite(remoteInboundAudioStat.packetsLost),
        jitter: toMilliseconds(remoteInboundAudioStat.jitter),
      }
    : null;
  const normalizedPair = normalizeCandidatePair(pair, stats);
  const pairRttMs = toMilliseconds(normalizedPair?.currentRoundTripTime);
  return {
    id: kind,
    kind,
    pcStates: {
      connectionState: transportState,
      iceConnectionState: transportState,
      signalingState: "unknown",
    },
    candidatePair: normalizedPair,
    rttMs: pairRttMs,
    jitterMs: inboundAudio?.jitter ?? null,
    packetLossPercent:
      inboundAudio &&
      Number(inboundAudio.packetsReceived) + Number(inboundAudio.packetsLost) >
        0
        ? (Number(inboundAudio.packetsLost) * 100) /
          (Number(inboundAudio.packetsReceived) +
            Number(inboundAudio.packetsLost))
        : null,
    availableOutgoingBitrate: finite(normalizedPair?.availableOutgoingBitrate),
    availableIncomingBitrate: finite(normalizedPair?.availableIncomingBitrate),
    candidateType: normalizedPair?.local?.candidateType || null,
    protocol: normalizedPair?.local?.protocol || null,
    inboundAudio,
    outboundAudio,
    remoteInboundAudio,
    stats,
    raw: value,
  };
}

export function normalizeNativeStatsSnapshot(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object") return snapshot;
  const record = snapshot as StatsRecord;
  const transports = Array.isArray(record.transports)
    ? record.transports.map((transport) =>
        transport?.stats || transport?.raw
          ? normalizeNativeTransportStats(
              transport.raw ?? transport.stats,
              transport.id || transport.kind || "media",
              transport.pcStates?.connectionState || "unknown",
            )
          : transport,
      )
    : [];
  return { ...record, transports };
}

function asRecord(value: unknown): StatsRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as StatsRecord)
    : null;
}

function milliseconds(value: unknown) {
  const number = finite(value);
  return number == null ? null : Math.abs(number) < 1 ? number * 1000 : number;
}

function transportState(transport: StatsRecord) {
  const states = asRecord(transport.pcStates);
  const connectionState = String(states?.connectionState || "");
  if (connectionState === "failed" || connectionState === "closed")
    return "failed";
  if (connectionState === "connected" || connectionState === "completed")
    return "active";
  return "probing";
}

function edgeDetails(transport: StatsRecord) {
  const pair = asRecord(transport.candidatePair);
  const local = asRecord(pair?.local);
  const remote = asRecord(pair?.remote);
  return {
    state: transportState(transport),
    rtt:
      finite(transport.rttMs) ??
      milliseconds(pair?.currentRoundTripTime) ??
      null,
    network: transport.protocol || local?.protocol || remote?.protocol || null,
    candidateType: transport.candidateType || local?.candidateType || null,
    bitrate:
      finite(transport.availableOutgoingBitrate) ??
      finite(pair?.availableOutgoingBitrate) ??
      null,
    packetLoss:
      finite(transport.packetLossPercent) ??
      finite(transport.packetLoss) ??
      finite(pair?.packetLoss) ??
      null,
  };
}

function p2pPeerId(transport: StatsRecord) {
  const routeId = String(transport.peerOrProvider || transport.routeId || "");
  if (routeId.startsWith("p2p:")) return routeId.slice(4);
  if (transport.kind === "p2p") return routeId;
  const id = String(transport.id || "");
  return id.startsWith("p2p:") ? id.slice(4) : "";
}

export function buildNativeTopologyGraph({
  topology = {},
  provider,
  localPeerId: fallbackLocalPeerId = null,
  transports = [],
}: {
  topology?: StatsRecord | null;
  provider: string;
  localPeerId?: string | null;
  transports?: unknown;
}) {
  const topologyRecord = topology || {};
  const localPeerId = String(
    topologyRecord.localPeerId || fallbackLocalPeerId || "",
  );
  const participantIds = Array.isArray(topologyRecord.peers)
    ? topologyRecord.peers
        .map(asRecord)
        .filter((peer): peer is StatsRecord => Boolean(peer))
        .map((peer) => String(peer.peerId || ""))
        .filter(Boolean)
    : [];
  if (localPeerId && !participantIds.includes(localPeerId))
    participantIds.unshift(localPeerId);

  const edgeDetailsByPeer: Record<string, Record<string, unknown>> = {};
  const nativeTransports = Array.isArray(transports)
    ? transports
        .map(asRecord)
        .filter((entry): entry is StatsRecord => Boolean(entry))
    : [];
  let candidatePair: StatsRecord | null = null;
  let sfuEdge: Record<string, unknown> | null = null;
  for (const transport of nativeTransports) {
    const peerId = p2pPeerId(transport);
    if (peerId) {
      if (localPeerId && !participantIds.includes(peerId))
        participantIds.push(peerId);
      if (localPeerId) {
        const key = [localPeerId, peerId].sort().join(":");
        edgeDetailsByPeer[key] = edgeDetails(transport);
      }
      continue;
    }
    const pair = asRecord(transport.candidatePair);
    if (!candidatePair && pair) candidatePair = pair;
    if (!sfuEdge || transport.id === "send" || transport.kind === "send")
      sfuEdge = edgeDetails(transport);
  }

  const mode = String(
    topologyRecord.mode || (provider === "p2p" ? "p2p" : "sfu"),
  );
  const topologyCandidatePair = candidatePair
    ? {
        remote: {
          address:
            asRecord(candidatePair.remote)?.address == null
              ? null
              : String(asRecord(candidatePair.remote)?.address),
        },
      }
    : undefined;
  return buildTopologyGraph({
    mode,
    currentMode: provider,
    target: String(topologyRecord.target || "") || undefined,
    epoch: Number(topologyRecord.epoch) || 0,
    reason:
      topologyRecord.reason == null ? null : String(topologyRecord.reason),
    activatedAt:
      topologyRecord.activatedAt == null
        ? null
        : String(topologyRecord.activatedAt),
    participantIds,
    localPeerId,
    edgeDetails: edgeDetailsByPeer,
    candidatePair: topologyCandidatePair,
    sfuEdge: sfuEdge || undefined,
    healthy: nativeTransports.every(
      (transport) => transportState(transport) !== "failed",
    ),
  });
}

export function nativeFlowing(value: unknown, type: string) {
  const stat = nativeRtpStat(value, type);
  if (!stat) return null;
  return {
    bytes:
      type === "outbound-rtp"
        ? finite(stat.bytesSent)
        : finite(stat.bytesReceived),
    timestamp: finite(stat.timestamp),
  };
}
