import { createHmac } from 'node:crypto'

const PUBLIC_STUN_SERVERS = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
]

const COMMUNITY_TURN_SERVERS = [
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:80?transport=tcp',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
      'turns:openrelay.metered.ca:443'
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: [
      'turn:stun.evan-brass.net',
      'turn:stun.evan-brass.net?transport=tcp',
      'stun:stun.evan-brass.net'
    ],
    username: 'guest',
    credential: 'password'
  },
  {
    urls: [
      'turn:freeturn.net:3478?transport=udp',
      'turn:freeturn.net:3478?transport=tcp',
      'turn:freeturn.net:5349?transport=tcp'
    ],
    username: 'free',
    credential: 'free'
  }
]

function positiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function createTurnCredentials({ secret, ttlSeconds = 3600, now = Date.now() }) {
  if (!secret) throw new Error('TURN_SHARED_SECRET is required to create TURN credentials')
  const expiresAt = Math.floor(now / 1000) + positiveInteger(ttlSeconds, 3600)
  const username = `${expiresAt}:dspeak`
  return {
    username,
    credential: createHmac('sha1', secret).update(username).digest('base64'),
    expiresAt
  }
}

export function createIceServers(environment = process.env, now = Date.now()) {
  const host = environment.DSPEAK_RTC_DOMAIN?.trim()
  const secret = environment.TURN_SHARED_SECRET?.trim()
  const servers = []

  if (host && secret) {
    const credentials = createTurnCredentials({
      secret,
      ttlSeconds: environment.TURN_CREDENTIAL_TTL_SECONDS,
      now
    })
    servers.push({
      urls: [
        `stun:${host}:3478`,
        `turn:${host}:3478?transport=udp`,
        `turn:${host}:3478?transport=tcp`,
        `turns:${host}:5349?transport=tcp`
      ],
      username: credentials.username,
      credential: credentials.credential
    })
  }

  return [...servers, ...PUBLIC_STUN_SERVERS, ...COMMUNITY_TURN_SERVERS]
}

export { COMMUNITY_TURN_SERVERS, PUBLIC_STUN_SERVERS }
