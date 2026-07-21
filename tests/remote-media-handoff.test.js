import assert from 'node:assert/strict'
import test from 'node:test'
import { RemoteMediaHandoff } from '../app/shared/remote-media-handoff.js'

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

test('an inactive staged track ending cannot remove the active provider feed', () => {
  const { handoff, calls } = harness()
  handoff.stage({ provider: 'p2p', key: 'p2p:peer-1:camera', userId: 'user-1', source: 'camera', track: {} }, 'p2p')
  const staged = { provider: 'sfu', key: 'producer-42', userId: 'user-1', source: 'camera', track: {} }
  handoff.stage(staged, 'p2p')
  handoff.remove(staged)

  assert.equal(calls.filter(call => call[0] === 'remove').length, 0)
  assert.equal(handoff.count('p2p'), 1)
})
