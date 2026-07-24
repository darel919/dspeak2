export function createHybridMediaDiagnostics({
  collectVideoRtpStats,
  getActiveProvider,
  getP2pMesh,
  getRequestedVideoSettings,
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
  videoStatsSamples,
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

  async function getOutboundVideoStats() {
    const activeProvider = getActiveProvider();
    const p2pMesh = getP2pMesh();
    const sfu = getSfu();
    const results = [];
    for (const entry of [...localSources.values()].filter(
      (entry) => entry.track.kind === "video",
    )) {
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
        ? collectVideoRtpStats(
            report,
            "outbound",
            settings,
            videoStatsSamples.get(key),
          )
        : null;
      if (collected?.sample) videoStatsSamples.set(key, collected.sample);
      const senderParameters =
        activeProvider === "p2p"
          ? p2pMesh?.getOutboundTrackParameters(entry.source)
          : producer?.rtpParameters;
      const encoding = senderParameters?.encodings?.[0] || null;
      results.push({
        source: entry.source,
        targetFps: getRequestedVideoSettings(entry.source).frameRate,
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

  async function getInboundVideoStats() {
    const p2pMesh = getP2pMesh();
    const results = [];
    for (const entry of remoteVideoFeeds.value.values()) {
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
        ? collectVideoRtpStats(
            report,
            "inbound",
            settings,
            videoStatsSamples.get(key),
          )
        : null;
      if (collected?.sample) videoStatsSamples.set(key, collected.sample);
      results.push({
        consumerId: entry.key,
        source: entry.source,
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
    getInboundVideoStats,
    getOutboundVideoStats,
    getWebRTCDiagnosticStats,
    getWebRTCStatsSnapshot,
    sfuProducerIds,
  };
}
