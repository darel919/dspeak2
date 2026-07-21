import { resolve6 } from 'node:dns/promises'
import { isIP } from 'node:net'

export async function buildPublicIceCandidates(
  candidates,
  config,
  lookup6 = resolve6,
) {
  let directAddress = config.directAddress

  if (directAddress && isIP(directAddress) !== 6) {
    try {
      const addresses = await lookup6(directAddress)
      directAddress = addresses.find((address) => isIP(address) === 6)
    } catch {
      directAddress = undefined
    }
  }

  const mapped = candidates.flatMap((candidate) => {
    if (candidate.ip === config.directAddress && !directAddress) return []

    return [
      {
        ...candidate,
        direct: candidate.ip === config.directAddress,
        ip:
          candidate.ip === config.directAddress ? directAddress : candidate.ip,
        port:
          candidate.ip === config.directAddress
            ? config.directPort || candidate.port
            : candidate.ip === config.announcedAddress
              ? config.announcedPort
              : candidate.port,
      },
    ]
  })

  const directCandidates = mapped.filter((candidate) => candidate.direct)
  const fallbackCandidates = mapped.filter((candidate) => !candidate.direct)
  if (directCandidates.length && fallbackCandidates.length) {
    const highestFallback = Math.max(
      ...fallbackCandidates.map((candidate) => Number(candidate.priority) || 0),
    )
    const lowestDirect = Math.min(
      ...directCandidates.map((candidate) => Number(candidate.priority) || 0),
    )
    const priorityAdjustment = Math.max(0, highestFallback - lowestDirect + 1)
    for (const candidate of directCandidates) {
      candidate.priority = Math.min(
        0xffffffff,
        (Number(candidate.priority) || 0) + priorityAdjustment,
      )
    }
  }

  return mapped.map(({ direct: _, ...candidate }) => candidate)
}

export function buildWebRtcListenInfos(config) {
  const infos = []

  if (config.directAddress) {
    const direct = {
      ip: '::',
      port: config.rtcPort,
      announcedAddress: config.directAddress,
      flags: { ipv6Only: true },
    }
    infos.push({ ...direct, protocol: 'udp' }, { ...direct, protocol: 'tcp' })
  }

  const fallback = {
    ip: config.listenIp,
    port: config.rtcPort,
  }
  if (config.announcedAddress)
    fallback.announcedAddress = config.announcedAddress
  infos.push({ ...fallback, protocol: 'udp' }, { ...fallback, protocol: 'tcp' })

  return infos
}
