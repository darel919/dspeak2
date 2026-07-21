import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildVoiceProducerOptions, getAverageJitterBufferDelayMs, getReconnectDelayMs, getTransportRecoveryDelayMs } from '../app/shared/voice-transport.js'

test('voice producer favors low latency without dropping packet-loss protection', () => {
  const track = { id: 'microphone' }
  const options = buildVoiceProducerOptions(track, 128000)

  assert.equal(options.track, track)
  assert.deepEqual(options.encodings, [{
    maxBitrate: 128000,
    priority: 'high',
    networkPriority: 'high'
  }])
  assert.deepEqual(options.codecOptions, {
    opusDtx: false,
    opusFec: true,
    opusNack: true,
    opusPtime: 10
  })
})

test('jitter buffer delay is reported as a per-emitted-sample average', () => {
  assert.equal(getAverageJitterBufferDelayMs({
    jitterBufferDelay: 2.5,
    jitterBufferEmittedCount: 100
  }), 25)
  assert.equal(getAverageJitterBufferDelayMs({}), null)
})

test('transport recovery tolerates transient disconnects but restarts hard failures immediately', () => {
  assert.equal(getTransportRecoveryDelayMs('connected'), null)
  assert.equal(getTransportRecoveryDelayMs('disconnected'), 3000)
  assert.equal(getTransportRecoveryDelayMs('failed'), 0)
})

test('reconnection backoff starts quickly and remains bounded', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 8].map(getReconnectDelayMs), [500, 1000, 2000, 4000, 8000, 8000])
})
