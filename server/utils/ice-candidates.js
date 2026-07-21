import { resolve6 } from 'node:dns/promises'
import { isIP } from 'node:net'

export async function buildPublicIceCandidates(candidates, config, lookup6 = resolve6) {
  let directAddress = config.directAddress

  if (directAddress && isIP(directAddress) !== 6) {
    try {
      const addresses = await lookup6(directAddress)
      directAddress = addresses.find(address => isIP(address) === 6)
    } catch {
      directAddress = undefined
    }
  }

  return candidates.flatMap(candidate => {
    if (candidate.ip === config.directAddress && !directAddress) return []

    return [{
      ...candidate,
      ip: candidate.ip === config.directAddress ? directAddress : candidate.ip,
      port: candidate.ip === config.announcedAddress
        ? config.announcedPort
        : candidate.port
    }]
  })
}

export function buildWebRtcListenInfos(config) {
  const infos = []

  if (config.directAddress) {
    const direct = {
      ip: '::',
      port: config.rtcPort,
      announcedAddress: config.directAddress,
      flags: { ipv6Only: true }
    }
    infos.push(
      { ...direct, protocol: 'udp' },
      { ...direct, protocol: 'tcp' }
    )
  }

  const fallback = {
    ip: config.listenIp,
    port: config.rtcPort
  }
  if (config.announcedAddress) fallback.announcedAddress = config.announcedAddress
  infos.push(
    { ...fallback, protocol: 'udp' },
    { ...fallback, protocol: 'tcp' }
  )

  return infos
}
