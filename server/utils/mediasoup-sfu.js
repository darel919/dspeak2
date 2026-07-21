import * as mediasoup from 'mediasoup'
import { usePocketBaseAdmin } from './pocketbase'
import { buildPublicIceCandidates, buildWebRtcListenInfos } from './ice-candidates'
import { mediaCodecs } from './mediasoup-codecs'
import { assertTransportDirection, buildConsumerOptions, buildWebRtcTransportOptions } from './mediasoup-transport'
import { allClientsReady, hasCompleteMesh, membershipTopology } from './media-transition'

const maxP2pParticipants = 4

const stateKey = Symbol.for('dspeak.mediasoup.sfu')

function send(peer, type, data) {
  peer.send(JSON.stringify({ type, data }))
}

async function publicTransportData(transport, config) {
  return {
    id: transport.id,
    direction: transport.appData.direction,
    iceParameters: transport.iceParameters,
    iceCandidates: await buildPublicIceCandidates(transport.iceCandidates, config),
    dtlsParameters: transport.dtlsParameters,
    sctpParameters: transport.sctpParameters
  }
}

function serializeError(error) {
  return error instanceof Error ? error.message : String(error)
}

function validP2pSignal(signal) {
  if (!signal || typeof signal !== 'object') return false
  if (signal.description) {
    const type = String(signal.description.type || '')
    const sdp = String(signal.description.sdp || '')
    return (type === 'offer' || type === 'answer' || type === 'rollback') && sdp.length <= 500000
  }
  if (signal.candidate) {
    return String(signal.candidate.candidate || '').length <= 4096 && String(signal.candidate.sdpMid || '').length <= 100
  }
  if (signal.source) {
    return String(signal.source.trackId || '').length <= 200 && ['audio', 'camera', 'screen', 'screen-audio', 'video'].includes(String(signal.source.source || ''))
  }
  return false
}

async function createState(config) {
  const worker = await mediasoup.createWorker({
    logLevel: process.env.NODE_ENV === 'production' ? 'warn' : 'debug'
  })

  const webRtcServer = await worker.createWebRtcServer({
    listenInfos: buildWebRtcListenInfos(config)
  })

  const state = {
    worker,
    webRtcServer,
    rooms: new Map(),
    sessions: new Map(),
    config
  }

  worker.on('died', (error) => {
    console.error('[SFU] mediasoup worker died', error)
    for (const session of state.sessions.values()) {
      send(session.peer, 'server-shutdown', { reason: 'media worker stopped' })
      session.peer.close(1011, 'Media worker stopped')
    }
    state.sessions.clear()
    state.rooms.clear()
    delete globalThis[stateKey]
  })

  return state
}

async function getState(resolvedConfig) {
  const runtimeConfig = useRuntimeConfig().mediasoup
  const config = resolvedConfig || {
    listenIp: process.env.MEDIASOUP_LISTEN_IP || runtimeConfig.listenIp,
    announcedAddress: process.env.MEDIASOUP_ANNOUNCED_ADDRESS || runtimeConfig.announcedAddress,
    rtcPort: Number(process.env.MEDIASOUP_RTC_PORT || runtimeConfig.rtcPort),
    announcedPort: Number(process.env.MEDIASOUP_ANNOUNCED_PORT || runtimeConfig.announcedPort || runtimeConfig.rtcPort),
    directAddress: process.env.MEDIASOUP_DIRECT_ADDRESS || runtimeConfig.directAddress,
    directPort: Number(process.env.MEDIASOUP_DIRECT_PORT || runtimeConfig.directPort || runtimeConfig.rtcPort)
  }
  if (!globalThis[stateKey]) {
    globalThis[stateKey] = createState(config).catch((error) => {
      delete globalThis[stateKey]
      throw error
    })
  }
  return globalThis[stateKey]
}

export async function initializeSfu(config) {
  return getState(config)
}

