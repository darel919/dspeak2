import assert from 'node:assert/strict'
import test from 'node:test'
import { RemoteMediaHandoff } from '../app/shared/remote-media-handoff.js'
import { RemoteMediaRegistry, replaceMediaStreamTrack } from '../app/shared/remote-media-registry.js'

function harness() {
  const calls = []
  const registry = {
    bind: (entry, options) => calls.push(['bind', entry.key, options]),
    remove: key => calls.push(['remove', key]),
    activateProvider: provider => calls.push(['activate', provider]),
    clearProvider: provider => calls.push(['retire', provider]),
    clear: () => calls.push(['clear'])
  }
  return { handoff: new RemoteMediaHandoff(registry), calls }
}

test('replacement tracks keep one stable staged feed', () => {
  const { handoff } = harness()
  const oldTrack = { id: 'old' }
  const replacement = { id: 'new' }
  handoff.stage({ provider: 'p2p', key: 'p2p:peer:camera', userId: 'user-1', source: 'camera', track: oldTrack }, 'sfu')
  handoff.stage({ provider: 'p2p', key: 'p2p:peer:camera', userId: 'user-1', source: 'camera', track: replacement }, 'sfu')
  assert.equal(handoff.count('p2p'), 1)
  assert.equal([...handoff.entries('p2p')][0].track, replacement)
})

test('a retired track ending cannot remove its replacement', () => {
  const { handoff, calls } = harness()
  const oldTrack = { id: 'old' }
  const replacement = { id: 'new' }
  const entry = { provider: 'p2p', key: 'p2p:peer:screen', userId: 'user-1', source: 'screen', track: replacement }
  handoff.stage(entry, 'p2p')
  assert.equal(handoff.remove({ ...entry, track: oldTrack }), false)
  assert.equal(handoff.count('p2p'), 1)
  assert.equal(calls.some(call => call[0] === 'remove'), false)
})

test('activation binds only the destination provider and retirement clears its staged tracks', () => {
  const { handoff, calls } = harness()
  handoff.stage({ provider: 'sfu', key: 'producer-1', userId: 'user-1', source: 'camera', track: {} }, 'p2p')
  handoff.bind('sfu')
  assert.deepEqual(calls.map(call => call.slice(0, 2)), [['bind', 'remote:user-1:camera'], ['activate', 'sfu']])
  handoff.retire('sfu')
  assert.equal(handoff.count('sfu'), 0)
})

test('P2P and SFU replacements share one logical remote feed identity', () => {
  const { handoff, calls } = harness()
  handoff.stage({ provider: 'p2p', key: 'p2p:peer-1:camera', userId: 'user-1', source: 'camera', track: {} }, 'p2p')
  handoff.stage({ provider: 'sfu', key: 'producer-42', userId: 'user-1', source: 'camera', track: {} }, 'p2p')
  handoff.bind('sfu')

  const boundKeys = calls.filter(call => call[0] === 'bind').map(call => call[1])
  assert.deepEqual(new Set(boundKeys), new Set(['remote:user-1:camera']))
})

test('resolved participant identity replaces a staged peer-ID alias', () => {
  const { handoff } = harness()
  const track = { id: 'screen-track' }
  handoff.stage({ provider: 'p2p', key: 'p2p:peer-1:screen', peerId: 'peer-1', source: 'screen', track }, 'sfu')
  handoff.stage({ provider: 'p2p', key: 'p2p:peer-1:screen', peerId: 'peer-1', userId: 'user-1', source: 'screen', track }, 'sfu')

  assert.equal(handoff.count('p2p'), 1)
  assert.equal([...handoff.entries('p2p')][0].key, 'remote:user-1:screen')
})

test('an inactive staged track ending cannot remove the active provider feed', () => {
  const { handoff, calls } = harness()
  handoff.stage({ provider: 'p2p', key: 'p2p:peer-1:camera', userId: 'user-1', source: 'camera', track: {} }, 'p2p')
  const staged = { provider: 'sfu', key: 'producer-42', userId: 'user-1', source: 'camera', track: {} }
  handoff.stage(staged, 'p2p')
  handoff.remove(staged)

  assert.equal(calls.filter(call => call[0] === 'remove').length, 0)
  assert.equal(handoff.count('p2p'), 1)
})

test('video handoff replaces the track without replacing the logical stream', () => {
  const oldTrack = { id: 'p2p-track' }
  const newTrack = { id: 'sfu-track' }
  const tracks = [oldTrack]
  const stream = {
    getTracks: () => [...tracks],
    removeTrack: track => tracks.splice(tracks.indexOf(track), 1),
    addTrack: track => tracks.push(track)
  }

  assert.equal(replaceMediaStreamTrack(stream, newTrack), stream)
  assert.deepEqual(tracks, [newTrack])
})

test('video registry keeps the rendered stream while its provider changes', () => {
  const oldTrack = { id: 'p2p-track', kind: 'video' }
  const newTrack = { id: 'sfu-track', kind: 'video' }
  const tracks = [oldTrack]
  const stream = {
    getTracks: () => [...tracks],
    removeTrack: track => tracks.splice(tracks.indexOf(track), 1),
    addTrack: track => tracks.push(track)
  }
  const videoFeeds = { value: new Map() }
  const registry = new RemoteMediaRegistry({
    audioFeeds: { value: new Map() },
    videoFeeds,
    getVolume: () => 1,
    getOutputDevice: () => null,
    isDeafened: () => false,
    isBroadcastMode: () => false,
    onSpeaking: () => {}
  })

  registry.bind({ key: 'remote:user-1:screen', provider: 'p2p', track: oldTrack, stream })
  registry.bind({ key: 'remote:user-1:screen', provider: 'sfu', track: newTrack, stream: {} })

  assert.equal(videoFeeds.value.get('remote:user-1:screen').stream, stream)
  assert.equal(videoFeeds.value.get('remote:user-1:screen').provider, 'sfu')
  assert.deepEqual(tracks, [newTrack])
})
