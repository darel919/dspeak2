import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addressFamily,
  buildTopologyGraph,
  classifyTopology,
  isP2pParticipantCount,
} from '../app/shared/rtc-topology.js'
import {
  directIceServers,
  hasRequiredMediaFlow,
  isViableP2pPair,
  isP2pLivenessExpired,
  p2pActiveLivenessTimeoutMs,
  p2pRemoteFeedKey,
  requiresP2pLiveness,
} from '../app/shared/native-p2p.js'
import {
  collectPeerConnectionStats,
  collectVideoRtpStats,
} from '../app/shared/rtc-media-stats.js'
import { validP2pSignal } from '../server/utils/p2p-signal.js'

test('P2P participant limit accepts only two through four devices', () => {
  assert.equal(isP2pParticipantCount(1), false)
  assert.equal(isP2pParticipantCount(2), true)
  assert.equal(isP2pParticipantCount(4), true)
  assert.equal(isP2pParticipantCount(5), false)
})

test('topology classification distinguishes direct, mesh, and IPv4 SFU', () => {
  assert.equal(
    classifyTopology({ mode: 'p2p', participantCount: 2 }).label,
    'Direct (P2P)',
  )
  assert.equal(
    classifyTopology({ mode: 'p2p', participantCount: 4 }).label,
    'Mesh (P2P)',
  )
  assert.equal(
    classifyTopology({
      mode: 'sfu',
      candidatePair: { remote: { address: '198.51.100.4' } },
    }).label,
    'SFU (IPv4 fallback)',
  )
  assert.equal(
    classifyTopology({
      mode: 'sfu',
      candidatePair: { remote: { address: '2001:db8::4' } },
    }).label,
    'SFU (IPv6)',
  )
  assert.equal(addressFamily('host.local'), 'unknown')
})

test('mesh graph contains every peer pair', () => {
  const graph = buildTopologyGraph({
    mode: 'p2p',
    participantCount: 4,
    participantIds: ['a', 'b', 'c', 'd'],
    localPeerId: 'a',
  })
  assert.equal(graph.topology.mode, 'p2p-mesh')
  assert.equal(graph.nodes.length, 4)
  assert.equal(graph.edges.length, 6)
})

test('two-node graph is classified as direct without a redundant participant count', () => {
  const graph = buildTopologyGraph({
    mode: 'p2p',
    participantIds: ['local', 'peer'],
    localPeerId: 'local',
  })
  assert.equal(graph.topology.mode, 'p2p-direct')
  assert.equal(graph.topology.label, 'Direct (P2P)')
})

test('IPv4 SFU graph includes the fallback node and server spokes', () => {
  const graph = buildTopologyGraph({
    mode: 'sfu',
    participantIds: ['a', 'b'],
    localPeerId: 'a',
    candidatePair: { remote: { address: '203.0.113.8' } },
  })
  assert.equal(graph.topology.label, 'SFU (IPv4 fallback)')
  assert.equal(
    graph.nodes.some((node) => node.role === 'ipv4-fallback'),
    true,
  )
  assert.equal(graph.edges.length, 3)
  assert.equal(
    graph.edges.find((edge) => edge.from === 'a').to,
    'ipv4-fallback',
  )
  assert.equal(graph.edges.find((edge) => edge.from === 'b').to, 'sfu')
  assert.equal(
    graph.edges.some(
      (edge) => edge.from === 'ipv4-fallback' && edge.to === 'sfu',
    ),
    true,
  )
})

test('SFU graph does not copy local candidate metrics onto remote participants', () => {
  const graph = buildTopologyGraph({
    mode: 'sfu',
    participantIds: ['local', 'peer'],
    localPeerId: 'local',
    candidatePair: { remote: { address: '2001:db8::1' } },
    sfuEdge: { rtt: 12, candidateType: 'host' },
    participantSfuEdges: { peer: { rtt: 40 } },
  })
  assert.deepEqual(graph.edges.find((edge) => edge.from === 'local').rtt, 12)
  assert.deepEqual(graph.edges.find((edge) => edge.from === 'peer').rtt, 40)
  assert.equal(
    graph.edges.find((edge) => edge.from === 'peer').candidateType,
    undefined,
  )
})