export async function closeSfu() {
  const statePromise = globalThis[stateKey]
  if (!statePromise) return

  const state = await statePromise
  for (const session of [...state.sessions.values()]) closeSession(state, session)
  state.worker.close()
  delete globalThis[stateKey]
}

async function getRoom(state, channelId) {
  let room = state.rooms.get(channelId)
  if (!room) {
    room = {
      id: channelId,
      router: await state.worker.createRouter({ mediaCodecs }),
      sessions: new Map(),
      topology: {
        mode: 'idle',
        epoch: 0,
        reason: 'waiting-for-peer',
        activatedAt: Date.now(),
        readiness: new Map(),
        transitionReadiness: new Map(),
        sourceRevision: 0,
        target: null,
        recovering: false,
        recoveryTimer: null,
        activationTimer: null,
        transitionTimer: null
      }
    }
    state.rooms.set(channelId, room)
  } else {
    if (!(room.topology.readiness instanceof Map)) room.topology.readiness = new Map()
    if (!(room.topology.transitionReadiness instanceof Map)) room.topology.transitionReadiness = new Map()
    room.topology.sourceRevision ||= 0
    room.topology.target ||= null
    room.topology.recoveryTimer ||= null
    room.topology.activationTimer ||= null
    room.topology.transitionTimer ||= null
  }
  return room
}

function topologyPayload(room) {
  return {
    mode: room.topology.mode,
    epoch: room.topology.epoch,
    reason: room.topology.reason,
    activatedAt: room.topology.activatedAt,
    target: room.topology.target,
    sourceRevision: room.topology.sourceRevision,
    peers: [...room.sessions.values()].map(session => ({
      peerId: session.peer.id,
      userId: session.userId,
      sources: [...session.sources]
    }))
  }
}

function broadcastTopology(room) {
  const data = topologyPayload(room)
  for (const session of room.sessions.values()) send(session.peer, 'topology-state', data)
}

function setTopology(room, mode, reason, target = null) {
  if (room.topology.recoveryTimer) clearTimeout(room.topology.recoveryTimer)
  if (room.topology.activationTimer) clearTimeout(room.topology.activationTimer)
  if (room.topology.transitionTimer) clearTimeout(room.topology.transitionTimer)
  room.topology.recoveryTimer = null
  room.topology.activationTimer = null
  room.topology.transitionTimer = null
  room.topology.mode = mode
  room.topology.target = target
  room.topology.reason = reason
  room.topology.epoch += 1
  room.topology.activatedAt = Date.now()
  room.topology.readiness.clear()
  room.topology.transitionReadiness.clear()
  broadcastTopology(room)
}

function scheduleDirectRecovery(room) {
  if (room.sessions.size < 2 || room.sessions.size > maxP2pParticipants) return
  room.topology.recoveryTimer = setTimeout(() => {
    if (room.topology.mode !== 'sfu' || room.sessions.size < 2 || room.sessions.size > maxP2pParticipants) return
    room.topology.recovering = true
    setTopology(room, 'probing', 'checking-recovered-direct-path')
    room.topology.recovering = true
  }, 10000)
}

function beginTransition(room, target, reason) {
  setTopology(room, 'switching', reason, target)
  const epoch = room.topology.epoch
  room.topology.transitionTimer = setTimeout(() => {
    if (room.topology.epoch !== epoch || room.topology.mode !== 'switching') return
    if (target === 'sfu') {
      beginTransition(room, 'sfu', 'retrying-sfu-preparation')
      return
    }
    fallbackToSfu(room, 'direct-transition-timeout')
  }, 10000)
}

function maybeActivateTransition(room) {
  if (room.topology.mode !== 'switching' || !room.topology.target) return
  const ready = allClientsReady([...room.sessions.keys()], room.topology.transitionReadiness, room.topology.sourceRevision)
  if (!ready) return
  const target = room.topology.target
  setTopology(room, target, `all-clients-ready-${target}`)
  if (target === 'sfu') scheduleDirectRecovery(room)
}

