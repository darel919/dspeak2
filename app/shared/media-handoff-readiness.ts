import { mediaDebug } from "./media-debug.ts";

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
  mediaDebug("handoff.wait-start", {
    provider,
    epoch: topology?.epoch,
    sourceRevision: topology?.sourceRevision,
  });
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
  return new Promise<void>((resolve, reject) => {
    const poll = async () => {
      const key = topologyEventKey(topology);
      if (key !== getLatestTopologyKey()) {
        reject(new Error("Topology handoff was superseded"));
        return;
      }
      const sfu = getSfu();
      const expectedSfu = countExpectedSfuFeeds(
        topologyState,
        localPeerId,
        sfu,
      );
      const tracksReady = checkTracksReady(
        handoff,
        "sfu",
        topologyState,
        localPeerId,
        sfu,
      );
      let readiness = null;
      if (tracksReady) {
        try {
          if (typeof sfu?.mediaReadiness !== "function")
            throw new Error("SFU media readiness unavailable");
          readiness = await sfu.mediaReadiness(
            sfu?.expectedInboundFlowCount?.() ?? expected,
          );
        } catch (error) {
          readiness = { ready: false, error: error.message };
        }
      }
      if (tracksReady && readiness?.ready === true) {
        mediaDebug("handoff.ready", {
          provider: "sfu",
          epoch: topology?.epoch,
          outbound: readiness.outboundFlowing,
          inbound: readiness.inboundFlowing,
        });
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        const readinessReasons = [] as any;
        if (readiness?.error)
          readinessReasons.push(`reason ${readiness.error}`);
        if (readiness?.connectionState || readiness?.iceConnectionState)
          readinessReasons.push(
            `transport ${readiness.connectionState || "unknown"}/${readiness.iceConnectionState || "unknown"}`,
          );
        const readinessReason = readinessReasons.length
          ? `, ${readinessReasons.join(", ")}`
          : "";
        reject(
          new Error(
            `SFU media did not become ready for handoff (tracks ${handoff.count("sfu")}/${expectedSfu}, outbound ${readiness?.outboundFlowing ?? 0}/${readiness?.outboundExpected ?? localSources.size}, inbound ${readiness?.inboundFlowing ?? 0}/${readiness?.inboundExpected ?? expectedSfu}${readinessReason})`,
          ),
        );
        mediaDebug("handoff.timeout", {
          provider: "sfu",
          epoch: topology?.epoch,
          tracks: handoff.count("sfu"),
          expected: expectedSfu,
          readiness,
        });
        return;
      }
      setTimeout(() => void poll().catch(reject), pollIntervalMs);
    };
    void poll().catch(reject);
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
  return new Promise<void>((resolve, reject) => {
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
        mediaDebug("handoff.ready", {
          provider: "p2p",
          epoch: topology?.epoch,
          tracks: handoff.count("p2p"),
        });
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(
          new Error(
            `P2P media did not become ready for handoff (tracks ${handoff.count("p2p")}/${expected}, mesh ready ${mediaReady ? "yes" : "no"})`,
          ),
        );
        mediaDebug("handoff.timeout", {
          provider: "p2p",
          epoch: topology?.epoch,
          tracks: handoff.count("p2p"),
          expected,
        });
        return;
      }
      setTimeout(() => void Promise.resolve().then(poll).catch(reject), 200);
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

function countExpectedSfuFeeds(topologyState, localPeerId, sfu) {
  return topologyState.value.peers
    .filter((peer) => String(peer.peerId) !== String(localPeerId))
    .reduce(
      (count, peer) =>
        count +
        (Array.isArray(peer.sources)
          ? peer.sources.filter((source) =>
              shouldExpectSfuSource(sfu, peer.userId, source),
            ).length
          : 0),
      0,
    );
}

function shouldExpectSfuSource(sfu, userId, source) {
  return sfu?.shouldReceive ? sfu.shouldReceive(userId, source) : true;
}

function checkTracksReady(
  handoff,
  provider,
  topologyState,
  localPeerId,
  sfu = null,
) {
  if (provider === "sfu" && sfu?.shouldReceive) {
    const tracks = [...handoff.entries(provider)];
    return topologyState.value.peers
      .filter((peer) => String(peer.peerId) !== String(localPeerId))
      .every((peer) =>
        (Array.isArray(peer.sources) ? peer.sources : []).every(
          (source) =>
            !shouldExpectSfuSource(sfu, peer.userId, source) ||
            tracks.some(
              (entry) =>
                String(entry.userId) === String(peer.userId) &&
                entry.source === source,
            ),
        ),
      );
  }
  return handoff.hasExpectedFeeds(
    provider,
    topologyState.value.peers,
    localPeerId,
  );
}

export function waitForInitialMediaTopology({ isReady, setWaiter, timeoutMs }) {
  if (isReady()) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      setWaiter(null);
      reject(new Error("Initial media topology timed out"));
    }, timeoutMs);
    setWaiter((error = null) => {
      clearTimeout(timeout);
      setWaiter(null);
      if (error) reject(error);
      else resolve();
    });
  });
}