test('switching graph retains active P2P edges while staging SFU paths', () => {
  const graph = buildTopologyGraph({
    mode: 'switching',
    currentMode: 'p2p',
    target: 'sfu',
    participantIds: ['local', 'peer'],
    localPeerId: 'local',
    candidatePair: { remote: { address: '203.0.113.10' } },
  })
  assert.ok(
    graph.edges.some(
      (edge) => edge.transport === 'p2p' && edge.state === 'active',
    ),
  )
  assert.ok(
    graph.edges.some(
      (edge) => edge.transport === 'sfu' && edge.state === 'probing',
    ),
  )
  assert.ok(graph.nodes.some((node) => node.role === 'ipv4-fallback'))
})

test('switching graph retains active SFU paths while probing P2P', () => {
  const graph = buildTopologyGraph({
    mode: 'switching',
    currentMode: 'sfu',
    target: 'p2p',
    participantIds: ['local', 'peer'],
    localPeerId: 'local',
    candidatePair: { remote: { address: '2001:db8::1' } },
  })
  assert.ok(
    graph.edges.some(
      (edge) => edge.transport === 'sfu' && edge.state === 'active',
    ),
  )
  assert.ok(
    graph.edges.some(
      (edge) => edge.transport === 'p2p' && edge.state === 'probing',
    ),
  )
})

test('direct P2P configuration preserves authenticated TURN URLs', () => {
  assert.deepEqual(
    directIceServers([
      {
        urls: ['stun:stun.example.com', 'turn:turn.example.com'],
        username: 'secret',
      },
      { urls: 'turns:turn.example.com' },
    ]),
    [
      {
        urls: ['stun:stun.example.com', 'turn:turn.example.com'],
        username: 'secret',
      },
      { urls: 'turns:turn.example.com' },
    ],
  )
})

test('P2P pair accepts direct and relayed candidate paths', () => {
  const hostPair = {
    state: 'succeeded',
    local: { candidateType: 'host' },
    remote: { candidateType: 'host' },
  }
  assert.equal(isViableP2pPair(hostPair), true)
  assert.equal(
    isViableP2pPair({ ...hostPair, remote: { candidateType: 'relay' } }),
    true,
  )
})

test('active P2P liveness tolerates short stats and health stalls', () => {
  assert.equal(isP2pLivenessExpired(1000, 3999, 3000), false)
  assert.equal(isP2pLivenessExpired(1000, 4000, 3000), true)
  assert.equal(isP2pLivenessExpired(Number.NaN, 4000, 3000), false)
})

test('larger meshes return to SFU sooner when any edge loses liveness', () => {
  assert.equal(p2pActiveLivenessTimeoutMs(1), 20000)
  assert.equal(p2pActiveLivenessTimeoutMs(2), 15000)
  assert.equal(p2pActiveLivenessTimeoutMs(3), 10000)
})

test('a qualified probe remains monitored until activation', () => {
  assert.equal(requiresP2pLiveness('probing', false), false)
  assert.equal(requiresP2pLiveness('probing', true), true)
  assert.equal(requiresP2pLiveness('p2p', false), true)
  assert.equal(requiresP2pLiveness('sfu', true), false)
})

test('P2P remote feed identity remains stable across replacement tracks', () => {
  assert.equal(p2pRemoteFeedKey('peer-1', 'camera'), 'p2p:peer-1:camera')
  assert.equal(
    p2pRemoteFeedKey('peer-1', 'camera'),
    p2pRemoteFeedKey('peer-1', 'camera'),
  )
  assert.notEqual(
    p2pRemoteFeedKey('peer-1', 'camera'),
    p2pRemoteFeedKey('peer-1', 'screen'),
  )
})

test('P2P signaling accepts explicit source removal and rejects unknown sources', () => {
  assert.equal(validP2pSignal({ sourceRemoved: { source: 'camera' } }), true)
  assert.equal(validP2pSignal({ sourceRemoved: { source: 'unknown' } }), false)
  assert.equal(validP2pSignal({ sourceRestored: { source: 'camera' } }), true)
  assert.equal(validP2pSignal({ sourceRestored: { source: 'unknown' } }), false)
})

