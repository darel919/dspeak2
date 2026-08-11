type StatsRecord = Record<string, unknown>;

function finite(value: unknown) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function reportValues(report: unknown): StatsRecord[] {
  if (!report) return [];
  if (
    report &&
    typeof report === "object" &&
    "values" in report &&
    typeof report.values === "function"
  )
    return [...(report.values as () => Iterable<StatsRecord>)()];
  if (Array.isArray(report)) return report.filter(isStatsRecord);
  if (typeof report === "object")
    return Object.values(report).filter(isStatsRecord);
  return [];
}

function isStatsRecord(value: unknown): value is StatsRecord {
  return value !== null && typeof value === "object";
}

export function findRtpStat(
  report: unknown,
  type: string,
  {
    trackId,
    mid,
    kind,
  }: { trackId?: string; mid?: string | null; kind?: string } = {},
) {
  const values = reportValues(report);
  const candidates = values.filter((stat) => {
    if (stat?.type !== type || stat.isRemote) return false;
    const statKind = stat.kind || stat.mediaType;
    return !kind || !statKind || statKind === kind;
  });
  if (!candidates.length) return null;
  const identifiers = new Set(
    [trackId, mid].map((value) => String(value || "")).filter(Boolean),
  );
  if (identifiers.size) {
    const byId = new Map(
      values
        .filter((stat) => stat?.id != null)
        .map((stat) => [String(stat.id), stat]),
    );
    const match = candidates.find((stat) => {
      const related =
        stat.trackId == null ? null : byId.get(String(stat.trackId));
      return [
        stat.trackIdentifier,
        stat.trackId,
        stat.mid,
        related?.trackIdentifier,
      ].some((value) => identifiers.has(String(value || "")));
    });
    if (match) return match;
  }
  return candidates.length === 1 ? candidates[0] : null;
}

function deltaRate(
  current: number | null,
  previous: number | null,
  elapsedMs: number | null,
  multiplier = 1,
) {
  if (
    current == null ||
    previous == null ||
    !elapsedMs ||
    elapsedMs <= 0 ||
    current < previous
  )
    return null;
  return ((current - previous) * multiplier * 1000) / elapsedMs;
}

export function calculateTransportBitrateBps(
  bytes: unknown,
  timestamp: unknown,
  previous: { bytes?: unknown; timestamp?: unknown } | null = null,
) {
  const currentBytes = finite(bytes);
  const currentTimestamp = finite(timestamp);
  const previousBytes = finite(previous?.bytes);
  const previousTimestamp = finite(previous?.timestamp);
  if (currentTimestamp == null || previousTimestamp == null) return null;
  return deltaRate(
    currentBytes,
    previousBytes,
    currentTimestamp - previousTimestamp,
    8,
  );
}

