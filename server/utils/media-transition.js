const maxP2pParticipants = 4

export function p2pRoutingPolicy(participantCount) {
  const count = Math.max(2, Math.min(maxP2pParticipants, Number(participantCount) || 2))
  const confidenceWeight = count - 1
  return {
    recoveryDelayMs: confidenceWeight * 10000,
    stabilityDelayMs: confidenceWeight * 10000
  }
}

export function membershipTopology(participantCount) {
  if (participantCount < 1) return 'idle'
  if (participantCount === 1) return 'sfu'
  if (participantCount > maxP2pParticipants) return 'sfu'
  return 'probing'
}

export function hasCompleteMesh(peerIds, readiness) {
  if (readiness.size !== peerIds.length) return false
  return peerIds.every((peerId) => {
    const qualified = readiness.get(peerId)
    return qualified && peerIds.every(candidate => candidate === peerId || qualified.has(candidate))
  })
}

export function allClientsReady(peerIds, readiness, sourceRevision) {
  return peerIds.every(peerId => readiness.get(peerId) === sourceRevision)
}

export function topologyEventKey(event) {
  return `${Number(event.epoch)}:${event.mode}:${event.target || ''}:${Number(event.sourceRevision) || 0}`
}

export function shouldAcceptTopologyEvent(event, highestQueuedEpoch) {
  const epoch = Number(event.epoch)
  return Number.isInteger(epoch) && epoch >= 0 && epoch >= highestQueuedEpoch
}

export function matchesPreparedActivation(prepared, activation, target) {
  return prepared?.target === target &&
    prepared.epoch === Number(activation?.preparedEpoch) &&
    prepared.sourceRevision === (Number(activation?.sourceRevision) || 0)
}
