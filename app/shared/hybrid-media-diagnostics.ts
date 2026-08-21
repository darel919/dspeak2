import type {
  DiagnosticSourceEntry,
  HybridMediaDiagnosticsContext,
  MediaReadinessContext,
} from "./types/hybrid-media-diagnostics.ts";
import {
  isExternalNumber,
  isExternalRecord,
  isExternalString,
} from "./types/boundary.ts";
import { getSharedStatsSnapshot } from "./rtc-stats-sampler.ts";
import type {
  RtcStatsSnapshot,
  RtcTransportSnapshot,
} from "./types/rtc-stats.ts";

function finiteNumber<T>(value: T): number | undefined {
  return isExternalNumber(value) && Number.isFinite(value) ? value : undefined;
}

interface NormalizedDiagnosticParameters {
  encodings?: Array<Record<string, unknown>>;
  degradationPreference?: string;
}

function normalizeDiagnosticParameters<T>(
  value: T,
): NormalizedDiagnosticParameters | null {
  if (!isExternalRecord(value)) return null;
  const encodings = Array.isArray(value.encodings)
    ? value.encodings.filter(isExternalRecord)
    : undefined;
  const degradationPreference = isExternalString(value.degradationPreference)
    ? value.degradationPreference
    : undefined;
  return { encodings, degradationPreference };
}

function isDiagnosticSourceEntry<T>(
  value: T,
): value is T & DiagnosticSourceEntry {
  return (
    isExternalRecord(value) &&
    isExternalString(value.source) &&
    value.track instanceof MediaStreamTrack
  );
}

export function normalizeRtcTransport<T>(value: T): RtcTransportSnapshot {
  if (!isExternalRecord(value)) return {};
  const candidatePair = isExternalRecord(value.candidatePair)
    ? {
        currentRoundTripTime: value.candidatePair.currentRoundTripTime,
        packetLoss: value.candidatePair.packetLoss,
        local: isExternalRecord(value.candidatePair.local)
          ? {
              candidateType: value.candidatePair.local.candidateType,
              protocol: value.candidatePair.local.protocol,
            }
          : undefined,
        remote: isExternalRecord(value.candidatePair.remote)
          ? { address: value.candidatePair.remote.address }
          : undefined,
        availableOutgoingBitrate: finiteNumber(
          value.candidatePair.availableOutgoingBitrate,
        ),
        availableIncomingBitrate: finiteNumber(
          value.candidatePair.availableIncomingBitrate,
        ),
      }
    : null;
  return {
    id: value.id,
    peerId: value.peerId,
    userId: value.userId,
    rtt: value.rtt,
    rttMs: value.rttMs,
    packetLoss: value.packetLoss,
    packetLossPercent: value.packetLossPercent,
    jitter: value.jitter,
    jitterMs: value.jitterMs,
    pcStates: isExternalRecord(value.pcStates)
      ? { iceConnectionState: value.pcStates.iceConnectionState }
      : undefined,
    candidatePair,
    inboundAudio: isExternalRecord(value.inboundAudio)
      ? {
          jitter: value.inboundAudio.jitter,
          jitterBufferDelay: value.inboundAudio.jitterBufferDelay,
          averageJitterBufferTargetDelay:
            value.inboundAudio.averageJitterBufferTargetDelay,
          averageJitterBufferMinimumDelay:
            value.inboundAudio.averageJitterBufferMinimumDelay,
          averageJitterBufferTargetDelayMs:
            value.inboundAudio.averageJitterBufferTargetDelayMs,
          averageJitterBufferMinimumDelayMs:
            value.inboundAudio.averageJitterBufferMinimumDelayMs,
          jitterBufferEmittedCount: value.inboundAudio.jitterBufferEmittedCount,
        }
      : undefined,
    outboundAudio: isExternalRecord(value.outboundAudio)
      ? { packetsSent: value.outboundAudio.packetsSent }
      : undefined,
    remoteInboundAudio: isExternalRecord(value.remoteInboundAudio)
      ? { fractionLost: value.remoteInboundAudio.fractionLost }
      : undefined,
    availableOutgoingBitrate: value.availableOutgoingBitrate,
    availableIncomingBitrate: value.availableIncomingBitrate,
    jitterBufferDelayMs: value.jitterBufferDelayMs,
    jitterBufferTargetDelayMs: value.jitterBufferTargetDelayMs,
    jitterBufferMinimumDelayMs: value.jitterBufferMinimumDelayMs,
    jitterBufferEmittedCount: value.jitterBufferEmittedCount,
    candidateType: value.candidateType,
    protocol: value.protocol,
  };
}

