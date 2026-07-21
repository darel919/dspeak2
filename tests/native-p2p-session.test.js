import assert from 'node:assert/strict'
import test from 'node:test'
import { applyOpusAudioProfile, NativeP2pMesh } from '../app/shared/native-p2p.js'

test('P2P source toggles reuse their sender instead of accumulating transceivers', async () => {
  const signals = []
  const replacements = []
  const sender = {
    replaceTrack(track) {
      replacements.push(track)
      return Promise.resolve()
    },
  }
  const mesh = new NativeP2pMesh({
    iceServers: [],
    sendSignal: (signal) => signals.push(signal),
  })
  const connection = {
    peerId: 'peer-2',
    senders: new Map([['camera', sender]]),
    pc: {
      addTrack: () => {
        throw new Error('must reuse existing sender')
      },
    },
  }
  mesh.connections.set(connection.peerId, connection)
  mesh.localSources.set('camera', { track: { id: 'old' }, stream: {} })

  mesh.unpublishSource('camera')
  const replacement = { id: 'new' }
  mesh.publishSource('camera', replacement, {})
  await Promise.resolve()

  assert.equal(connection.senders.get('camera'), sender)
  assert.deepEqual(replacements, [null, replacement])
  assert.deepEqual(signals, [
    {
      targetPeerId: 'peer-2',
      epoch: 0,
      signal: { sourceRemoved: { source: 'camera' } },
    },
    {
      targetPeerId: 'peer-2',
      epoch: 0,
      signal: { sourceRestored: { source: 'camera' } },
    },
  ])
})

test('P2P source restoration republishes the preserved remote receiver track', async () => {
  const restored = []
  const mesh = new NativeP2pMesh({
    iceServers: [],
    sendSignal() {},
    onRemoteTrack: (entry) => restored.push(entry),
  })
  const entry = { source: 'camera', track: { readyState: 'live' } }
  mesh.connections.set('peer-2', {
    peerId: 'peer-2',
    userId: 'user-2',
    remoteTracks: new Map([['camera', entry]]),
  })

  await mesh.receiveSignal({
    fromPeerId: 'peer-2',
    epoch: 0,
    signal: { sourceRestored: { source: 'camera' } },
  })

  assert.deepEqual(restored, [entry])
})

test('P2P SDP requests stereo low-latency Opus with loss protection', () => {
  const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=20;useinbandfec=0\r\n'
  const result = applyOpusAudioProfile(sdp)
  assert.match(result, /a=fmtp:111 minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;usedtx=0/)
  assert.match(result, /a=ptime:10/)
})

test('P2P video sender preserves frame cadence and applies its bitrate policy', async () => {
  let applied = null
  const sender = {
    getParameters: () => ({ encodings: [{}], transactionId: 'one' }),
    setParameters: async parameters => { applied = parameters }
  }
  const mesh = new NativeP2pMesh({
    iceServers: [],
    sendSignal() {},
    getSenderOptions: () => ({
      encodings: [{ maxBitrate: 12_000_000, maxFramerate: 60, priority: 'high', networkPriority: 'high' }],
      degradationPreference: 'maintain-framerate'
    })
  })

  await mesh.configureSender(sender, 'screen', { kind: 'video' })

  assert.equal(applied.degradationPreference, 'maintain-framerate')
  assert.deepEqual(applied.encodings[0], {
    maxBitrate: 12_000_000,
    maxFramerate: 60,
    priority: 'high',
    networkPriority: 'high'
  })
})
