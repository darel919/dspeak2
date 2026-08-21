type StatsRecord = Record<string, unknown>;
import { isExternalRecord, isExternalString } from "./types/boundary.ts";
import type { ExternalValue } from "./types/boundary.ts";
import type {
  AudioStatsSample,
  RtpStatsSample,
} from "./types/rtc-media-stats.ts";
export type {
  AudioStatsSample,
  RtpStatsSample,
} from "./types/rtc-media-stats.ts";

function finite<T>(value: T): number | null {
  try {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  } catch {
    return null;
  }
}

interface StatsCollection {
  values: () => Iterable<ExternalValue>;
}

export interface RtpStatSelector {
  trackId?: string;
  mid?: string | null;
  kind?: string;
}

function isStatsCollection<T>(value: T): value is T & StatsCollection {
  return isExternalRecord(value) && value.values instanceof Function;
}

function reportValues<T>(report: T): StatsRecord[] {
  if (report == null) return [];
  if (isStatsCollection(report))
    return [...report.values()].filter(isStatsRecord);
  if (Array.isArray(report)) return report.filter(isStatsRecord);
  if (report instanceof Map) return [...report.values()].filter(isStatsRecord);
  if (isExternalRecord(report))
    return Object.values(report).filter(isStatsRecord);
  return [];
}

function isStatsRecord<T>(value: T): value is T & StatsRecord {
  return isExternalRecord(value);
}

export function findRtpStat<T>(
  report: T,
  type: string,
  { trackId, mid, kind }: RtpStatSelector = {},
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

export function calculateTransportBitrateBps<T>(
  bytes: T,
  timestamp: T,
  previous: { bytes?: T; timestamp?: T } | null = null,
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

export function collectRtpStats<T>(
  report: T,
  direction: string,
  trackSettings: MediaTrackSettings | Record<string, unknown> = {},
  previous: RtpStatsSample | null = null,
  expectedKind: string | null = null,
  selector: Omit<RtpStatSelector, "kind"> = {},
) {
  const type = direction === "outbound" ? "outbound-rtp" : "inbound-rtp";
  const values = reportValues(report);
  const rtp = findRtpStat(report, type, {
    ...selector,
    kind: expectedKind ?? undefined,
  });
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
    previous?.frameCounter ?? null,
    elapsedMs,
  );
  const bitrateKbps = deltaRate(
    bytes,
    previous?.bytes ?? null,
    elapsedMs,
    8 / 1000,
  );
  const totalCodecTime = finite(
    direction === "outbound" ? rtp.totalEncodeTime : rtp.totalDecodeTime,
  );
  const jitterBufferDelay = finite(rtp.jitterBufferDelay);
  const jitterBufferTargetDelay = finite(rtp.jitterBufferTargetDelay);
  const jitterBufferMinimumDelay = finite(rtp.jitterBufferMinimumDelay);
  const codecFrames =
    frameCounter == null || previous?.frameCounter == null
      ? null
      : frameCounter - previous.frameCounter;
  const codecTime =
    totalCodecTime == null || previous?.totalCodecTime == null
      ? null
      : totalCodecTime - previous.totalCodecTime;
  const frameTimeMs =
    codecFrames != null &&
    codecTime != null &&
    codecFrames > 0 &&
    codecTime >= 0
      ? (codecTime * 1000) / codecFrames
      : null;

  const targetBitrate = finite(rtp.targetBitrate);
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
            targetBitrate == null ? null : targetBitrate / 1000,
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
          framesRendered: finite(rtp.framesRendered),
          framesDropped: finite(rtp.framesDropped),
          framesPerSecond: finite(rtp.framesPerSecond),
          packetsReceived: finite(rtp.packetsReceived),
          packetsLost: finite(rtp.packetsLost),
          bytesReceived: bytes,
          jitter: finite(rtp.jitter),
          freezeCount: finite(rtp.freezeCount),
          totalFreezesDuration: finite(rtp.totalFreezesDuration),
          pauseCount: finite(rtp.pauseCount),
          totalPausesDuration: finite(rtp.totalPausesDuration),
          lastPacketReceivedTimestamp: finite(rtp.lastPacketReceivedTimestamp),
          pliCount: finite(rtp.pliCount),
          firCount: finite(rtp.firCount),
          nackCount: finite(rtp.nackCount),
          ssrc: finite(rtp.ssrc),
          keyFramesDecoded: finite(rtp.keyFramesDecoded),
          totalDecodeTime: totalCodecTime,
          totalInterFrameDelay: finite(rtp.totalInterFrameDelay),
          jitterBufferDelay,
          jitterBufferEmittedCount: finite(rtp.jitterBufferEmittedCount),
          jitterBufferDelayMs:
            jitterBufferDelay == null ? null : jitterBufferDelay * 1000,
          jitterBufferTargetDelayMs:
            jitterBufferTargetDelay == null
              ? null
              : jitterBufferTargetDelay * 1000,
          jitterBufferMinimumDelayMs:
            jitterBufferMinimumDelay == null
              ? null
              : jitterBufferMinimumDelay * 1000,
          audioLevel: finite(rtp.audioLevel),
          totalAudioEnergy: finite(rtp.totalAudioEnergy),
          totalSamplesDuration: finite(rtp.totalSamplesDuration),
          totalSamplesReceived: finite(rtp.totalSamplesReceived),
          concealedSamples: finite(rtp.concealedSamples),
          silentConcealedSamples: finite(rtp.silentConcealedSamples),
        };

  return { stats, sample: { timestamp, frameCounter, bytes, totalCodecTime } };
}