function reconcileTopology(room, reason) {
  const count = room.sessions.size
  const next = membershipTopology(count)
  if (next === 'idle') {
    room.topology.recovering = false
    setTopology(room, 'idle', 'waiting-for-peer')
    return
  }
  if (next === 'sfu') {
    room.topology.recovering = false
    if (room.topology.mode === 'sfu') broadcastTopology(room)
    else beginTransition(room, 'sfu', 'participant-limit')
    return
  }
  room.topology.recovering = false
  setTopology(room, 'probing', reason || 'checking-direct-path')
}

function fallbackToSfu(room, reason) {
  room.topology.recovering = false
  beginTransition(room, 'sfu', reason)
}

function maybeActivateP2p(room) {
  const peerIds = [...room.sessions.keys()].sort()
  if (peerIds.length < 2 || peerIds.length > maxP2pParticipants) return
  if (room.topology.readiness.size !== peerIds.length) return
  const complete = hasCompleteMesh(peerIds, room.topology.readiness)
  if (!complete) return
  if (!room.topology.recovering) {
    beginTransition(room, 'p2p', 'complete-direct-mesh')
    return
  }
  if (room.topology.activationTimer) return
  room.topology.activationTimer = setTimeout(() => {
    room.topology.activationTimer = null
    if (room.topology.mode !== 'probing' || room.topology.readiness.size !== peerIds.length) return
    beginTransition(room, 'p2p', 'recovered-direct-mesh')
  }, 10000)
}

function producerSnapshot(room) {
  const producers = []
  const producerUserMap = {}
  const producerSourceMap = {}

  for (const session of room.sessions.values()) {
    for (const producer of session.producers.values()) {
      producers.push(producer.id)
      producerUserMap[producer.id] = session.userId
      producerSourceMap[producer.id] = producer.appData?.source || producer.kind
    }
  }

  return { producers, producerUserMap, producerSourceMap }
}

function broadcastChannelState(room) {
  const snapshot = producerSnapshot(room)
  const data = {
    inRoom: [...room.sessions.values()].map(session => session.userId),
    ...snapshot
  }

  for (const session of room.sessions.values()) {
    send(session.peer, 'currentlyInChannel', data)
    send(session.peer, 'available-producers', {
      producers: snapshot.producers,
      producerUserMap: snapshot.producerUserMap,
      producerSourceMap: snapshot.producerSourceMap
    })
  }
}

async function persistMediaPresence(room) {
  const pb = await usePocketBaseAdmin()
  const userIds = [...new Set([...room.sessions.values()].map(session => String(session.userId)))]
  await pb.collection('dspeak_rooms_channels').update(room.id, { inRoom: userIds })
}

async function createMediaUserState(userId, channelId) {
  const pb = await usePocketBaseAdmin()
  const existing = await pb.collection('dspeak_users_state').getFullList({
    filter: `user = '${userId}' && connected = '${channelId}'`
  })
  if (!existing.length) {
    await pb.collection('dspeak_users_state').create({
      user: userId,
      connected: channelId,
      muted: false,
      deafened: false,
      audioBroadcasting: false,
      videoSharing: false,
      screenSharing: false
    })
  }
}

async function removeMediaUserState(userId, channelId) {
  const pb = await usePocketBaseAdmin()
  const existing = await pb.collection('dspeak_users_state').getFullList({
    filter: `user = '${userId}' && connected = '${channelId}'`
  })
  for (const record of existing) await pb.collection('dspeak_users_state').delete(record.id)
}

function closeSession(state, session) {
  if (!session || session.closed) return
  session.closed = true

  for (const producer of session.producers.values()) producer.close()
  for (const consumer of session.consumers.values()) consumer.close()
  for (const transport of session.transports.values()) transport.close()

  session.producers.clear()
  session.consumers.clear()
  session.transports.clear()
  session.room.sessions.delete(session.peer.id)
  state.sessions.delete(session.peer.id)

  if (session.room.sessions.size === 0) {
    session.room.router.close()
    state.rooms.delete(session.room.id)
  } else {
    broadcastChannelState(session.room)
    reconcileTopology(session.room, 'membership-changed')
  }

  persistMediaPresence(session.room).catch(error => console.error('[SFU] failed to persist presence', error))
  const userStillConnected = [...session.room.sessions.values()].some(candidate => String(candidate.userId) === String(session.userId))
  if (!userStillConnected) {
    removeMediaUserState(session.userId, session.room.id).catch(error => console.error('[SFU] failed to remove user state', error))
  }
}

