export function createHybridMediaDiagnostics({
  collectRtpStats,
  getActiveProvider,
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
  updateP2pStats,
  rtpStatsSamples,
}) {
  function sfuProducerIds() {
    const sfu = getSfu();
    return sfu
      ? [...sfu.producers.values()].map((entry) => entry.producer.id)
      : [];
  }

  async function getWebRTCStatsSnapshot() {
    const activeProvider = getActiveProvider();
    const p2pMesh = getP2pMesh();
    const sfu = getSfu();
    if (activeProvider === "p2p" && p2pMesh) {
      const edges = await p2pMesh.getSnapshot().catch(() => null);
      if (edges) updateP2pStats(edges);
    }
    const transports =
      activeProvider === "sfu"
        ? (await sfu?.stats()) || []
        : (await p2pMesh?.stats()) || [];
    const pair =
      activeProvider === "sfu"
        ? transports.find((transport) => transport.candidatePair)
            ?.candidatePair || null
        : null;
    sfuRoundTripTime.value =
      pair?.currentRoundTripTime == null
        ? null
        : pair.currentRoundTripTime * 1000;
    if (sfuRoundTripTime.value != null)
      send({ type: "client-sfu-rtt", data: { rttMs: sfuRoundTripTime.value } });
    refreshTopologyGraph(pair);
    return {
      timestamp: Date.now(),
      protocol: getProtocolState?.() || null,
      lifecycle: getLifecycle?.() || [],
      readiness: getReadiness?.() || null,
      media: {
        localAudioTracks: [...localSources.values()].filter(
          (entry) => entry.track.kind === "audio",
        ).length,
        remoteAudioTracks: remoteAudioFeeds.value.size,
        playbackState: playbackState.value,
      },
      peerRoundTripTime: Object.keys(peerRoundTripTimes.value).length
        ? Math.max(...Object.values(peerRoundTripTimes.value))
        : null,
      transports,
      topology: topologyGraph.value.topology,
      nodes: topologyGraph.value.nodes,
      edges: topologyGraph.value.edges,
    };
  }

  async function getOutboundRtpStats() {
    const activeProvider = getActiveProvider();
    const p2pMesh = getP2pMesh();
    const sfu = getSfu();
    const results = [];
    for (const entry of localSources.values()) {
      const settings = entry.track.getSettings?.() || {};
      const producer = sfu?.producers.get(entry.source)?.producer;
      const key = `outbound:${entry.source}`;
      const report =
        activeProvider === "sfu" && producer
          ? await producer.getStats().catch(() => null)
          : p2pMesh
            ? await p2pMesh
                .getOutboundTrackStats(entry.source)
                .catch(() => null)
            : null;
      const collected = report
        ? collectRtpStats(
            report,
            "outbound",
            settings,
            rtpStatsSamples.get(key),
            entry.track.kind,
          )
        : null;
      if (collected?.sample) rtpStatsSamples.set(key, collected.sample);
      const senderParameters =
        activeProvider === "p2p"
          ? p2pMesh?.getOutboundTrackParameters(entry.source)
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
          ? Number(encoding.maxBitrate) / 1000
          : null,
        configuredMaxFramerate: Number.isFinite(Number(encoding?.maxFramerate))
          ? Number(encoding.maxFramerate)
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
    const results = [];
    const remoteFeeds = [
      ...remoteAudioFeeds.value.values(),
      ...remoteVideoFeeds.value.values(),
    ];
    for (const entry of remoteFeeds) {
      const settings = entry.track.getSettings?.() || {};
      const key = `inbound:${entry.key}`;
      const report = entry.consumer
        ? await entry.consumer.getStats().catch(() => null)
        : p2pMesh
          ? await p2pMesh
              .getInboundTrackStats(entry.peerId, entry.track)
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
        consumerId: entry.key,
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
    return getActiveProvider() === "sfu"
      ? (await getSfu()?.diagnosticStats()) || []
      : (await getP2pMesh()?.diagnosticStats()) || [];
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
}) {
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
