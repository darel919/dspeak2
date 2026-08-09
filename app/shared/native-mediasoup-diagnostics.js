function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function toMilliseconds(value) {
  const number = finite(value);
  if (number == null) return null;
  return Math.abs(number) < 1 ? number * 1000 : number;
}

function asStatObjects(value) {
  if (Array.isArray(value))
    return value.flatMap((candidate) => asStatObjects(candidate));
  if (!value || typeof value !== "object") return [];
  if (value.type) return [value];
  if (Array.isArray(value.stats)) return asStatObjects(value.stats);
  if (value.stats && typeof value.stats === "object")
    return asStatObjects(value.stats);
  return Object.values(value).flatMap((candidate) => asStatObjects(candidate));
}

export function nativeStatsObjects(value) {
  return asStatObjects(value);
}

export function nativeRtpStat(value, type, kind) {
  return asStatObjects(value).find((stat) => {
    if (stat.type !== type || stat.isRemote) return false;
    const statKind = stat.kind || stat.mediaType;
    return !kind || !statKind || statKind === kind;
  });
}

export function nativeRtpStatForTrack(value, type, entry = {}) {
  const identifiers = [entry.trackId, entry.mid, entry.trackIdentifier]
    .map((identifier) => String(identifier || ""))
    .filter(Boolean);
  const matching = asStatObjects(value).find((stat) => {
    if (stat.type !== type || stat.isRemote) return false;
    const identifier = String(
      stat.trackIdentifier || stat.trackId || stat.mid || "",
    );
    const statKind = stat.kind || stat.mediaType;
    return (
      identifiers.includes(identifier) &&
      (!entry.kind || !statKind || statKind === entry.kind)
    );
  });
  return matching || nativeRtpStat(value, type, entry.kind);
}

function candidateDetails(candidate) {
  if (!candidate) return null;
  return {
    address: candidate.address || candidate.ip || null,
    port: candidate.port ?? null,
    protocol: candidate.protocol || null,
    candidateType: candidate.candidateType || null,
  };
}

function findCandidatePair(stats) {
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

function findCandidate(stats, id) {
  if (!id) return null;
  return stats.find((stat) => stat.id === id) || null;
}

function normalizeCandidatePair(pair, stats) {
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
    local: candidateDetails(local || pair.local),
    remote: candidateDetails(remote || pair.remote),
  };
}

function averageJitterDelay(value, emitted) {
  return emitted > 0 && finite(value) != null
    ? (Number(value) * 1000) / emitted
    : null;
}

export function normalizeNativeTransportStats(
  value,
  kind,
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

export function normalizeNativeStatsSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return snapshot;
  const transports = Array.isArray(snapshot.transports)
    ? snapshot.transports.map((transport) =>
        transport?.stats || transport?.raw
          ? normalizeNativeTransportStats(
              transport.raw ?? transport.stats,
              transport.id || transport.kind || "media",
              transport.pcStates?.connectionState || "unknown",
            )
          : transport,
      )
    : [];
  return { ...snapshot, transports };
}

export function nativeFlowing(value, type) {
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
