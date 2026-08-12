import { normalizeMediaPathMetrics } from "#shared/media-route.ts";
import type {
  MediaTopologyCandidatePair,
  MediaTopologyConnection,
  MediaTopologyEdge,
  MediaTopologyParticipant,
  MediaTopologyProvider,
  MediaTopologyViewContext,
} from "./types/media-topology-view.ts";

function asProvider(value: unknown): MediaTopologyProvider | null {
  if (!value || typeof value !== "object") return null;
  const provider = value as Partial<MediaTopologyProvider>;
  return provider.connections instanceof Map
    ? (provider as MediaTopologyProvider)
    : null;
}

function asParticipant(value: unknown): MediaTopologyParticipant {
  if (value && typeof value === "object")
    return value as MediaTopologyParticipant;
  return {
    userId:
      typeof value === "string" || typeof value === "number" ? value : null,
  };
}

function asEdge(value: unknown): MediaTopologyEdge {
  return value && typeof value === "object" ? (value as MediaTopologyEdge) : {};
}

function asCandidatePair(value: unknown): MediaTopologyCandidatePair | null {
  return value && typeof value === "object"
    ? (value as MediaTopologyCandidatePair)
    : null;
}

export function createMediaTopologyView({
  activeProvider,
  addressFamily,
  buildTopologyGraph: buildTopologyGraphValue,
  consumers,
  getParticipantProfile,
  getLocalPeerId,
  getP2pEdges,
  getP2pMesh,
  getSfu,
  mapPeerConnectionMetrics: mapPeerConnectionMetricsValue,
  mapPeerRoundTripTimes: mapPeerRoundTripTimesValue,
  mediaPathMetrics,
  participantSfuRoundTripTimes,
  peerConnectionMetrics,
  peerRoundTripTimes,
  producers,
  setP2pEdges,
  topologyGraph,
  topologyState,
  voiceStore,
}: MediaTopologyViewContext) {
  const buildTopologyGraph = buildTopologyGraphValue as (
    snapshot: Record<string, unknown>,
  ) => Record<string, unknown>;
  const mapPeerConnectionMetrics = mapPeerConnectionMetricsValue as (
    edges: unknown[],
    peers: unknown[],
  ) => Record<string, unknown>;
  const mapPeerRoundTripTimes = mapPeerRoundTripTimesValue as (
    edges: unknown[],
    peers: unknown[],
  ) => Record<string, unknown>;

  function syncConnectedUsers(participants: unknown[] = []) {
    const entries = participants
      .map(asParticipant)
      .map((participant) => ({
        ...participant,
        userId: String(participant.userId || participant.id || ""),
      }))
      .filter((participant) => participant.userId);
    const active = new Set(entries.map((participant) => participant.userId));
    for (const participant of entries) {
      const profile =
        participant.profile ||
        getParticipantProfile?.(String(participant.userId));
      const sources = Array.isArray(participant.sources)
        ? participant.sources.map((source) => String(source))
        : null;
      const mediaState: Record<string, unknown> =
        sources === null
          ? {}
          : {
              cameraEnabled: sources.includes("camera"),
              screenSharing: sources.includes("screen"),
            };
      if (profile)
        voiceStore.upsertUserProfile({
          ...profile,
          id: String(participant.userId),
        });
      if (!voiceStore.isUserConnected(String(participant.userId)))
        voiceStore.addConnectedUser(String(participant.userId), {
          ...(profile || {}),
          id: String(participant.userId),
          ...mediaState,
        });
      if (
        typeof participant.muted === "boolean" ||
        typeof participant.deafened === "boolean" ||
        sources !== null
      )
        voiceStore.updateUserVoiceState?.(
          String(participant.userId),
          participant,
        );
    }
    for (const user of voiceStore.getConnectedUsersArray()) {
      const userId = String(user.id || "");
      if (!active.has(userId)) voiceStore.removeConnectedUser(userId);
    }
  }

  function updateP2pStats(rawEdges: unknown[]) {
    const edges = rawEdges.map(asEdge);
    setP2pEdges(edges);
    peerRoundTripTimes.value = mapPeerRoundTripTimes(
      edges,
      topologyState.value.peers,
    );
    peerConnectionMetrics.value = mapPeerConnectionMetrics(
      edges,
      topologyState.value.peers,
    );
    if (mediaPathMetrics)
      mediaPathMetrics.value = edges
        .filter((edge) => edge.peerId)
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
            candidateType:
              edge.candidatePair?.local?.candidateType === "host" ||
              edge.candidatePair?.local?.candidateType === "srflx" ||
              edge.candidatePair?.local?.candidateType === "relay"
                ? edge.candidatePair.local.candidateType
                : undefined,
            protocol:
              edge.candidatePair?.local?.protocol === "udp" ||
              edge.candidatePair?.local?.protocol === "tcp" ||
              edge.candidatePair?.local?.protocol === "tls"
                ? edge.candidatePair.local.protocol
                : undefined,
          }),
        );
    refreshTopologyGraph();
  }

  function refreshTopologyGraph(candidatePairValue: unknown = null) {
    const details: Record<string, Record<string, unknown>> = {};
    const p2pMesh = asProvider(getP2pMesh());
    const localPeerId = getLocalPeerId();
    for (const connection of p2pMesh?.connections?.values() || []) {
      const typedConnection = connection as MediaTopologyConnection;
      const edge =
        getP2pEdges()
          .map(asEdge)
          .find((candidate) => candidate.peerId === typedConnection.peerId) ||
        {};
      const key = [localPeerId, typedConnection.peerId].sort().join(":");
      const pair = asCandidatePair(edge.candidatePair);
      details[key] = {
        state:
          edge.state ||
          (typedConnection.pc.connectionState === "connected"
            ? "active"
            : "probing"),
        rtt: edge.rtt ?? null,
        network: edge.network || null,
        candidateType: pair?.local?.candidateType || null,
        addressFamily: addressFamily(pair?.remote?.address),
        bitrate: edge.bitrate ?? null,
        packetLoss: edge.packetLoss ?? null,
      };
    }
    const candidatePair = asCandidatePair(candidatePairValue);
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
    const sfu = asProvider(getSfu());
    producers.value = new Map(
      sfu?.producers
        ? [...sfu.producers].map(([source, entry]) => [source, entry])
        : [],
    );
    consumers.value = new Map(
      sfu?.consumers
        ? [...sfu.consumers.values()].map((entry) => [
            entry.producerId || "",
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