export function collectRtpStats(
  report: unknown,
  direction: string,
  trackSettings: MediaTrackSettings | Record<string, unknown> = {},
  previous: unknown = null,
  expectedKind: string | null = null,
) {
  const type = direction === "outbound" ? "outbound-rtp" : "inbound-rtp";
  const values = reportValues(report);
  const rtp = findRtpStat(report, type, { kind: expectedKind });
  if (!rtp) return { stats: null, sample: previous };

  const codec = values.find((stat) => stat.id === rtp.codecId);
  const kind = rtp.kind || rtp.mediaType || expectedKind || null;
  const timestamp = finite(rtp.timestamp) ?? Date.now();
  const frameCounter = finite(
    direction === "outbound" ? rtp.framesEncoded : rtp.framesDecoded,
  );
  const bytes = finite(
    direction === "outbound" ? rtp.bytesSent : rtp.bytesReceived,
  );
  const elapsedMs =
    previous?.timestamp == null ? null : timestamp - previous.timestamp;
  const calculatedFps = deltaRate(
    frameCounter,
    previous?.frameCounter,
    elapsedMs,
  );
  const bitrateKbps = deltaRate(bytes, previous?.bytes, elapsedMs, 8 / 1000);
  const totalCodecTime = finite(
    direction === "outbound" ? rtp.totalEncodeTime : rtp.totalDecodeTime,
  );
  const codecFrames =
    frameCounter == null || previous?.frameCounter == null
      ? null
      : frameCounter - previous.frameCounter;
  const codecTime =
    totalCodecTime == null || previous?.totalCodecTime == null
      ? null
      : totalCodecTime - previous.totalCodecTime;
  const frameTimeMs =
    codecFrames > 0 && codecTime >= 0 ? (codecTime * 1000) / codecFrames : null;

  const common = {
    kind,
    width:
      finite(direction === "outbound" ? rtp.frameWidth : rtp.frameWidth) ??
      finite(trackSettings.width),
    height:
      finite(direction === "outbound" ? rtp.frameHeight : rtp.frameHeight) ??
      finite(trackSettings.height),
    fps:
      finite(rtp.framesPerSecond) ??
      calculatedFps ??
      finite(trackSettings.frameRate),
    bitrateKbps,
    codec: codec?.mimeType || null,
  };
  const stats =
    direction === "outbound"
      ? {
          ...common,
          targetBitrateKbps:
            finite(rtp.targetBitrate) == null
              ? null
              : finite(rtp.targetBitrate) / 1000,
          framesEncoded: frameCounter,
          frameTimeMs,
          qualityLimitationReason: rtp.qualityLimitationReason || null,
          encoderImplementation: rtp.encoderImplementation || null,
          powerEfficientEncoder: rtp.powerEfficientEncoder ?? null,
          packetsSent: finite(rtp.packetsSent),
          bytesSent: bytes,
          pliCount: finite(rtp.pliCount),
          firCount: finite(rtp.firCount),
          nackCount: finite(rtp.nackCount),
          ssrc: finite(rtp.ssrc),
          framesSent: finite(rtp.framesSent),
          keyFramesEncoded: finite(rtp.keyFramesEncoded),
          totalEncodeTime: totalCodecTime,
          totalPacketSendDelay: finite(rtp.totalPacketSendDelay),
          retransmittedPacketsSent: finite(rtp.retransmittedPacketsSent),
          retransmittedBytesSent: finite(rtp.retransmittedBytesSent),
          qpSum: finite(rtp.qpSum),
          qualityLimitationDurations: rtp.qualityLimitationDurations || null,
          audioLevel: finite(rtp.audioLevel),
          totalAudioEnergy: finite(rtp.totalAudioEnergy),
          totalSamplesDuration: finite(rtp.totalSamplesDuration),
        }
      : {
          ...common,
          receivedFps: calculatedFps ?? finite(rtp.framesPerSecond),
          decodedFps: calculatedFps ?? finite(rtp.framesPerSecond),
          decodeTimeMs: frameTimeMs,
          decoderImplementation: rtp.decoderImplementation || null,
          powerEfficientDecoder: rtp.powerEfficientDecoder ?? null,
          framesReceived: finite(rtp.framesReceived),
          framesDecoded: frameCounter,
          framesDropped: finite(rtp.framesDropped),
          packetsReceived: finite(rtp.packetsReceived),
          packetsLost: finite(rtp.packetsLost),
          bytesReceived: bytes,
          jitter: finite(rtp.jitter),
          freezeCount: finite(rtp.freezeCount),
          totalFreezesDuration: finite(rtp.totalFreezesDuration),
          pliCount: finite(rtp.pliCount),
          firCount: finite(rtp.firCount),
          nackCount: finite(rtp.nackCount),
          ssrc: finite(rtp.ssrc),
          keyFramesDecoded: finite(rtp.keyFramesDecoded),
          totalDecodeTime: totalCodecTime,
          totalInterFrameDelay: finite(rtp.totalInterFrameDelay),
          jitterBufferDelay: finite(rtp.jitterBufferDelay),
          jitterBufferEmittedCount: finite(rtp.jitterBufferEmittedCount),
          audioLevel: finite(rtp.audioLevel),
          totalAudioEnergy: finite(rtp.totalAudioEnergy),
          totalSamplesDuration: finite(rtp.totalSamplesDuration),
          totalSamplesReceived: finite(rtp.totalSamplesReceived),
          concealedSamples: finite(rtp.concealedSamples),
          silentConcealedSamples: finite(rtp.silentConcealedSamples),
        };

  return { stats, sample: { timestamp, frameCounter, bytes, totalCodecTime } };
}

export function collectVideoRtpStats(
  report,
  direction,
  trackSettings = {} as any,
  previous = null,
) {
  return collectRtpStats(report, direction, trackSettings, previous, "video");
}

export function collectOutboundAudioStats(report, previous = null) {
  const values = report ? [...report.values()] : [];
  const rtp = values.find(
    (stat) =>
      stat.type === "outbound-rtp" &&
      !stat.isRemote &&
      (stat.kind === "audio" || stat.mediaType === "audio"),
  );
  if (!rtp) return { stats: null, sample: previous };
  const timestamp = finite(rtp.timestamp) ?? Date.now();
  const bytes = finite(rtp.bytesSent);
  const elapsedMs =
    previous?.timestamp == null ? null : timestamp - previous.timestamp;
  return {
    stats: {
      bitrateKbps: deltaRate(bytes, previous?.bytes, elapsedMs, 8 / 1000),
      audioLevel: finite(rtp.audioLevel),
    },
    sample: { timestamp, bytes },
  };
}

