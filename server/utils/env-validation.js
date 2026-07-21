import { isIP } from 'node:net'

const requiredVariables = [
  'AUTH_PATH',
  'POCKETBASE_URL',
  'PBASE_ADMIN_EMAIL',
  'PBASE_ADMIN_PASSWORD',
  'VAPID_PUBLIC_KEY',
  'VAPID_PUBKEY',
  'VAPID_PRIVKEY'
]

function readPort(name, fallback) {
  const raw = process.env[name] || String(fallback)
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`)
  }
  return value
}

const defaultAddressDiscoveryUrl = 'https://api6.ipify.org'

function isPublicIpv6(value) {
  if (isIP(value) !== 6) return false

  const normalized = value.toLowerCase()
  const isGlobalUnicast = normalized.startsWith('2') || normalized.startsWith('3')
  const isDocumentationRange = normalized.startsWith('2001:db8:')
  return isGlobalUnicast && !isDocumentationRange
}

async function discoverAnnouncedAddress() {
  const discoveryUrl = process.env.MEDIASOUP_ANNOUNCED_ADDRESS_URL?.trim() || defaultAddressDiscoveryUrl
  let url
  try {
    url = new URL(discoveryUrl)
  } catch {
    throw new Error('MEDIASOUP_ANNOUNCED_ADDRESS_URL must be a valid absolute URL')
  }
  if (url.protocol !== 'https:') {
    throw new Error('MEDIASOUP_ANNOUNCED_ADDRESS_URL must use https')
  }

  let response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(5000) })
  } catch (error) {
    throw new Error(`Unable to auto-discover the public IPv6 address from ${url.origin}: ${error.message}`)
  }
  if (!response.ok) {
    throw new Error(`Public IPv6 discovery returned HTTP ${response.status} from ${url.origin}`)
  }

  const address = (await response.text()).trim()
  if (!isPublicIpv6(address)) {
    throw new Error(
      `Public IPv6 discovery returned ${JSON.stringify(address)}; expected a globally routable IPv6 address`
    )
  }
  return address
}

export async function validateRuntimeEnvironment() {
  const missing = requiredVariables.filter(name => !process.env[name]?.trim())
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
  }

  let pocketBaseUrl
  let authUrl
  try {
    pocketBaseUrl = new URL(process.env.POCKETBASE_URL)
    authUrl = new URL(process.env.AUTH_PATH)
  } catch {
    throw new Error('POCKETBASE_URL and AUTH_PATH must be valid absolute URLs')
  }
  if (!['http:', 'https:'].includes(pocketBaseUrl.protocol)) {
    throw new Error('POCKETBASE_URL must use http or https')
  }
  if (!['http:', 'https:'].includes(authUrl.protocol)) {
    throw new Error('AUTH_PATH must use http or https')
  }

  const rtcPort = readPort('MEDIASOUP_RTC_PORT', 40000)
  const announcedPort = process.env.MEDIASOUP_ANNOUNCED_PORT?.trim()
    ? readPort('MEDIASOUP_ANNOUNCED_PORT', rtcPort)
    : rtcPort

  const listenIp = process.env.MEDIASOUP_LISTEN_IP?.trim() || '127.0.0.1'
  let announcedAddress = process.env.MEDIASOUP_ANNOUNCED_ADDRESS?.trim()
  if (announcedAddress?.toLowerCase() === 'auto') {
    announcedAddress = await discoverAnnouncedAddress()
  }
  if ((listenIp === '0.0.0.0' || listenIp === '::') && !announcedAddress) {
    throw new Error(
      'MEDIASOUP_ANNOUNCED_ADDRESS must be a public address, DNS-only hostname, or "auto" when MEDIASOUP_LISTEN_IP binds to all interfaces'
    )
  }

  return {
    pocketBaseUrl: pocketBaseUrl.toString(),
    authUrl: authUrl.toString(),
    listenIp,
    announcedAddress,
    rtcPort,
    announcedPort
  }
}
