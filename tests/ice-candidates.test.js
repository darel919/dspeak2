import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildPublicIceCandidates } from '../server/utils/ice-candidates.js'

const serverCandidates = [
  {
    foundation: 'udpfoundation',
    priority: 1_076_302_079,
    ip: '0.0.0.0',
    protocol: 'udp',
    port: 9988,
    type: 'host'
  }
]

test('places direct IPv6 before the lower-priority Playit candidate', () => {
  const candidates = buildPublicIceCandidates(serverCandidates, {
    announcedAddress: 'vote-minds.gl.at.ply.gg',
    announcedPort: 57554,
    directAddress: '2404:c0:ba03:9eb::10',
    directPort: 9988
  })

  assert.deepEqual(candidates.map(candidate => ({
    ip: candidate.ip,
    port: candidate.port,
    priority: candidate.priority
  })), [
    {
      ip: '2404:c0:ba03:9eb::10',
      port: 9988,
      priority: 1_076_302_079
    },
    {
      ip: 'vote-minds.gl.at.ply.gg',
      port: 57554,
      priority: 1_076_301_079
    }
  ])
})

test('keeps the existing single public candidate when direct access is disabled', () => {
  const candidates = buildPublicIceCandidates(serverCandidates, {
    announcedAddress: 'vote-minds.gl.at.ply.gg',
    announcedPort: 57554
  })

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].ip, 'vote-minds.gl.at.ply.gg')
  assert.equal(candidates[0].port, 57554)
  assert.equal(candidates[0].priority, serverCandidates[0].priority)
})
