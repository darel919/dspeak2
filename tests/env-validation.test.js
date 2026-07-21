import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { validateRuntimeEnvironment } from '../server/utils/env-validation.js'

const originalEnvironment = { ...process.env }
const originalFetch = globalThis.fetch

beforeEach(() => {
  process.env = {
    ...originalEnvironment,
    AUTH_PATH: 'https://api.example.com/auth',
    POCKETBASE_URL: 'https://pocketbase.example.com',
    PBASE_ADMIN_EMAIL: 'admin@example.com',
    PBASE_ADMIN_PASSWORD: 'secret',
    VAPID_PUBLIC_KEY: 'public',
    VAPID_PUBKEY: 'public',
    VAPID_PRIVKEY: 'private',
    MEDIASOUP_LISTEN_IP: '0.0.0.0',
    MEDIASOUP_ANNOUNCED_ADDRESS: 'auto',
    MEDIASOUP_RTC_PORT: '40000',
    MEDIASOUP_ANNOUNCED_PORT: '45678'
  }
})

afterEach(() => {
  process.env = { ...originalEnvironment }
  globalThis.fetch = originalFetch
})

test('auto-discovers a globally routable IPv6 address', async () => {
  globalThis.fetch = async () => new Response('2404:c0:ba03:9eb::10\n')

  const config = await validateRuntimeEnvironment()

  assert.equal(config.announcedAddress, '2404:c0:ba03:9eb::10')
  assert.equal(config.rtcPort, 40000)
  assert.equal(config.announcedPort, 45678)
})

test('rejects IPv4 returned by automatic discovery', async () => {
  globalThis.fetch = async () => new Response('203.0.113.10')

  await assert.rejects(
    validateRuntimeEnvironment(),
    /expected a globally routable IPv6 address/
  )
})

test('rejects reserved IPv6 returned by automatic discovery', async () => {
  globalThis.fetch = async () => new Response('2001:db8::10')

  await assert.rejects(
    validateRuntimeEnvironment(),
    /expected a globally routable IPv6 address/
  )
})

test('keeps a DNS-only hostname override unchanged', async () => {
  process.env.MEDIASOUP_ANNOUNCED_ADDRESS = 'rtc.dspeak.example.com'

  const config = await validateRuntimeEnvironment()

  assert.equal(config.announcedAddress, 'rtc.dspeak.example.com')
})
