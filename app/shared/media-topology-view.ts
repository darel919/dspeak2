import { normalizeMediaPathMetrics } from "#shared/media-route.ts";
import { classifyP2pPath } from "./native-p2p-common.ts";
import {
  isExternalBoolean,
  isExternalNumber,
  isExternalRecord,
  isExternalString,
} from "./types/boundary.ts";
import type {
  MediaTopologyCandidatePair,
  MediaTopologyEdge,
  MediaTopologyParticipant,
  MediaTopologyProvider,
  MediaTopologyViewContext,
} from "./types/media-topology-view.ts";
import type { PeerMetric } from "#shared/types/media.ts";

type TopologyGraphBuilder =
  typeof import("./rtc-topology.ts").buildTopologyGraph;
type PeerMetricMapper = (
  edges: readonly PeerMetric[],
  peers: readonly PeerMetric[],
) => Record<string, unknown>;

type MediaTopologyViewDependencies = MediaTopologyViewContext & {
  buildTopologyGraph: TopologyGraphBuilder;
  mapPeerConnectionMetrics: PeerMetricMapper;
  mapPeerRoundTripTimes: PeerMetricMapper;
};

function asProvider<T>(value: T): MediaTopologyProvider | null {
  if (!isExternalRecord(value)) return null;
  if (!(value.connections instanceof Map)) return null;
  const provider: MediaTopologyProvider = { connections: value.connections };
  if (value.producers instanceof Map) provider.producers = value.producers;
  if (value.consumers instanceof Map) provider.consumers = value.consumers;
  return provider;
}

function asParticipant<T>(value: T): MediaTopologyParticipant {
  if (isExternalRecord(value)) {
    const participant: MediaTopologyParticipant = {};
    if (isExternalString(value.id) || isExternalNumber(value.id))
      participant.id = value.id;
    if (isExternalString(value.userId) || isExternalNumber(value.userId))
      participant.userId = value.userId;
    if (isExternalRecord(value.profile)) participant.profile = value.profile;
    if (Array.isArray(value.sources)) participant.sources = value.sources;
    if (isExternalBoolean(value.muted)) participant.muted = value.muted;
    if (isExternalBoolean(value.deafened))
      participant.deafened = value.deafened;
    return participant;
  }
  return {
    userId: value === null ? null : String(value),
  };
}

function asEdge<T>(value: T): MediaTopologyEdge {
  if (!isExternalRecord(value)) return {};
  const edge: MediaTopologyEdge = {};
  if (isExternalString(value.peerId) || isExternalNumber(value.peerId))
    edge.peerId = value.peerId;
  if (isExternalString(value.state)) edge.state = value.state;
  if (isExternalNumber(value.rtt)) edge.rtt = value.rtt;
  if (isExternalNumber(value.jitter)) edge.jitter = value.jitter;
  if (isExternalString(value.network)) edge.network = value.network;
  if (isExternalNumber(value.bitrate)) edge.bitrate = value.bitrate;
  if (isExternalNumber(value.packetLoss)) edge.packetLoss = value.packetLoss;
  if (isExternalNumber(value.jitterBufferDelayMs))
    edge.jitterBufferDelayMs = value.jitterBufferDelayMs;
  if (isExternalNumber(value.availableOutgoingBitrate))
    edge.availableOutgoingBitrate = value.availableOutgoingBitrate;
  if (isExternalNumber(value.concealedAudioRatio))
    edge.concealedAudioRatio = value.concealedAudioRatio;
  edge.candidatePair = asCandidatePair(value.candidatePair);
  return edge;
}