export function collectVideoRtpStats<T>(
  report: T,
  direction: string,
  trackSettings: MediaTrackSettings | Record<string, unknown> = {},
  previous: RtpStatsSample | null = null,
) {
  return collectRtpStats(report, direction, trackSettings, previous, "video");
}

export function collectOutboundAudioStats<T>(
  report: T,
  previous: AudioStatsSample | null = null,
) {
  const values = reportValues(report);
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
      bitrateKbps: deltaRate(
        bytes,
        previous?.bytes ?? null,
        elapsedMs,
        8 / 1000,
      ),
      audioLevel: finite(rtp.audioLevel),
    },
    sample: { timestamp, bytes },
  };
}

export interface RtcStatsSource<TReport extends ExternalValue = ExternalValue> {
  getStats: () => Promise<TReport>;
  connectionState?: string;
  iceConnectionState?: string;
  iceGatheringState?: string;
  signalingState?: string;
}

export async function collectPeerConnectionStats<TReport extends ExternalValue>(
  pc: RtcStatsSource<TReport>,
  kind: string,
) {
  const report = await pc.getStats();
  const byId = new Map<string, StatsRecord>();
  for (const stat of reportValues(report)) {
    if (isExternalString(stat.id)) byId.set(stat.id, stat);
  }
  const transport = [...byId.values()].find(
    (stat) => stat.type === "transport" && stat.selectedCandidatePairId,
  );
  const pair =
    (transport
      ? byId.get(String(transport.selectedCandidatePairId || ""))
      : null) ||
    [...byId.values()].find(
      (stat) =>
        stat.type === "candidate-pair" &&
        stat.state === "succeeded" &&
        stat.nominated,
    ) ||
    null;
  const local = pair ? byId.get(String(pair.localCandidateId || "")) : null;
  const remote = pair ? byId.get(String(pair.remoteCandidateId || "")) : null;
  let packetsLost = 0;
  let packetsReceived = 0;
  let outboundPacketsSent = 0;
  const remoteLossFractions: number[] = [];
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
          jitterBufferEmittedCount: Number.isFinite(emitted) ? emitted : null,
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
      connectionState: pc.connectionState || "unknown",
      iceConnectionState: pc.iceConnectionState || "unknown",
      signalingState: pc.signalingState || "unknown",
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

export async function collectPeerConnectionDiagnosticStats<
  TReport extends ExternalValue,
>(pc: RtcStatsSource<TReport>, kind: string) {
  const report = await pc.getStats();
  return {
    kind,
    pcStates: {
      connectionState: pc.connectionState || "unknown",
      iceConnectionState: pc.iceConnectionState || "unknown",
      iceGatheringState: pc.iceGatheringState || "unknown",
      signalingState: pc.signalingState || "unknown",
    },
    stats: reportValues(report).map((stat) => ({ ...stat })),
  };
}

function averageJitterDelay<T>(value: T, emitted: number) {
  return emitted > 0 && Number.isFinite(Number(value))
    ? (Number(value) * 1000) / emitted
    : null;
}

function candidateDetails(candidate: StatsRecord) {
  return {
    address: candidate.address || candidate.ip || null,
    port: candidate.port ?? null,
    protocol: candidate.protocol || null,
    candidateType: candidate.candidateType || null,
  };
}
