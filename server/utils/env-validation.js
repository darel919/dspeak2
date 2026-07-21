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

export function validateRuntimeEnvironment() {
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

  const rtcMinPort = readPort('MEDIASOUP_RTC_MIN_PORT', 40000)
  const rtcMaxPort = readPort('MEDIASOUP_RTC_MAX_PORT', 49999)
  if (rtcMinPort > rtcMaxPort) {
    throw new Error('MEDIASOUP_RTC_MIN_PORT cannot be greater than MEDIASOUP_RTC_MAX_PORT')
  }

  const listenIp = process.env.MEDIASOUP_LISTEN_IP?.trim() || '127.0.0.1'
  const announcedAddress = process.env.MEDIASOUP_ANNOUNCED_ADDRESS?.trim()
  if ((listenIp === '0.0.0.0' || listenIp === '::') && !announcedAddress) {
    throw new Error('MEDIASOUP_ANNOUNCED_ADDRESS is required when MEDIASOUP_LISTEN_IP binds to all interfaces')
  }

  return {
    pocketBaseUrl: pocketBaseUrl.toString(),
    authUrl: authUrl.toString(),
    listenIp,
    announcedAddress,
    rtcMinPort,
    rtcMaxPort
  }
}
