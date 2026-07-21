import assert from 'node:assert/strict'
import test from 'node:test'
import { NativeP2pMesh } from '../app/shared/native-p2p.js'

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
