const fallbackPriorityPenalty = 1_000

function withPublicEndpoint(candidate, address, port, foundationPrefix, priority) {
  return {
    ...candidate,
    foundation: `${foundationPrefix}${candidate.foundation}`,
    priority,
    ip: address,
    port
  }
}

export function buildPublicIceCandidates(candidates, config) {
  const fallbackCandidates = candidates.map(candidate => withPublicEndpoint(
    candidate,
    config.announcedAddress || candidate.ip,
    config.announcedPort,
    config.directAddress ? 'p' : '',
    config.directAddress
      ? Math.max(1, candidate.priority - fallbackPriorityPenalty)
      : candidate.priority
  ))

  if (!config.directAddress) return fallbackCandidates

  const directCandidates = candidates.map(candidate => withPublicEndpoint(
    candidate,
    config.directAddress,
    config.directPort,
    'd',
    candidate.priority
  ))

  return [...directCandidates, ...fallbackCandidates]
}
