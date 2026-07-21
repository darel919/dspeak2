const maxP2pParticipants = 4

export function membershipTopology(participantCount) {
  if (participantCount < 2) return 'idle'
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
