import assert from 'node:assert/strict'
import test from 'node:test'
import { addressFamily, buildTopologyGraph, classifyTopology, isP2pParticipantCount } from '../app/shared/rtc-topology.js'
import { directIceServers, hasRequiredMediaFlow, isDirectPair } from '../app/shared/native-p2p.js'

test('P2P participant limit accepts only two through four devices', () => {
  assert.equal(isP2pParticipantCount(1), false)
  assert.equal(isP2pParticipantCount(2), true)
  assert.equal(isP2pParticipantCount(4), true)
  assert.equal(isP2pParticipantCount(5), false)
})

test('topology classification distinguishes direct, mesh, and IPv4 SFU', () => {
  assert.equal(classifyTopology({ mode: 'p2p', participantCount: 2 }).label, 'Direct (P2P)')
  assert.equal(classifyTopology({ mode: 'p2p', participantCount: 4 }).label, 'Mesh (P2P)')
  assert.equal(classifyTopology({ mode: 'sfu', candidatePair: { remote: { address: '198.51.100.4' } } }).label, 'Relayed (SFU IPv4)')
  assert.equal(classifyTopology({ mode: 'sfu', candidatePair: { remote: { address: '2001:db8::4' } } }).label, 'Relayed (SFU)')
  assert.equal(addressFamily('host.local'), 'unknown')
})

test('mesh graph contains every peer pair', () => {
  const graph = buildTopologyGraph({
    mode: 'p2p',
    participantCount: 4,
    participantIds: ['a', 'b', 'c', 'd'],
    localPeerId: 'a'
  })
  assert.equal(graph.topology.mode, 'p2p-mesh')
  assert.equal(graph.nodes.length, 4)
  assert.equal(graph.edges.length, 6)
})

test('IPv4 SFU graph includes the fallback node and server spokes', () => {
  const graph = buildTopologyGraph({
    mode: 'sfu',
    participantIds: ['a', 'b'],
    localPeerId: 'a',
    candidatePair: { remote: { address: '203.0.113.8' } }
  })
  assert.equal(graph.topology.label, 'Relayed (SFU IPv4)')
  assert.equal(graph.nodes.some(node => node.role === 'ipv4-fallback'), true)
  assert.equal(graph.edges.length, 3)
  assert.equal(graph.edges.some(edge => edge.from === 'ipv4-fallback' && edge.to === 'sfu'), true)
})

test('switching graph retains active P2P edges while staging SFU paths', () => {
  const graph = buildTopologyGraph({
    mode: 'switching',
    currentMode: 'p2p',
    target: 'sfu',
    participantIds: ['local', 'peer'],
    localPeerId: 'local',
    candidatePair: { remote: { address: '203.0.113.10' } }
  })
  assert.ok(graph.edges.some(edge => edge.transport === 'p2p' && edge.state === 'active'))
  assert.ok(graph.edges.some(edge => edge.transport === 'sfu' && edge.state === 'probing'))
  assert.ok(graph.nodes.some(node => node.role === 'ipv4-fallback'))
})

test('switching graph retains active SFU paths while probing P2P', () => {
  const graph = buildTopologyGraph({
    mode: 'switching',
    currentMode: 'sfu',
    target: 'p2p',
    participantIds: ['local', 'peer'],
    localPeerId: 'local',
    candidatePair: { remote: { address: '2001:db8::1' } }
  })
  assert.ok(graph.edges.some(edge => edge.transport === 'sfu' && edge.state === 'active'))
  assert.ok(graph.edges.some(edge => edge.transport === 'p2p' && edge.state === 'probing'))
})

test('direct P2P configuration removes TURN URLs', () => {
  assert.deepEqual(directIceServers([
    { urls: ['stun:stun.example.com', 'turn:turn.example.com'], username: 'secret' },
    { urls: 'turns:turn.example.com' }
  ]), [{ urls: ['stun:stun.example.com'] }])
})

test('direct pair rejects either relay candidate', () => {
  const hostPair = { state: 'succeeded', local: { candidateType: 'host' }, remote: { candidateType: 'host' } }
  assert.equal(isDirectPair(hostPair), true)
  assert.equal(isDirectPair({ ...hostPair, remote: { candidateType: 'relay' } }), false)
})

test('P2P media readiness requires every expected RTP direction to flow', async () => {
  const pc = {
    getStats: async () => new Map([
      ['out', { type: 'outbound-rtp', bytesSent: 10 }],
      ['in', { type: 'inbound-rtp', bytesReceived: 20 }]
    ])
  }
  assert.equal(await hasRequiredMediaFlow(pc, 1, 1), true)
  assert.equal(await hasRequiredMediaFlow(pc, 2, 1), false)
})
