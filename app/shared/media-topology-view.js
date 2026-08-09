import { normalizeMediaPathMetrics } from "#shared/media-route.js";

export function createMediaTopologyView({
  activeProvider,
  addressFamily,
  buildTopologyGraph,
  consumers,
  getLocalPeerId,
  getP2pEdges,
  getP2pMesh,
  getSfu,
  mapPeerConnectionMetrics,
  mapPeerRoundTripTimes,
  mediaPathMetrics,
  participantSfuRoundTripTimes,
  peerConnectionMetrics,
  peerRoundTripTimes,
  producers,
  setP2pEdges,
  topologyGraph,
  topologyState,
  voiceStore,
}) {
  function syncConnectedUsers(userIds = []) {
    const active = new Set(userIds.map(String));
    for (const userId of active)
      if (!voiceStore.isUserConnected(userId))
        voiceStore.addConnectedUser(userId, { id: userId });
    for (const user of voiceStore.getConnectedUsersArray())
      if (!active.has(String(user.id))) voiceStore.removeConnectedUser(user.id);
  }

  function updateP2pStats(edges) {
    setP2pEdges(edges);
    peerRoundTripTimes.value = mapPeerRoundTripTimes(
      edges,
      topologyState.value.peers,
    );
    peerConnectionMetrics.value = mapPeerConnectionMetrics(
      edges,
      topologyState.value.peers,
    );
    // Emit the plan's MediaPathMetrics contract per edge so SLO telemetry
    // can consume normalized units (ms, percent) plus candidate details.
    if (mediaPathMetrics)
      mediaPathMetrics.value = edges
        .filter((edge) => edge?.peerId)
        .map((edge) =>
          normalizeMediaPathMetrics({
            routeId: `p2p:${String(edge.peerId)}`,
            peerOrProvider: String(edge.peerId),
            rttMs: edge.rtt,
            jitterMs: edge.jitter == null ? null : edge.jitter * 1000,
            packetLossPercent: edge.packetLoss,
            jitterBufferDelayMs: edge.jitterBufferDelayMs,
            availableOutgoingBitrate: edge.availableOutgoingBitrate,
            concealedAudioRatio: edge.concealedAudioRatio,
            candidateType: edge.candidatePair?.local?.candidateType,
            protocol: edge.candidatePair?.local?.protocol,
          }),
        );
    refreshTopologyGraph();
  }

  function refreshTopologyGraph(candidatePair = null) {
    const details = {};
    const p2pMesh = getP2pMesh();
    const localPeerId = getLocalPeerId();
    for (const connection of p2pMesh ? p2pMesh.connections.values() : []) {
      const edge =
        getP2pEdges().find(
          (candidate) => candidate.peerId === connection.peerId,
        ) || {};
      const key = [localPeerId, connection.peerId].sort().join(":");
      details[key] = {
        state:
          edge.state ||
          (connection.pc.connectionState === "connected"
            ? "active"
            : "probing"),
        rtt: edge.rtt ?? null,
        network: edge.network || null,
        candidateType: edge.candidatePair?.local?.candidateType || null,
        addressFamily: addressFamily(edge.candidatePair?.remote?.address),
        bitrate: edge.bitrate ?? null,
        packetLoss: edge.packetLoss ?? null,
      };
    }
    topologyGraph.value = buildTopologyGraph({
      mode: topologyState.value.displayMode || topologyState.value.mode,
      currentMode: activeProvider(),
      target: topologyState.value.target,
      epoch: topologyState.value.epoch,
      reason: topologyState.value.reason,
      activatedAt: topologyState.value.activatedAt,
      participantIds: topologyState.value.peers.map((peer) => peer.peerId),
      localPeerId,
      edgeDetails: details,
      participantSfuEdges: Object.fromEntries(
        topologyState.value.peers.map((peer) => [
          String(peer.peerId),
          {
            rtt:
              participantSfuRoundTripTimes.value[String(peer.userId)] ?? null,
          },
        ]),
      ),
      sfuEdge: candidatePair
        ? {
            rtt:
              candidatePair.currentRoundTripTime == null
                ? null
                : candidatePair.currentRoundTripTime * 1000,
            network:
              candidatePair.local?.protocol ||
              candidatePair.remote?.protocol ||
              null,
            candidateType: candidatePair.local?.candidateType || null,
            bitrate: candidatePair.availableOutgoingBitrate ?? null,
            packetLoss: candidatePair.packetLoss ?? null,
          }
        : null,
      candidatePair,
    });
  }

  function refreshPublicMaps() {
    const sfu = getSfu();
    producers.value = new Map(
      sfu
        ? [...sfu.producers].map(([source, entry]) => [
            entry.producer.id,
            entry,
          ])
        : [],
    );
    consumers.value = new Map(
      sfu
        ? [...sfu.consumers.values()].map((entry) => [
            entry.producerId,
            entry.consumer,
          ])
        : [],
    );
  }

  return {
    refreshPublicMaps,
    refreshTopologyGraph,
    syncConnectedUsers,
    updateP2pStats,
  };
}