export function createHybridMediaDiagnostics({
  collectRtpStats,
  getActiveProvider,
  getActiveRouteProvider,
  getAudioLatencySnapshot,
  getP2pMesh,
  getRequestedVideoSettings,
  getLifecycle,
  getProtocolState,
  getReadiness,
  getSfu,
  localSources,
  playbackState,
  peerRoundTripTimes,
  remoteAudioFeeds,
  refreshTopologyGraph,
  remoteVideoFeeds,
  send,
  sfuRoundTripTime,
  topologyGraph,
  topologyState,
  updateP2pStats,
  rtpStatsSamples,
}: HybridMediaDiagnosticsContext) {
  const statsCacheOwner = {};
  function sfuProducerIds() {
    const sfu = getSfu();
    return sfu?.producers
      ? [...sfu.producers.values()]
          .map((entry) => entry.producer?.id)
          .filter((id): id is string => isExternalString(id))
      : [];
  }

  async function collectWebRTCStatsSnapshot(): Promise<RtcStatsSnapshot> {
    const activeProvider = getActiveProvider();
    const p2pMesh = getP2pMesh();
    const sfu = getSfu();
    let p2pEdges: Array<Record<string, unknown>> = [];
    if (activeProvider === "p2p" && p2pMesh) {
      const edges = await p2pMesh.getSnapshot?.()?.catch(() => null);
      if (edges) {
        p2pEdges = Array.isArray(edges) ? edges.filter(isExternalRecord) : [];
        if (Array.isArray(edges)) updateP2pStats(edges);
      }
    }
    const rawTransports =
      activeProvider === "sfu"
        ? (await sfu?.stats?.()) || []
        : (await p2pMesh?.stats?.()) || [];
    const transports = (Array.isArray(rawTransports) ? rawTransports : [])
      .filter(isExternalRecord)
      .map((transport) => {
        const normalized = normalizeRtcTransport(transport);
        const rawPcStates = isExternalRecord(transport.pcStates)
          ? transport.pcStates
          : {};
        return {
          ...normalized,
          pcStates: {
            ...normalized.pcStates,
            connectionState: rawPcStates.connectionState || "unknown",
            iceConnectionState: rawPcStates.iceConnectionState || "unknown",
            signalingState: rawPcStates.signalingState || "unknown",
          },
        };
      });
    const pair =
      activeProvider === "sfu"
        ? transports.find((transport) => transport.candidatePair)
            ?.candidatePair || null
        : null;
    const providerRttMs = transports.find((transport) =>
      Number.isFinite(Number(transport.rttMs)),
    )?.rttMs;
    const normalizedProviderRttMs = finiteNumber(providerRttMs);
    const normalizedPairRttSeconds = finiteNumber(pair?.currentRoundTripTime);
    sfuRoundTripTime.value =
      normalizedProviderRttMs ??
      (normalizedPairRttSeconds == null
        ? null
        : normalizedPairRttSeconds * 1000);
    if (activeProvider === "sfu" && sfuRoundTripTime.value != null)
      send({ type: "client-sfu-rtt", data: { rttMs: sfuRoundTripTime.value } });
    const paths =
      activeProvider === "p2p"
        ? p2pEdges.map((edge) => ({
            peerOrProvider: edge.peerId,
            rttMs: edge.rtt,
            jitterMs: edge.jitter,
            packetLossPercent: edge.packetLoss,
            availableOutgoingBitrate: edge.bitrate,
            candidateType:
              isExternalRecord(edge.candidatePair) &&
              isExternalRecord(edge.candidatePair.local)
                ? edge.candidatePair.local.candidateType || null
                : null,
            protocol: edge.network,
          }))
        : transports.map((transport) => ({
            peerOrProvider: transport.id || "sfu",
            rttMs:
              transport.rttMs ?? transport.candidatePair?.currentRoundTripTime,
            jitterMs: transport.jitterMs ?? transport.inboundAudio?.jitter,
            packetLossPercent:
              transport.packetLossPercent ??
              transport.candidatePair?.packetLoss,
            fractionLost: transport.remoteInboundAudio?.fractionLost,
            jitterBufferDelayMs:
              transport.jitterBufferDelayMs ??
              transport.inboundAudio?.jitterBufferDelay ??
              null,
            jitterBufferTargetDelayMs:
              transport.jitterBufferTargetDelayMs ??
              transport.inboundAudio?.averageJitterBufferTargetDelayMs ??
              null,
            jitterBufferMinimumDelayMs:
              transport.jitterBufferMinimumDelayMs ??
              transport.inboundAudio?.averageJitterBufferMinimumDelayMs ??
              null,
            jitterBufferEmittedCount:
              transport.jitterBufferEmittedCount ??
              transport.inboundAudio?.jitterBufferEmittedCount ??
              null,
            availableOutgoingBitrate:
              transport.availableOutgoingBitrate ??
              transport.candidatePair?.availableOutgoingBitrate ??
              null,
            candidateType:
              transport.candidateType ||
              transport.candidatePair?.local?.candidateType ||
              null,
            protocol:
              transport.protocol ||
              transport.candidatePair?.local?.protocol ||
              null,
          }));
    if (paths.length)
      send({
        type: "media-qoe",
        data: {
          provider:
            activeProvider === "sfu"
              ? getActiveRouteProvider?.() || "sfu"
              : activeProvider,
          epoch: Number(topologyState.value?.epoch) || 0,
          sampledAt: Date.now(),
          paths,
        },
      });
    refreshTopologyGraph(pair);
    const lifecycleValue = getLifecycle?.();
    return {
      timestamp: Date.now(),
      protocol: getProtocolState?.() || null,
      lifecycle: Array.isArray(lifecycleValue) ? lifecycleValue : [],
      readiness: getReadiness?.() || null,
      media: {
        localAudioTracks: [...localSources.values()].filter(
          (entry) => entry.track.kind === "audio",
        ).length,
        remoteAudioTracks: remoteAudioFeeds.value.size,
        playbackState: playbackState.value,
        audioLatency: getAudioLatencySnapshot?.() || null,
      },
      peerRoundTripTime: Object.keys(peerRoundTripTimes.value).length
        ? Math.max(
            ...Object.values(peerRoundTripTimes.value).filter(
              (value): value is number =>
                isExternalNumber(value) && Number.isFinite(value),
            ),
          )
        : null,
      transports,
      topology: topologyGraph.value.topology,
      nodes: topologyGraph.value.nodes,
      edges: topologyGraph.value.edges,
    };
  }

  function getWebRTCStatsSnapshot() {
    return getSharedStatsSnapshot(statsCacheOwner, collectWebRTCStatsSnapshot);
  }

  async function getOutboundRtpStats() {
    const activeProvider = getActiveProvider();
    const p2pMesh = getP2pMesh();
    const sfu = getSfu();
    const results: Array<Record<string, unknown>> = [];
    for (const entry of localSources.values()) {
      const settings = entry.track.getSettings?.() || {};
      const producerEntry = sfu?.producers?.get(entry.source);
      const producer = producerEntry?.producer;
      const key = `outbound:${entry.source}`;
      const topologyIndicatesSfu =
        topologyState.value.mode === "sfu" ||
        topologyState.value.target === "sfu" ||
        topologyState.value.targetTransport === "sfu";
      const useSfuStats =
        !!producer &&
        (activeProvider === "sfu" ||
          (activeProvider === null && topologyIndicatesSfu));
      const report = useSfuStats
        ? await producer.getStats().catch(() => null)
        : p2pMesh?.getOutboundTrackStats
          ? await p2pMesh.getOutboundTrackStats(entry.source).catch(() => null)
          : null;
      const collected = report
        ? collectRtpStats(
            report,
            "outbound",
            settings,
            rtpStatsSamples.get(key),
            entry.track.kind,
            {
              trackId: producerEntry?.track?.id ?? entry.track.id,
              mid: producerEntry?.mid,
            },
          )
        : null;
      if (collected?.sample) rtpStatsSamples.set(key, collected.sample);
      const senderParameters =
        activeProvider === "p2p"
          ? normalizeDiagnosticParameters(
              p2pMesh?.getOutboundTrackParameters?.(entry.source),
            )
          : producer?.rtpParameters;
      const encoding = senderParameters?.encodings?.[0] || null;
      results.push({
        source: entry.source,
        kind: entry.track.kind,
        targetFps:
          entry.track.kind === "video"
            ? getRequestedVideoSettings(entry.source).frameRate
            : null,
        captureFps: settings.frameRate || null,
        configuredMaxBitrateKbps: Number.isFinite(Number(encoding?.maxBitrate))
          ? Number(encoding?.maxBitrate) / 1000
          : null,
        configuredMaxFramerate: Number.isFinite(Number(encoding?.maxFramerate))
          ? Number(encoding?.maxFramerate)
          : null,
        degradationPreference: senderParameters?.degradationPreference || null,
        ...(collected?.stats || {
          width: settings.width || null,
          height: settings.height || null,
          fps: settings.frameRate || null,
        }),
      });
    }
    return results;
  }

  async function getInboundRtpStats() {
    const p2pMesh = getP2pMesh();
    const results: Array<Record<string, unknown>> = [];
    const remoteAudioEntries = [...remoteAudioFeeds.value.values()].filter(
      isDiagnosticSourceEntry,
    );
    const remoteVideoEntries = [...remoteVideoFeeds.value.values()].filter(
      isDiagnosticSourceEntry,
    );
    const remoteFeeds = [...remoteAudioEntries, ...remoteVideoEntries];
    for (const entry of remoteFeeds) {
      const settings = entry.track.getSettings?.() || {};
      const key = `inbound:${entry.key ?? entry.source}`;
      const report = entry.consumer
        ? await entry.consumer.getStats().catch(() => null)
        : p2pMesh?.getInboundTrackStats
          ? await p2pMesh
              .getInboundTrackStats?.(entry.peerId ?? "", entry.track)
              .catch(() => null)
          : null;
      const collected = report
        ? collectRtpStats(
            report,
            "inbound",
            settings,
            rtpStatsSamples.get(key),
            entry.track.kind,
          )
        : null;
      if (collected?.sample) rtpStatsSamples.set(key, collected.sample);

      results.push({
        consumerId: entry.key ?? entry.source,
        source: entry.source,
        kind: entry.track.kind,
        ...(collected?.stats || {
          width: settings.width || null,
          height: settings.height || null,
          fps: settings.frameRate || null,
        }),
      });
    }
    return results;
  }

  async function getWebRTCDiagnosticStats() {
    const provider = getActiveProvider() === "sfu" ? getSfu() : getP2pMesh();
    if (!(provider?.diagnosticStats instanceof Function)) return [];
    return (await provider.diagnosticStats()) || [];
  }

  return {
    getInboundRtpStats,
    getOutboundRtpStats,
    getWebRTCDiagnosticStats,
    getWebRTCStatsSnapshot,
    sfuProducerIds,
  };
}

export function mediaReadinessSnapshot({
  connected,
  mediaConnectionState,
  playbackState,
  topologyState,
  transportReady,
}: MediaReadinessContext) {
  return {
    signaling: connected,
    topology: topologyState.epoch > 0,
    transport: transportReady,
    rtp:
      mediaConnectionState === "media-flowing" ||
      mediaConnectionState === "ready-no-active-media",
    playback: playbackState,
  };
}