function asCandidatePair<T>(value: T): MediaTopologyCandidatePair | null {
  if (!isExternalRecord(value)) return null;
  const pair: MediaTopologyCandidatePair = {};
  if (isExternalNumber(value.currentRoundTripTime))
    pair.currentRoundTripTime = value.currentRoundTripTime;
  if (isExternalNumber(value.availableOutgoingBitrate))
    pair.availableOutgoingBitrate = value.availableOutgoingBitrate;
  if (isExternalNumber(value.packetLoss)) pair.packetLoss = value.packetLoss;
  for (const side of ["local", "remote"] as const) {
    const candidate = isExternalRecord(value[side]) ? value[side] : null;
    if (!candidate) continue;
    pair[side] = {
      candidateType: isExternalString(candidate.candidateType)
        ? candidate.candidateType
        : null,
      protocol: isExternalString(candidate.protocol)
        ? candidate.protocol
        : null,
      address: isExternalString(candidate.address) ? candidate.address : null,
    };
  }
  return pair;
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
}: MediaTopologyViewDependencies) {
  const buildTopologyGraph = buildTopologyGraphValue;
  const mapPeerConnectionMetrics = mapPeerConnectionMetricsValue;
  const mapPeerRoundTripTimes = mapPeerRoundTripTimesValue;

  function syncConnectedUsers<T>(participants: T[] = []) {
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
      if (!voiceStore.isUserConnected(String(participant.userId))) {
        const userInfo = profile
          ? { ...profile, id: String(participant.userId), ...mediaState }
          : { id: String(participant.userId), ...mediaState };
        voiceStore.addConnectedUser(String(participant.userId), userInfo);
      }
      if (
        participant.muted !== undefined ||
        participant.deafened !== undefined ||
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

  function updateP2pStats<T>(rawEdges: T[]) {
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

  function refreshTopologyGraph<T>(candidatePairValue?: T) {
    const details: Record<string, Record<string, unknown>> = {};
    const p2pMesh = asProvider(getP2pMesh());
    const localPeerId = getLocalPeerId();
    let p2pPath: "direct" | "relay" | null =
      topologyState.value.mode === "p2p"
        ? (topologyState.value.p2pPath ?? null)
        : null;
    for (const connection of p2pMesh?.connections?.values() || []) {
      const edge =
        getP2pEdges()
          .map(asEdge)
          .find((candidate) => candidate.peerId === connection.peerId) || {};
      const key = [localPeerId, connection.peerId].sort().join(":");
      const pair = asCandidatePair(edge.candidatePair);
      const edgePath = classifyP2pPath({
        local: pair?.local ? { candidateType: pair.local.candidateType } : null,
        remote: pair?.remote
          ? { candidateType: pair.remote.candidateType }
          : null,
      });
      if (edgePath) p2pPath = p2pPath === "relay" ? "relay" : edgePath;
      details[key] = {
        state:
          edge.state ||
          (connection.pc.connectionState === "connected"
            ? "active"
            : "probing"),
        rtt: edge.rtt ?? null,
        network: edge.network || null,
        candidateType: pair?.local?.candidateType || null,
        remoteCandidateType: pair?.remote?.candidateType || null,
        path: edgePath,
        addressFamily: addressFamily(pair?.remote?.address),
        bitrate: edge.bitrate ?? null,
        packetLoss: edge.packetLoss ?? null,
      };
    }
    const candidatePair = asCandidatePair(candidatePairValue);
    const displayMode = isExternalString(topologyState.value.displayMode)
      ? topologyState.value.displayMode
      : topologyState.value.mode;
    topologyGraph.value = buildTopologyGraph({
      mode: displayMode,
      currentMode: activeProvider() ?? undefined,
      target: topologyState.value.target ?? undefined,
      epoch: topologyState.value.epoch,
      reason: topologyState.value.reason ?? undefined,
      p2pPath,
      activatedAt:
        topologyState.value.activatedAt == null
          ? null
          : String(topologyState.value.activatedAt),
      participantIds: topologyState.value.peers.flatMap((peer) =>
        isExternalString(peer.peerId) ? [peer.peerId] : [],
      ),
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
        : undefined,
      candidatePair: candidatePair
        ? {
            remote: candidatePair.remote
              ? { address: candidatePair.remote.address }
              : undefined,
          }
        : null,
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
