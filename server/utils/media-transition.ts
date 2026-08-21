import type {
  PreparedActivation,
  TopologyEvent,
  TopologyReadiness,
} from "../types/media-transition.ts";

const DIRECT_AUDIO_ONLY_MAX_PARTICIPANTS = 8;
const DIRECT_VIDEO_MAX_PARTICIPANTS = 4;
type P2pRoutingPolicy = {
  recoveryDelayMs: number;
  stabilityDelayMs: number;
};

function maxP2pParticipants(hasVideo = false): number {
  return hasVideo
    ? DIRECT_VIDEO_MAX_PARTICIPANTS
    : DIRECT_AUDIO_ONLY_MAX_PARTICIPANTS;
}

export function p2pRoutingPolicy(
  participantCount: number,
  hasVideo = false,
): P2pRoutingPolicy {
  const count = Math.max(
    2,
    Math.min(maxP2pParticipants(hasVideo), Number(participantCount) || 2),
  );
  return {
    recoveryDelayMs: count === 2 ? 3000 : count === 3 ? 6000 : 10000,
    stabilityDelayMs: count === 2 ? 2000 : count === 3 ? 4000 : 8000,
  };
}

export function membershipTopology(
  participantCount: number,
  hasVideo = false,
): "idle" | "sfu" | "probing" {
  if (participantCount < 1) return "idle";
  if (participantCount === 1) return "sfu";
  if (participantCount > maxP2pParticipants(hasVideo)) return "sfu";
  return "probing";
}

export function hasCompleteMesh(
  peerIds: readonly string[],
  readiness: TopologyReadiness,
): boolean {
  if (readiness.size !== peerIds.length) return false;
  return peerIds.every((peerId) => {
    const qualified = readiness.get(peerId);
    return (
      qualified &&
      peerIds.every(
        (candidate) => candidate === peerId || qualified.has(candidate),
      )
    );
  });
}

export function allClientsReady(
  peerIds: readonly string[],
  readiness: ReadonlyMap<string, number>,
  sourceRevision: number,
): boolean {
  return peerIds.every((peerId) => readiness.get(peerId) === sourceRevision);
}

export function topologyEventKey(event: TopologyEvent): string {
  return `${Number(event.epoch)}:${event.mode}:${event.target || ""}:${Number(event.sourceRevision) || 0}`;
}

export function shouldAcceptTopologyEvent(
  event: TopologyEvent,
  highestQueuedEpoch: number,
  highestQueuedSourceRevision = 0,
): boolean {
  const epoch = Number(event.epoch);
  const sourceRevision = Number(event.sourceRevision) || 0;
  return (
    Number.isInteger(epoch) &&
    epoch >= 0 &&
    (epoch > highestQueuedEpoch ||
      (epoch === highestQueuedEpoch &&
        sourceRevision >= highestQueuedSourceRevision))
  );
}

export function matchesPreparedActivation(
  prepared: PreparedActivation | null | undefined,
  activation: TopologyEvent,
  target: string,
): boolean {
  return (
    prepared?.target === target &&
    prepared.epoch === Number(activation?.preparedEpoch) &&
    prepared.sourceRevision === (Number(activation?.sourceRevision) || 0)
  );
}