async function createTransport(state, session, direction) {
  const transport = await session.room.router.createWebRtcTransport(
    buildWebRtcTransportOptions(state.webRtcServer, session.peer.id, direction)
  )

  session.transports.set(transport.id, transport)
  transport.on('routerclose', () => session.transports.delete(transport.id))
  transport.on('listenserverclose', () => session.transports.delete(transport.id))
  return transport
}

async function handleMessage(state, session, message) {
  const { type, data = {} } = message || {}

  switch (type) {
    case 'ping':
      send(session.peer, 'pong', { timestamp: Date.now() })
      return

    case 'media-sources': {
      const allowed = new Set(['audio', 'camera', 'screen', 'screen-audio'])
      const sources = Array.isArray(data.sources) ? data.sources.map(String).filter(source => allowed.has(source)) : []
      const previous = [...session.sources].sort().join(',')
      const next = [...sources].sort().join(',')
      if (previous === next) return
      session.sources = new Set(sources)
      session.room.topology.sourceRevision += 1
      session.room.topology.transitionReadiness.clear()
      broadcastTopology(session.room)
      return
    }

    case 'p2p-signal': {
      const targetPeerId = String(data.targetPeerId || '')
      const target = session.room.sessions.get(targetPeerId)
      if (!target || target === session) return
      if (Number(data.epoch) !== session.room.topology.epoch) return
      const signal = data.signal
      if (!validP2pSignal(signal)) return
      send(target.peer, 'p2p-signal', {
        fromPeerId: session.peer.id,
        epoch: session.room.topology.epoch,
        signal
      })
      return
    }

    case 'p2p-ready': {
      if (session.room.topology.mode !== 'probing') return
      if (Number(data.epoch) !== session.room.topology.epoch) return
      const expected = new Set([...session.room.sessions.keys()].filter(peerId => peerId !== session.peer.id))
      const qualified = new Set(
        (Array.isArray(data.qualifiedPeerIds) ? data.qualifiedPeerIds : [])
          .map(String)
          .filter(peerId => expected.has(peerId))
      )
      if (qualified.size !== expected.size) return
      session.room.topology.readiness.set(session.peer.id, qualified)
      maybeActivateP2p(session.room)
      return
    }

    case 'topology-ready': {
      if (session.room.topology.mode !== 'switching') return
      if (Number(data.epoch) !== session.room.topology.epoch) return
      if (String(data.target || '') !== session.room.topology.target) return
      if (Number(data.sourceRevision) !== session.room.topology.sourceRevision) return
      session.room.topology.transitionReadiness.set(session.peer.id, session.room.topology.sourceRevision)
      maybeActivateTransition(session.room)
      return
    }

    case 'topology-failed': {
      if (session.room.topology.mode !== 'switching') return
      if (Number(data.epoch) !== session.room.topology.epoch) return
      if (String(data.target || '') !== session.room.topology.target) return
      if (session.room.topology.target === 'p2p') {
        fallbackToSfu(session.room, 'client-direct-preparation-failed')
      } else {
        clearTimeout(session.room.topology.transitionTimer)
        const epoch = session.room.topology.epoch
        session.room.topology.transitionTimer = setTimeout(() => {
          if (session.room.topology.epoch === epoch && session.room.topology.mode === 'switching') {
            beginTransition(session.room, 'sfu', 'retrying-client-sfu-preparation')
          }
        }, 500)
      }
      return
    }

    case 'p2p-failed': {
      if (Number(data.epoch) !== session.room.topology.epoch) return
      if (session.room.sessions.size >= 2) fallbackToSfu(session.room, 'direct-path-unavailable')
      return
    }

    case 'peer-rtt-probe': {
      const probeId = String(data.probeId || '')
      if (!probeId || probeId.length > 100) return
      for (const candidate of session.room.sessions.values()) {
        if (candidate.peer.id === session.peer.id) continue
        send(candidate.peer, 'peer-rtt-probe', {
          probeId,
          originPeerId: session.peer.id
        })
      }
      return
    }

    case 'peer-rtt-echo': {
      const probeId = String(data.probeId || '')
      const originPeerId = String(data.originPeerId || '')
      const origin = session.room.sessions.get(originPeerId)
      if (!probeId || !origin) return
      send(origin.peer, 'peer-rtt-result', {
        probeId,
        responderUserId: session.userId
      })
      return
    }

    case 'client-sfu-rtt': {
      const rttMs = Number(data.rttMs)
      if (!Number.isFinite(rttMs) || rttMs < 0 || rttMs > 60000) return
      for (const candidate of session.room.sessions.values()) {
        send(candidate.peer, 'participant-sfu-rtt', {
          userId: session.userId,
          rttMs
        })
      }
      return
    }

    case 'get-rtp-capabilities':
      send(session.peer, 'rtp-capabilities', session.room.router.rtpCapabilities)
      return

    case 'client-rtp-capabilities':
      session.rtpCapabilities = data.rtpCapabilities
      send(session.peer, 'rtp-capabilities-ack', { accepted: true })
      return

    case 'create-transport': {
      const direction = String(data.type || '')
      const transport = await createTransport(state, session, direction)
      send(session.peer, 'transport-params', await publicTransportData(transport, state.config))
      return
    }

    case 'connect-transport': {
      const transport = session.transports.get(data.transportId)
      if (!transport) throw new Error('Transport not found')
      await transport.connect({ dtlsParameters: data.dtlsParameters })
      send(session.peer, 'transport-connected', { transportId: transport.id })
      return
    }

    case 'produce': {
      const transport = session.transports.get(data.transportId)
      if (!transport) throw new Error('Transport not found')
      assertTransportDirection(transport, 'send', 'Producing')

      const producer = await transport.produce({
        kind: data.kind,
        rtpParameters: data.rtpParameters,
        appData: {
          userId: session.userId,
          source: data.appData?.source || data.kind
        }
      })
      session.producers.set(producer.id, producer)

      producer.on('transportclose', () => session.producers.delete(producer.id))
      producer.on('close', () => session.producers.delete(producer.id))

      send(session.peer, 'producer-id', { id: producer.id })
      for (const other of session.room.sessions.values()) {
        if (other !== session) {
          send(other.peer, 'new-producer', {
            producerId: producer.id,
            userId: session.userId,
            source: producer.appData.source
          })
        }
      }
      broadcastChannelState(session.room)
      return
    }

    case 'close-producer': {
      const producer = session.producers.get(data.producerId)
      if (!producer) return
      session.producers.delete(producer.id)
      producer.close()
      broadcastChannelState(session.room)
      return
    }

    case 'consume': {
      const transport = session.transports.get(data.transportId)
      if (!transport) throw new Error('Transport not found')
      assertTransportDirection(transport, 'recv', 'Consuming')
      const capabilities = data.rtpCapabilities || session.rtpCapabilities
      if (!capabilities) throw new Error('Client RTP capabilities are required')
      if (!session.room.router.canConsume({ producerId: data.producerId, rtpCapabilities: capabilities })) {
        throw new Error('Cannot consume this producer with the supplied RTP capabilities')
      }
      if ([...session.consumers.values()].some(consumer => consumer.producerId === data.producerId)) {
        throw new Error('Producer is already consumed by this peer')
      }

      const owner = [...session.room.sessions.values()].find(candidate => candidate.producers.has(data.producerId))
      if (!owner) throw new Error('Producer not found in this channel')
      if (owner === session) throw new Error('A peer cannot consume its own producer')

      const consumer = await transport.consume(
        buildConsumerOptions(data.producerId, capabilities, owner.userId)
      )
      session.consumers.set(consumer.id, consumer)
      consumer.on('transportclose', () => session.consumers.delete(consumer.id))
      consumer.on('producerclose', () => {
        session.consumers.delete(consumer.id)
        send(session.peer, 'producer-closed', { producerId: data.producerId })
      })

      send(session.peer, 'consumer-params', {
        id: consumer.id,
        producerId: data.producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        userId: owner.userId,
        source: owner.producers.get(data.producerId)?.appData?.source || consumer.kind,
        producerPaused: consumer.producerPaused
      })
      return
    }

    case 'resume-consumer': {
      const consumer = session.consumers.get(data.consumerId)
      if (!consumer) throw new Error('Consumer not found')
      await consumer.resume()
      send(session.peer, 'consumer-resumed', {
        consumerId: consumer.id,
        producerId: consumer.producerId
      })
      return
    }

    default:
      throw new Error(`Unsupported message type: ${String(type)}`)
  }
}

