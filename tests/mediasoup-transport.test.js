import test from 'node:test'
import assert from 'node:assert/strict'
import { assertTransportDirection, buildConsumerOptions, buildWebRtcTransportOptions, WEBRTC_INITIAL_OUTGOING_BITRATE } from '../server/utils/mediasoup-transport.js'

test('send transport stays lean and prefers UDP with TCP fallback', () => {
  const webRtcServer = { id: 'server' }
  const options = buildWebRtcTransportOptions(webRtcServer, 'peer-1', 'send')

  assert.equal(options.webRtcServer, webRtcServer)
  assert.equal(options.enableUdp, true)
  assert.equal(options.enableTcp, true)
  assert.equal(options.preferUdp, true)
  assert.equal(options.enableSctp, false)
  assert.equal(options.initialAvailableOutgoingBitrate, WEBRTC_INITIAL_OUTGOING_BITRATE.send)
  assert.deepEqual(options.appData, { peerId: 'peer-1', direction: 'send' })
})

test('receive transport starts bandwidth estimation conservatively', () => {
  const options = buildWebRtcTransportOptions({}, 'peer-1', 'recv')

  assert.equal(options.initialAvailableOutgoingBitrate, 1_000_000)
  assert.deepEqual(options.appData, { peerId: 'peer-1', direction: 'recv' })
})

test('transport direction must be explicit', () => {
  assert.throws(() => buildWebRtcTransportOptions({}, 'peer-1', 'invalid'), /Invalid transport direction/)
})

test('consumer starts paused until its browser counterpart exists', () => {
  const rtpCapabilities = { codecs: [] }

  assert.deepEqual(buildConsumerOptions('producer-1', rtpCapabilities, 'user-1'), {
    producerId: 'producer-1',
    rtpCapabilities,
    paused: true,
    appData: { userId: 'user-1' }
  })
})

test('media operations cannot cross transport directions', () => {
  const sendTransport = { appData: { direction: 'send' } }
  const recvTransport = { appData: { direction: 'recv' } }

  assert.doesNotThrow(() => assertTransportDirection(sendTransport, 'send', 'Producing'))
  assert.doesNotThrow(() => assertTransportDirection(recvTransport, 'recv', 'Consuming'))
  assert.throws(() => assertTransportDirection(recvTransport, 'send', 'Producing'), /Producing requires a send transport/)
  assert.throws(() => assertTransportDirection(sendTransport, 'recv', 'Consuming'), /Consuming requires a recv transport/)
})
