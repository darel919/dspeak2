const maxP2pParticipants = 4;

export function p2pRoutingPolicy(participantCount) {
  const count = Math.max(
    2,
    Math.min(maxP2pParticipants, Number(participantCount) || 2),
  );
  return {
    recoveryDelayMs: count === 2 ? 3000 : count === 3 ? 6000 : 10000,
    stabilityDelayMs: count === 2 ? 2000 : count === 3 ? 4000 : 8000,
  };
}

export function membershipTopology(participantCount) {
  if (participantCount < 1) return "idle";
  if (participantCount === 1) return "sfu";
  if (participantCount > maxP2pParticipants) return "sfu";
  return "probing";
}

export function hasCompleteMesh(peerIds, readiness) {
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

export function allClientsReady(peerIds, readiness, sourceRevision) {
  return peerIds.every((peerId) => readiness.get(peerId) === sourceRevision);
}

export function topologyEventKey(event) {
  return `${Number(event.epoch)}:${event.mode}:${event.target || ""}:${Number(event.sourceRevision) || 0}`;
}

export function shouldAcceptTopologyEvent(
  event,
  highestQueuedEpoch,
  highestQueuedSourceRevision = 0,
) {
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

export function matchesPreparedActivation(prepared, activation, target) {
  return (
    prepared?.target === target &&
    prepared.epoch === Number(activation?.preparedEpoch) &&
    prepared.sourceRevision === (Number(activation?.sourceRevision) || 0)
  );
}
