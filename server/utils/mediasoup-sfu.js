import * as mediasoup from 'mediasoup'
import { usePocketBaseAdmin } from './pocketbase'

const mediaCodecs = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
    parameters: {
      minptime: 10,
      useinbandfec: 1
    }
  }
]

const stateKey = Symbol.for('dspeak.mediasoup.sfu')

function send(peer, type, data) {
  peer.send(JSON.stringify({ type, data }))
}

function publicTransportData(transport) {
  return {
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
    sctpParameters: transport.sctpParameters
  }
}

function serializeError(error) {
  return error instanceof Error ? error.message : String(error)
}

async function createState(config) {
  const worker = await mediasoup.createWorker({
    logLevel: process.env.NODE_ENV === 'production' ? 'warn' : 'debug',
    rtcMinPort: config.rtcMinPort,
    rtcMaxPort: config.rtcMaxPort
  })

  const state = {
    worker,
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

async function getState() {
  const runtimeConfig = useRuntimeConfig().mediasoup
  const config = {
    listenIp: process.env.MEDIASOUP_LISTEN_IP || runtimeConfig.listenIp,
    announcedAddress: process.env.MEDIASOUP_ANNOUNCED_ADDRESS || runtimeConfig.announcedAddress,
    rtcMinPort: Number(process.env.MEDIASOUP_RTC_MIN_PORT || runtimeConfig.rtcMinPort),
    rtcMaxPort: Number(process.env.MEDIASOUP_RTC_MAX_PORT || runtimeConfig.rtcMaxPort)
  }
  if (!globalThis[stateKey]) {
    globalThis[stateKey] = createState(config).catch((error) => {
      delete globalThis[stateKey]
      throw error
    })
  }
  return globalThis[stateKey]
}

async function getRoom(state, channelId) {
  let room = state.rooms.get(channelId)
  if (!room) {
    room = {
      id: channelId,
      router: await state.worker.createRouter({ mediaCodecs }),
      sessions: new Map()
    }
    state.rooms.set(channelId, room)
  }
  return room
}

function producerSnapshot(room) {
  const producers = []
  const producerUserMap = {}

  for (const session of room.sessions.values()) {
    for (const producer of session.producers.values()) {
      producers.push(producer.id)
      producerUserMap[producer.id] = session.userId
    }
  }

  return { producers, producerUserMap }
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
      producerUserMap: snapshot.producerUserMap
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
  }

  persistMediaPresence(session.room).catch(error => console.error('[SFU] failed to persist presence', error))
  const userStillConnected = [...session.room.sessions.values()].some(candidate => String(candidate.userId) === String(session.userId))
  if (!userStillConnected) {
    removeMediaUserState(session.userId, session.room.id).catch(error => console.error('[SFU] failed to remove user state', error))
  }
}

async function createTransport(state, session) {
  const { listenIp, announcedAddress } = state.config
  if ((listenIp === '0.0.0.0' || listenIp === '::') && !announcedAddress) {
    throw new Error('MEDIASOUP_ANNOUNCED_ADDRESS is required when binding to all interfaces')
  }

  const listenInfo = {
    protocol: 'udp',
    ip: listenIp,
    portRange: {
      min: state.config.rtcMinPort,
      max: state.config.rtcMaxPort
    }
  }
  if (announcedAddress) listenInfo.announcedAddress = announcedAddress

  const transport = await session.room.router.createWebRtcTransport({
    listenInfos: [listenInfo, { ...listenInfo, protocol: 'tcp' }],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate: 1_000_000,
    appData: { peerId: session.peer.id }
  })

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

    case 'get-rtp-capabilities':
      send(session.peer, 'rtp-capabilities', session.room.router.rtpCapabilities)
      return

    case 'client-rtp-capabilities':
      session.rtpCapabilities = data.rtpCapabilities
      send(session.peer, 'rtp-capabilities-ack', { accepted: true })
      return

    case 'create-transport': {
      const transport = await createTransport(state, session)
      send(session.peer, 'transport-params', publicTransportData(transport))
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

      const producer = await transport.produce({
        kind: data.kind,
        rtpParameters: data.rtpParameters,
        appData: { userId: session.userId }
      })
      session.producers.set(producer.id, producer)

      producer.on('transportclose', () => session.producers.delete(producer.id))
      producer.on('close', () => session.producers.delete(producer.id))

      send(session.peer, 'producer-id', { id: producer.id })
      for (const other of session.room.sessions.values()) {
        if (other !== session) {
          send(other.peer, 'new-producer', {
            producerId: producer.id,
            userId: session.userId
          })
        }
      }
      broadcastChannelState(session.room)
      return
    }

    case 'consume': {
      const transport = session.transports.get(data.transportId)
      if (!transport) throw new Error('Transport not found')
      const capabilities = data.rtpCapabilities || session.rtpCapabilities
      if (!capabilities) throw new Error('Client RTP capabilities are required')
      if (!session.room.router.canConsume({ producerId: data.producerId, rtpCapabilities: capabilities })) {
        throw new Error('Cannot consume this producer with the supplied RTP capabilities')
      }

      const owner = [...session.room.sessions.values()].find(candidate => candidate.producers.has(data.producerId))
      if (!owner) throw new Error('Producer not found in this channel')
      if (owner === session) throw new Error('A peer cannot consume its own producer')

      const consumer = await transport.consume({
        producerId: data.producerId,
        rtpCapabilities: capabilities,
        paused: false,
        appData: { userId: owner.userId }
      })
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
        userId: owner.userId
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
    rtpCapabilities: null,
    queue: Promise.resolve(),
    closed: false
  }

  state.sessions.set(peer.id, session)
  room.sessions.set(peer.id, session)
  send(peer, 'connected', { userId, channelId })
  broadcastChannelState(room)
  await persistMediaPresence(room)
  await createMediaUserState(userId, channelId)
}

export async function handleSfuPeerMessage(peer, rawMessage) {
  const state = await getState()
  const session = state.sessions.get(peer.id)
  if (!session) return

  session.queue = session.queue.then(async () => {
    try {
      const message = JSON.parse(rawMessage.text())
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
    consumers
  }
}