export async function openSfuPeer(peer) {
  const url = new URL(peer.request.url)
  const userId = url.searchParams.get('auth')
  const channelId = url.searchParams.get('channelId')
  if (!userId || !channelId) {
    peer.close(1008, 'auth and channelId are required')
    return
  }

  const pb = await usePocketBaseAdmin()
  const channel = await pb.collection('dspeak_rooms_channels').getOne(channelId)
  if (!channel.isMedia) {
    peer.close(1008, 'Channel is not a media channel')
    return
  }
  const backendRoom = await pb.collection('dspeak_rooms').getOne(channel.room)
  if (!(backendRoom.members || []).map(String).includes(String(userId))) {
    peer.close(1008, 'Access denied to this room')
    return
  }

  const state = await getState()
  const room = await getRoom(state, channelId)
  const session = {
    peer,
    userId,
    room,
    transports: new Map(),
    producers: new Map(),
    consumers: new Map(),
    sources: new Set(),
    rtpCapabilities: null,
    queue: Promise.resolve(),
    closed: false
  }

  state.sessions.set(peer.id, session)
  room.sessions.set(peer.id, session)
  send(peer, 'connected', { userId, channelId, peerId: peer.id })
  broadcastChannelState(room)
  reconcileTopology(room, 'membership-changed')
  await persistMediaPresence(room)
  await createMediaUserState(userId, channelId)
}

