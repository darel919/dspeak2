import assert from 'node:assert/strict'
import test from 'node:test'
import { probeSelfHostedTurn, resetTurnHealthCache } from '../server/utils/turn-health.js'

test('TURN health reports disabled when self-hosting is not configured', async () => {
  resetTurnHealthCache()
  assert.deepEqual(await probeSelfHostedTurn({}), {
    configured: false,
    available: false,
    detail: 'disabled'
  })
})

test('TURN health distinguishes an unresolvable configured hostname', async () => {
  resetTurnHealthCache()
  const result = await probeSelfHostedTurn({
    DSPEAK_RTC_DOMAIN: 'does-not-exist.invalid',
    TURN_SHARED_SECRET: 'test-secret'
  }, { bypassCache: true, timeoutMs: 10 })
  assert.equal(result.configured, true)
  assert.equal(result.available, false)
  assert.ok(result.detail)
})