test('P2P media readiness requires every expected RTP direction to flow', async () => {
  const pc = {
    getStats: async () =>
      new Map([
        ['out', { type: 'outbound-rtp', bytesSent: 10 }],
        ['in', { type: 'inbound-rtp', bytesReceived: 20 }],
      ]),
  }
  assert.equal(await hasRequiredMediaFlow(pc, 1, 1), true)
  assert.equal(await hasRequiredMediaFlow(pc, 2, 1), false)
})

test('video RTP stats expose counters, codec, bitrate, fps, and decode time', () => {
  const previous = {
    timestamp: 1000,
    frameCounter: 100,
    bytes: 1000,
    totalCodecTime: 1,
  }
  const report = new Map([
    [
      'in',
      {
        id: 'in',
        type: 'inbound-rtp',
        kind: 'video',
        timestamp: 2000,
        codecId: 'codec',
        frameWidth: 1920,
        frameHeight: 1080,
        framesDecoded: 130,
        framesReceived: 132,
        framesDropped: 2,
        bytesReceived: 101000,
        packetsReceived: 900,
        packetsLost: 3,
        jitter: 0.004,
        totalDecodeTime: 1.3,
        pliCount: 2,
        firCount: 1,
        nackCount: 4,
      },
    ],
    ['codec', { id: 'codec', type: 'codec', mimeType: 'video/VP8' }],
  ])
  const { stats } = collectVideoRtpStats(report, 'inbound', {}, previous)
  assert.equal(stats.codec, 'video/VP8')
  assert.equal(stats.bitrateKbps, 800)
  assert.equal(stats.targetBitrateKbps, undefined)
  assert.equal(stats.decodedFps, 30)
  assert.ok(Math.abs(stats.decodeTimeMs - 10) < 0.0001)
  assert.equal(stats.packetsLost, 3)
})

test('peer connection stats work without a transport selected-pair reference', async () => {
  const report = new Map([
    [
      'pair',
      {
        id: 'pair',
        type: 'candidate-pair',
        state: 'succeeded',
        nominated: true,
        localCandidateId: 'local',
        remoteCandidateId: 'remote',
        currentRoundTripTime: 0.012,
      },
    ],
    [
      'local',
      {
        id: 'local',
        type: 'local-candidate',
        address: '2001:db8::1',
        port: 5000,
        protocol: 'udp',
        candidateType: 'host',
      },
    ],
    [
      'remote',
      {
        id: 'remote',
        type: 'remote-candidate',
        ip: '2001:db8::2',
        port: 6000,
        protocol: 'udp',
        candidateType: 'srflx',
      },
    ],
    [
      'audio',
      {
        id: 'audio',
        type: 'inbound-rtp',
        kind: 'audio',
        packetsReceived: 100,
        packetsLost: 2,
        bytesReceived: 8000,
        jitter: 0.003,
      },
    ],
  ])
  const stats = await collectPeerConnectionStats(
    {
      connectionState: 'connected',
      iceConnectionState: 'connected',
      signalingState: 'stable',
      getStats: async () => report,
    },
    'p2p:peer-2',
  )

  assert.equal(stats.kind, 'p2p:peer-2')
  assert.equal(stats.candidatePair.remote.address, '2001:db8::2')
  assert.equal(stats.candidatePair.packetLoss, null)
  assert.equal(stats.candidatePair.receivedPacketLoss, (2 * 100) / 102)
  assert.equal(stats.inboundAudio.jitter, 0.003)
})

test('peer connection attributes only remotely reported outbound loss to the local edge', async () => {
  const report = new Map([
    ['pair', { id: 'pair', type: 'candidate-pair', state: 'succeeded', nominated: true }],
    ['outbound', { id: 'outbound', type: 'outbound-rtp', kind: 'video', packetsSent: 100 }],
    ['remote-inbound', { id: 'remote-inbound', type: 'remote-inbound-rtp', kind: 'video', fractionLost: 0.08 }]
  ])
  const stats = await collectPeerConnectionStats({
    connectionState: 'connected',
    iceConnectionState: 'connected',
    signalingState: 'stable',
    getStats: async () => report
  }, 'send')
  assert.equal(stats.candidatePair.packetLoss, 8)
  assert.equal(stats.candidatePair.receivedPacketLoss, null)
})
