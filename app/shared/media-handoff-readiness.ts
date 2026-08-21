import { mediaDebug } from "./media-debug.ts";
import type {
  InitialMediaTopologyContext,
  MediaHandoffReadinessContext,
} from "./types/media-handoff-readiness.ts";
import type { TopologyHandoff } from "./types/topology-controller.ts";

export function waitForMediaHandoff({
  getLatestTopologyKey,
  getLocalPeerId,
  getP2pMesh,
  getSfu,
  handoff,
  localSources,
  pollIntervalMs,
  provider,
  signal,
  timeoutMs,
  topology,
  topologyEventKey,
  topologyState,
}: MediaHandoffReadinessContext) {
  const startedAt = Date.now();
  mediaDebug("handoff.wait-start", {
    provider,
    epoch: topology?.epoch,
    sourceRevision: topology?.sourceRevision,
  });
  if (signal?.aborted)
    return Promise.reject(signal.reason || new Error("Topology superseded"));
  if (provider === "sfu") {
    return waitForSfuHandoff({
      getLatestTopologyKey,
      getLocalPeerId,
      getSfu,
      handoff,
      localSources,
      pollIntervalMs,
      signal,
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
    signal,
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
  signal,
  timeoutMs,
  topology,
  topologyEventKey,
  topologyState,
  startedAt,
}: Omit<MediaHandoffReadinessContext, "provider" | "getP2pMesh"> & {
  getSfu: MediaHandoffReadinessContext["getSfu"];
  startedAt: number;
}) {
  const localPeerId = getLocalPeerId();
  const expected = countExpectedFeeds(topologyState, localPeerId);
  if (expected === 0 && localSources.size === 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const onAbort = () =>
      reject(signal?.reason || new Error("Topology superseded"));
    signal?.addEventListener("abort", onAbort, { once: true });
    const poll = async () => {
      if (signal?.aborted) return onAbort();
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
          if (!(sfu?.mediaReadiness instanceof Function))
            throw new Error("SFU media readiness unavailable");
          readiness = await sfu.mediaReadiness(
            sfu?.expectedInboundFlowCount?.() ?? expected,
          );
        } catch (error) {
          readiness = {
            ready: false,
            error: error instanceof Error ? error.message : String(error),
          };
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
        const readinessReasons: string[] = [];
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
  signal,
  timeoutMs,
  topology,
  topologyEventKey,
  topologyState,
  startedAt,
}: Omit<
  MediaHandoffReadinessContext,
  "provider" | "pollIntervalMs" | "getSfu"
> & {
  getP2pMesh: MediaHandoffReadinessContext["getP2pMesh"];
  startedAt: number;
}) {
  const localPeerId = getLocalPeerId();
  return new Promise<void>((resolve, reject) => {
    const onAbort = () =>
      reject(signal?.reason || new Error("Topology superseded"));
    signal?.addEventListener("abort", onAbort, { once: true });
    const poll = () => {
      if (signal?.aborted) return onAbort();
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

function countExpectedFeeds(
  topologyState: MediaHandoffReadinessContext["topologyState"],
  localPeerId: string | null,
) {
  return topologyState.value.peers
    .filter((peer) => String(peer.peerId) !== String(localPeerId))
    .reduce(
      (count, peer) =>
        count + (Array.isArray(peer.sources) ? peer.sources.length : 0),
      0,
    );
}

function countExpectedSfuFeeds(
  topologyState: MediaHandoffReadinessContext["topologyState"],
  localPeerId: string | null,
  sfu: NonNullable<MediaHandoffReadinessContext["getSfu"]> extends () => infer T
    ? T
    : never,
) {
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

function shouldExpectSfuSource(
  sfu: NonNullable<MediaHandoffReadinessContext["getSfu"]> extends () => infer T
    ? T
    : never,
  userId: string | number | null | undefined,
  source: string,
) {
  return sfu?.shouldReceive ? sfu.shouldReceive(userId, source) : true;
}

function checkTracksReady(
  handoff: TopologyHandoff,
  provider: "p2p" | "sfu",
  topologyState: MediaHandoffReadinessContext["topologyState"],
  localPeerId: string | null,
  sfu: Parameters<typeof countExpectedSfuFeeds>[2] | null = null,
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

export function waitForInitialMediaTopology({
  isReady,
  setWaiter,
  timeoutMs,
}: InitialMediaTopologyContext) {
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
