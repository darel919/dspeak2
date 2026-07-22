export const MAX_P2P_PARTICIPANTS = 4;
export const P2P_QUALIFICATION_TIMEOUT_MS = 8000;

export function isP2pParticipantCount(count) {
  return Number(count) >= 2 && Number(count) <= MAX_P2P_PARTICIPANTS;
}

export function addressFamily(address) {
  const value = String(address || "");
  if (!value) return "unknown";
  if (value.includes(":")) return "ipv6";
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(value)) return "ipv4";
  return "unknown";
}

export function classifyTopology({
  mode,
  participantCount,
  candidatePair,
  healthy = true,
}) {
  if (mode === "probing") return { mode: "probing", label: "Connecting" };
  if (mode === "switching") return { mode: "switching", label: "Switching" };
  if (mode === "p2p") {
    return participantCount === 2
      ? { mode: "p2p-direct", label: "Direct (P2P)" }
      : { mode: "p2p-mesh", label: "Mesh (P2P)" };
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

function participantNode(id, index, localPeerId, health) {
  return {
    id: String(id),
    role: String(id) === String(localPeerId) ? "local" : "peer",
    health: health?.[id] || "healthy",
    index,
  };
}

export function buildTopologyGraph(snapshot = {}) {
  const participantIds = Array.isArray(snapshot.participantIds)
    ? snapshot.participantIds.map(String)
    : [];
  const classification = classifyTopology({
    ...snapshot,
    participantCount: snapshot.participantCount ?? participantIds.length,
  });
  const nodes = participantIds.map((id, index) =>
    participantNode(id, index, snapshot.localPeerId, snapshot.peerHealth),
  );
  const edges = [];
  const switching = snapshot.mode === "switching";
  const showP2p =
    classification.mode === "p2p-direct" ||
    classification.mode === "p2p-mesh" ||
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
        const key = [nodes[left].id, nodes[right].id].sort().join(":");
        const detail = snapshot.edgeDetails?.[key] || {};
        edges.push({
          from: nodes[left].id,
          to: nodes[right].id,
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
    });
    if (sfuAddressFamily === "ipv4") {
      nodes.push({
        id: "ipv4-fallback",
        role: "ipv4-fallback",
        health: "healthy",
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
      edges.push({
        from: "ipv4-fallback",
        to: "sfu",
        state: switching && snapshot.target === "sfu" ? "probing" : "active",
        transport: "sfu",
        addressFamily: "ipv4",
        ...(snapshot.sfuEdge || {}),
      });
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