export async function handleSfuPeerMessage(peer, rawMessage) {
  const state = await getState()
  const session = state.sessions.get(peer.id)
  if (!session) return

  session.queue = session.queue.then(async () => {
    try {
      const payload = rawMessage.text()
      if (payload.length > 600000) throw new Error('Signaling message exceeds the maximum size')
      const message = JSON.parse(payload)
      await handleMessage(state, session, message)
    } catch (error) {
      console.error('[SFU] signaling error', error)
      send(peer, 'error', { message: serializeError(error), fatal: false })
    }
  })
  await session.queue
}

export async function closeSfuPeer(peer) {
  const state = await getState()
  closeSession(state, state.sessions.get(peer.id))
}

export async function getSfuMetrics() {
  const state = await getState()
  let transports = 0
  let producers = 0
  let consumers = 0
  let p2pRooms = 0
  let sfuRooms = 0
  let probingRooms = 0
  for (const room of state.rooms.values()) {
    if (room.topology.mode === 'p2p') p2pRooms += 1
    if (room.topology.mode === 'sfu') sfuRooms += 1
    if (room.topology.mode === 'probing') probingRooms += 1
  }
  for (const session of state.sessions.values()) {
    transports += session.transports.size
    producers += session.producers.size
    consumers += session.consumers.size
  }
  return {
    workerPid: state.worker.pid,
    rooms: state.rooms.size,
    peers: state.sessions.size,
    transports,
    producers,
    consumers,
    p2pRooms,
    sfuRooms,
    probingRooms
  }
}
