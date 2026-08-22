export const MAX_P2P_PARTICIPANTS = 8;
export const P2P_VIDEO_MAX_PARTICIPANTS = 4;
export const P2P_QUALIFICATION_TIMEOUT_MS = 8000;

import { isExternalString } from "./types/boundary.ts";

export function isP2pParticipantCount(
  count: number | string,
  hasVideo = false,
) {
  return (
    Number(count) >= 2 &&
    Number(count) <=
      (hasVideo ? P2P_VIDEO_MAX_PARTICIPANTS : MAX_P2P_PARTICIPANTS)
  );
}

export function addressFamily<T>(address: T) {
  const value = isExternalString(address) ? address : String(address || "");
  if (!value) return "unknown";
  if (value.includes(":")) return "ipv6";
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(value)) return "ipv4";
  return "unknown";
}

export function formatTopologyReason<T>(value: T) {
  const reason = isExternalString(value) ? value : String(value || "");
  if (!reason || reason === "provider-transition") return "Active media path";
  if (reason.startsWith("provider-cooldown-"))
    return "Recovered after provider cooldown";
  if (reason.startsWith("provider-failed-"))
    return "Recovered after provider failure";
  if (reason.startsWith("p2p-failed-")) return "SFU fallback after P2P failure";
  return reason.replaceAll("-", " ");
}

export function classifyTopology({
  mode,
  participantCount,
  candidatePair,
  healthy = true,
  p2pPath,
}: {
  mode: string;
  participantCount: number;
  candidatePair?: { remote?: { address?: string | null } } | null;
  healthy?: boolean;
  p2pPath?: string | null;
}) {
  if (mode === "probing") return { mode: "probing", label: "Connecting" };
  if (mode === "switching") return { mode: "switching", label: "Switching" };
  if (mode === "p2p") {
    const relay = p2pPath === "relay";
    return participantCount === 2
      ? {
          mode: relay ? "p2p-relay" : "p2p-direct",
          label: relay ? "P2P via TURN" : "Direct (P2P)",
        }
      : {
          mode: relay ? "p2p-mesh-relay" : "p2p-mesh",
          label: relay ? "Mesh (TURN-assisted)" : "Mesh (P2P)",
        };
  }
  if (mode === "sfu") {
    const family = addressFamily(candidatePair?.remote?.address);
    if (family === "ipv4")
      return {
        mode: "sfu",
        label: "SFU (IPv4 fallback)",
        addressFamily: family,
      };
    if (family === "ipv6")
      return { mode: "sfu", label: "SFU (IPv6)", addressFamily: family };
    return { mode: "sfu", label: "SFU", addressFamily: family };
  }
  return healthy
    ? { mode: "idle", label: "Waiting" }
    : { mode: "idle", label: "Degraded" };
}

function participantNode(
  id: string,
  index: number,
  localPeerId: string | number | null | undefined,
  health: Record<string, string> | undefined,
) {
  return {
    id: String(id),
    role: String(id) === String(localPeerId) ? "local" : "peer",
    health: health?.[id] || "healthy",
    index,
  };
}

interface TopologySnapshot {
  participantIds?: Array<string | number>;
  participantCount?: number;
  localPeerId?: string | number | null;
  peerHealth?: Record<string, string>;
  mode?: string;
  currentMode?: string;
  target?: string;
  candidatePair?: { remote?: { address?: string | null } } | null;
  edgeDetails?: Record<string, Record<string, unknown>>;
  sfuEdge?: Record<string, unknown>;
  participantSfuEdges?: Record<string, Record<string, unknown>>;
  healthy?: boolean;
  epoch?: number;
  reason?: string | null;
  p2pPath?: string | null;
  activatedAt?: string | null;
}

interface TopologyNode {
  id: string;
  role: string;
  health: string;
  index: number;
}

export function buildTopologyGraph(snapshot: TopologySnapshot = {}) {
  const participantIds = Array.isArray(snapshot.participantIds)
    ? snapshot.participantIds.map(String)
    : [];
  const classification = classifyTopology({
    mode: snapshot.mode || snapshot.currentMode || "idle",
    participantCount: snapshot.participantCount ?? participantIds.length,
    candidatePair: snapshot.candidatePair,
    healthy: snapshot.healthy,
    p2pPath: snapshot.p2pPath,
  });
  const nodes: TopologyNode[] = participantIds.map((id, index) =>
    participantNode(id, index, snapshot.localPeerId, snapshot.peerHealth),
  );
  const edges: Array<Record<string, unknown>> = [];
  const switching = snapshot.mode === "switching";
  const showP2p =
    classification.mode === "p2p-direct" ||
    classification.mode === "p2p-relay" ||
    classification.mode === "p2p-mesh" ||
    classification.mode === "p2p-mesh-relay" ||
    (switching &&
      (snapshot.currentMode === "p2p" || snapshot.target === "p2p"));
  const showSfu =
    classification.mode === "sfu" ||
    (switching &&
      (snapshot.currentMode === "sfu" || snapshot.target === "sfu"));
  const sfuAddressFamily = addressFamily(
    snapshot.candidatePair?.remote?.address,
  );

  if (showP2p) {
    for (let left = 0; left < nodes.length; left += 1) {
      for (let right = left + 1; right < nodes.length; right += 1) {
        const leftNode = nodes[left];
        const rightNode = nodes[right];
        if (!leftNode || !rightNode) continue;
        const key = [leftNode.id, rightNode.id].sort().join(":");
        const detail = snapshot.edgeDetails?.[key] || {};
        edges.push({
          from: leftNode.id,
          to: rightNode.id,
          state:
            switching && snapshot.target === "p2p"
              ? "probing"
              : detail.state || "active",
          transport: "p2p",
          ...detail,
        });
      }
    }
  }

  if (showSfu) {
    nodes.push({
      id: "sfu",
      role: "sfu",
      health: snapshot.healthy === false ? "degraded" : "healthy",
      index: nodes.length,
    });
    if (sfuAddressFamily === "ipv4") {
      nodes.push({
        id: "ipv4-fallback",
        role: "ipv4-fallback",
        health: "healthy",
        index: nodes.length,
      });
    }
    for (const node of nodes.filter(
      (candidate) => candidate.role === "local" || candidate.role === "peer",
    )) {
      const localEdge = node.role === "local";
      const detail = localEdge
        ? snapshot.sfuEdge || {}
        : snapshot.participantSfuEdges?.[node.id] || {};
      edges.push({
        from: node.id,
        to: localEdge && sfuAddressFamily === "ipv4" ? "ipv4-fallback" : "sfu",
        state: switching && snapshot.target === "sfu" ? "probing" : "active",
        transport: "sfu",
        addressFamily: localEdge ? sfuAddressFamily : "unknown",
        ...detail,
      });
    }
    if (sfuAddressFamily === "ipv4") {
      const fallbackEdge = {
        from: "ipv4-fallback",
        to: "sfu",
        state: switching && snapshot.target === "sfu" ? "probing" : "active",
        transport: "sfu",
        addressFamily: "ipv4",
      };
      if (snapshot.sfuEdge) Object.assign(fallbackEdge, snapshot.sfuEdge);
      edges.push(fallbackEdge);
    }
  }

  return {
    topology: {
      mode: classification.mode,
      label: classification.label,
      epoch: Number(snapshot.epoch) || 0,
      reason: snapshot.reason || null,
      participantCount: participantIds.length,
      activatedAt: snapshot.activatedAt || null,
    },
    nodes,
    edges,
  };
}