export async function collectPeerConnectionStats(pc, kind) {
  const report = await pc.getStats();
  const byId = new Map();
  report.forEach((stat) => byId.set(stat.id, stat));
  const transport = [...byId.values()].find(
    (stat) => stat.type === "transport" && stat.selectedCandidatePairId,
  );
  const pair =
    (transport ? byId.get(transport.selectedCandidatePairId) : null) ||
    [...byId.values()].find(
      (stat) =>
        stat.type === "candidate-pair" &&
        stat.state === "succeeded" &&
        stat.nominated,
    ) ||
    null;
  const local = pair ? byId.get(pair.localCandidateId) : null;
  const remote = pair ? byId.get(pair.remoteCandidateId) : null;
  let packetsLost = 0;
  let packetsReceived = 0;
  let outboundPacketsSent = 0;
  const remoteLossFractions = [] as any;
  let inboundAudio = null;
  let outboundAudio = null;
  let remoteInboundAudio = null;

  for (const stat of byId.values()) {
    const mediaKind = stat.kind || stat.mediaType;
    if (stat.type === "inbound-rtp" && !stat.isRemote) {
      packetsLost += Math.max(0, Number(stat.packetsLost) || 0);
      packetsReceived += Math.max(0, Number(stat.packetsReceived) || 0);
      if (mediaKind === "audio") {
        const emitted = Number(stat.jitterBufferEmittedCount);
        inboundAudio = {
          packetsReceived: stat.packetsReceived ?? null,
          packetsLost: stat.packetsLost ?? null,
          bytesReceived: stat.bytesReceived ?? null,
          jitter: stat.jitter ?? null,
          averageJitterBufferDelayMs: averageJitterDelay(
            stat.jitterBufferDelay,
            emitted,
          ),
          averageJitterBufferTargetDelayMs: averageJitterDelay(
            stat.jitterBufferTargetDelay,
            emitted,
          ),
          averageJitterBufferMinimumDelayMs: averageJitterDelay(
            stat.jitterBufferMinimumDelay,
            emitted,
          ),
        };
      }
    }
    if (
      stat.type === "outbound-rtp" &&
      !stat.isRemote &&
      mediaKind === "audio"
    ) {
      outboundAudio = {
        packetsSent: stat.packetsSent ?? null,
        bytesSent: stat.bytesSent ?? null,
        targetBitrate: stat.targetBitrate ?? null,
      };
    }
    if (stat.type === "outbound-rtp" && !stat.isRemote) {
      outboundPacketsSent += Math.max(0, Number(stat.packetsSent) || 0);
    }
    if (stat.type === "remote-inbound-rtp" && mediaKind === "audio") {
      remoteInboundAudio = {
        roundTripTime: stat.roundTripTime ?? null,
        fractionLost: stat.fractionLost ?? null,
        packetsLost: stat.packetsLost ?? null,
        jitter: stat.jitter ?? null,
      };
    }
    if (stat.type === "remote-inbound-rtp") {
      const fractionLost = Number(stat.fractionLost);
      if (Number.isFinite(fractionLost) && fractionLost >= 0)
        remoteLossFractions.push(fractionLost);
    }
  }

  return {
    kind,
    pcStates: {
      connectionState: pc.connectionState,
      iceConnectionState: pc.iceConnectionState,
      signalingState: pc.signalingState,
    },
    candidatePair: pair
      ? {
          currentRoundTripTime: pair.currentRoundTripTime ?? null,
          availableOutgoingBitrate: pair.availableOutgoingBitrate ?? null,
          availableIncomingBitrate: pair.availableIncomingBitrate ?? null,
          totalRoundTripTime: pair.totalRoundTripTime ?? null,
          responsesReceived: pair.responsesReceived ?? null,
          requestsSent: pair.requestsSent ?? null,
          consentRequestsSent: pair.consentRequestsSent ?? null,
          bytesSent: pair.bytesSent ?? null,
          bytesReceived: pair.bytesReceived ?? null,
          packetsSent: pair.packetsSent ?? null,
          packetsReceived: pair.packetsReceived ?? null,
          packetLoss:
            outboundPacketsSent > 0 && remoteLossFractions.length
              ? Math.max(...remoteLossFractions) * 100
              : null,
          receivedPacketLoss:
            packetsLost + packetsReceived > 0
              ? (packetsLost * 100) / (packetsLost + packetsReceived)
              : null,
          local: local ? candidateDetails(local) : null,
          remote: remote ? candidateDetails(remote) : null,
        }
      : null,
    inboundAudio,
    outboundAudio,
    remoteInboundAudio,
  };
}

export async function collectPeerConnectionDiagnosticStats(pc, kind) {
  const report = await pc.getStats();
  return {
    kind,
    pcStates: {
      connectionState: pc.connectionState,
      iceConnectionState: pc.iceConnectionState,
      iceGatheringState: pc.iceGatheringState,
      signalingState: pc.signalingState,
    },
    stats: [...report.values()].map((stat) => ({ ...stat })),
  };
}

function averageJitterDelay(value, emitted) {
  return emitted > 0 && Number.isFinite(Number(value))
    ? (Number(value) * 1000) / emitted
    : null;
}

function candidateDetails(candidate) {
  return {
    address: candidate.address || candidate.ip || null,
    port: candidate.port ?? null,
    protocol: candidate.protocol || null,
    candidateType: candidate.candidateType || null,
  };
}
