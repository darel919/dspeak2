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
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (topologyEventKey(topology) !== getLatestTopologyKey()) {
        reject(new Error("Topology handoff was superseded"));
        return;
      }
      const localPeerId = getLocalPeerId();
      const expected = topologyState.value.peers
        .filter((peer) => String(peer.peerId) !== String(localPeerId))
        .reduce(
          (count, peer) =>
            count + (Array.isArray(peer.sources) ? peer.sources.length : 0),
          0,
        );
      const tracksReady = handoff.hasExpectedFeeds(
        provider,
        topologyState.value.peers,
        localPeerId,
      );
      const mediaReady =
        provider === "p2p" ? !!getP2pMesh()?.isMediaReady() : false;
      const check =
        provider === "sfu" && tracksReady
          ? getSfu()
              ?.mediaReadiness(expected)
              .catch((error) => ({ ready: false, error: error.message }))
          : Promise.resolve({ ready: mediaReady });
      check.then((readiness) => {
        const flowing = readiness?.ready === true;
        if (
          (tracksReady && flowing) ||
          (expected === 0 && localSources.size === 0)
        ) {
          resolve();
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          const detail =
            provider === "sfu"
              ? `tracks ${handoff.count(provider)}/${expected}, outbound ${readiness?.outboundFlowing ?? 0}/${readiness?.outboundExpected ?? localSources.size}, inbound ${readiness?.inboundFlowing ?? 0}/${readiness?.inboundExpected ?? expected}`
              : `tracks ${handoff.count(provider)}/${expected}, mesh ready ${flowing ? "yes" : "no"}`;
          reject(
            new Error(
              `${provider.toUpperCase()} media did not become ready for handoff (${detail})`,
            ),
          );
          return;
        }
        setTimeout(poll, pollIntervalMs);
      });
    };
    poll();
  });
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
