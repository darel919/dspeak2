export function waitForMediaHandoff({
  getLatestTopologyKey,
  getLocalPeerId,
  getP2pMesh,
  getSfu,
  handoff,
  localSources,
  pollIntervalMs,
  provider,
  timeoutMs,
  topology,
  topologyEventKey,
  topologyState,
}) {
  const startedAt = Date.now();
  if (provider === "sfu") {
    return waitForSfuHandoff({
      getLatestTopologyKey,
      getLocalPeerId,
      getSfu,
      handoff,
      localSources,
      pollIntervalMs,
      timeoutMs,
      topology,
      topologyEventKey,
      topologyState,
      startedAt,
    });
  }
  return waitForP2pHandoff({
    getLatestTopologyKey,
    getLocalPeerId,
    getP2pMesh,
    handoff,
    localSources,
    timeoutMs,
    topology,
    topologyEventKey,
    topologyState,
    startedAt,
  });
}

function waitForSfuHandoff({
  getLatestTopologyKey,
  getLocalPeerId,
  getSfu,
  handoff,
  localSources,
  pollIntervalMs,
  timeoutMs,
  topology,
  topologyEventKey,
  topologyState,
  startedAt,
}) {
  const localPeerId = getLocalPeerId();
  const expected = countExpectedFeeds(topologyState, localPeerId);
  if (expected === 0 && localSources.size === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      const key = topologyEventKey(topology);
      if (key !== getLatestTopologyKey()) {
        reject(new Error("Topology handoff was superseded"));
        return;
      }
      const tracksReady = checkTracksReady(
        handoff,
        "sfu",
        topologyState,
        localPeerId,
      );
      const readiness = tracksReady
        ? await getSfu()
            ?.mediaReadiness(expected)
            .catch((error) => ({ ready: false, error: error.message }))
        : null;
      if (tracksReady && readiness?.ready === true) {
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(
          new Error(
            `SFU media did not become ready for handoff (tracks ${handoff.count("sfu")}/${expected}, outbound ${readiness?.outboundFlowing ?? 0}/${readiness?.outboundExpected ?? localSources.size}, inbound ${readiness?.inboundFlowing ?? 0}/${readiness?.inboundExpected ?? expected})`,
          ),
        );
        return;
      }
      setTimeout(poll, pollIntervalMs);
    };
    poll();
  });
}

function waitForP2pHandoff({
  getLatestTopologyKey,
  getLocalPeerId,
  getP2pMesh,
  handoff,
  localSources,
  timeoutMs,
  topology,
  topologyEventKey,
  topologyState,
  startedAt,
}) {
  const localPeerId = getLocalPeerId();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (topologyEventKey(topology) !== getLatestTopologyKey()) {
        reject(new Error("Topology handoff was superseded"));
        return;
      }
      const tracksReady = handoff.hasExpectedFeeds(
        "p2p",
        topologyState.value.peers,
        localPeerId,
      );
      const mediaReady = !!getP2pMesh()?.isMediaReady();
      const expected = countExpectedFeeds(topologyState, localPeerId);
      if (
        (tracksReady && mediaReady) ||
        (expected === 0 && localSources.size === 0)
      ) {
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(
          new Error(
            `P2P media did not become ready for handoff (tracks ${handoff.count("p2p")}/${expected}, mesh ready ${mediaReady ? "yes" : "no"})`,
          ),
        );
        return;
      }
      setTimeout(poll, 200);
    };
    poll();
  });
}

function countExpectedFeeds(topologyState, localPeerId) {
  return topologyState.value.peers
    .filter((peer) => String(peer.peerId) !== String(localPeerId))
    .reduce(
      (count, peer) =>
        count + (Array.isArray(peer.sources) ? peer.sources.length : 0),
      0,
    );
}

function checkTracksReady(handoff, provider, topologyState, localPeerId) {
  return handoff.hasExpectedFeeds(
    provider,
    topologyState.value.peers,
    localPeerId,
  );
}

export function waitForInitialMediaTopology({ isReady, setWaiter, timeoutMs }) {
  if (isReady()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      setWaiter(null);
      reject(new Error("Initial media topology timed out"));
    }, timeoutMs);
    setWaiter(() => {
      clearTimeout(timeout);
      setWaiter(null);
      resolve();
    });
  });
}
