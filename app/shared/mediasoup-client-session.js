import { Device } from 'mediasoup-client'
import { buildVideoProduceOptions } from './video-settings.js'
import { buildVoiceProducerOptions } from './voice-transport.js'

function waitFor(map, key, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      map.delete(key)
      reject(new Error(`${label} timed out`))
    }, timeoutMs)
    map.set(key, value => {
      clearTimeout(timer)
      resolve(value)
    })
  })
}

export class MediasoupClientSession {
  constructor({ send, iceServers, onRemoteTrack, onRemoteTrackEnded, onStateChange }) {
    this.send = send
    this.iceServers = iceServers
    this.onRemoteTrack = onRemoteTrack
    this.onRemoteTrackEnded = onRemoteTrackEnded
    this.onStateChange = onStateChange
    this.device = null
    this.sendTransport = null
    this.recvTransport = null
    this.sources = new Map()
    this.producers = new Map()
    this.consumers = new Map()
    this.pending = new Map()
    this.pendingProduce = []
    this.pendingConsumers = new Set()
    this.readyPromise = null
    this.readyResolve = null
    this.readyReject = null
    this.initializationTimer = null
    this.closed = false
  }

  async initialize() {
    if (this.readyPromise) return this.readyPromise
    this.closed = false
    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
    })
    this.initializationTimer = setTimeout(() => {
      const reject = this.readyReject
      this.resetReadiness()
      reject?.(new Error('SFU initialization timed out'))
    }, 10000)
    this.send({ type: 'get-rtp-capabilities' })
    return this.readyPromise
  }

  async handle(type, data) {
    if (this.closed) return false
    if (type === 'rtp-capabilities') {
      this.device = new Device()
      await this.device.load({ routerRtpCapabilities: data })
      this.send({ type: 'client-rtp-capabilities', data: { rtpCapabilities: this.device.rtpCapabilities } })
      this.send({ type: 'create-transport', data: { type: 'send' } })
      this.send({ type: 'create-transport', data: { type: 'recv' } })
      return true
    }
    if (type === 'transport-params') {
      this.createTransport(data)
      if (this.sendTransport && this.recvTransport) {
        clearTimeout(this.initializationTimer)
        this.initializationTimer = null
        this.readyResolve?.()
        this.readyResolve = null
        this.readyReject = null
        for (const entry of this.sources.values()) await this.publish(entry)
        for (const producerId of [...this.pendingConsumers]) this.requestConsumer(producerId)
      }
      return true
    }
    if (type === 'transport-connected') {
      this.pending.get(`connect:${data.transportId}`)?.()
      this.pending.delete(`connect:${data.transportId}`)
      return true
    }
    if (type === 'producer-id') {
      const request = this.pendingProduce.shift()
      if (request) {
        clearTimeout(request.timer)
        request.resolve({ id: data.id })
      }
      return true
    }
    if (type === 'consumer-params') {
      await this.createConsumer(data)
      return true
    }
    if (type === 'new-producer') {
      this.requestConsumer(data.producerId)
      return true
    }
    if (type === 'available-producers') {
      for (const producerId of data?.producers || []) this.requestConsumer(producerId)
      return true
    }
    if (type === 'producer-closed') {
      this.closeConsumerByProducer(data.producerId)
      return true
    }
    return false
  }

  createTransport(data) {
    const options = {
      id: data.id,
      iceParameters: data.iceParameters,
      iceCandidates: data.iceCandidates,
      dtlsParameters: data.dtlsParameters,
      iceServers: this.iceServers
    }
    if (data.direction === 'send' && !this.sendTransport) {
      this.sendTransport = this.device.createSendTransport(options)
      this.bindSendTransport()
    }
    if (data.direction === 'recv' && !this.recvTransport) {
      this.recvTransport = this.device.createRecvTransport(options)
      this.bindReceiveTransport()
    }
  }

  bindSendTransport() {
    this.sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
      waitFor(this.pending, `connect:${this.sendTransport.id}`, 8000, 'SFU send transport connection').then(callback, errback)
      this.send({ type: 'connect-transport', data: { transportId: this.sendTransport.id, dtlsParameters } })
    })
    this.sendTransport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
      const request = { resolve: callback, timer: null }
      request.timer = setTimeout(() => {
        const index = this.pendingProduce.indexOf(request)
        if (index >= 0) this.pendingProduce.splice(index, 1)
        errback(new Error('SFU produce timed out'))
      }, 8000)
      this.pendingProduce.push(request)
      this.send({ type: 'produce', data: { transportId: this.sendTransport.id, kind, rtpParameters, appData } })
    })
    this.sendTransport.on('connectionstatechange', state => this.onStateChange?.('send', state))
  }

  bindReceiveTransport() {
    this.recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
      waitFor(this.pending, `connect:${this.recvTransport.id}`, 8000, 'SFU receive transport connection').then(callback, errback)
      this.send({ type: 'connect-transport', data: { transportId: this.recvTransport.id, dtlsParameters } })
    })
    this.recvTransport.on('connectionstatechange', state => this.onStateChange?.('recv', state))
  }

  addSource(entry) {
    this.sources.set(entry.source, entry)
    if (this.sendTransport) return this.publish(entry)
    return Promise.resolve(null)
  }

  async publish(entry) {
    if (!this.sendTransport || this.producers.has(entry.source)) return this.producers.get(entry.source) || null
    const track = entry.track.clone()
    const settings = track.getSettings?.() || {}
    const options = track.kind === 'audio'
      ? { ...buildVoiceProducerOptions(track), stopTracks: false, appData: { source: entry.source } }
      : {
          track,
          stopTracks: false,
          appData: { source: entry.source },
          ...buildVideoProduceOptions({
            width: settings.width,
            height: settings.height,
            frameRate: settings.frameRate,
            screen: entry.source === 'screen'
          })
        }
    let producer
    try {
      producer = await this.sendTransport.produce(options)
    } catch (error) {
      track.stop()
      throw error
    }
    this.producers.set(entry.source, { producer, track, source: entry.source })
    producer.on('transportclose', () => this.producers.delete(entry.source))
    return producer
  }

  removeSource(source) {
    this.sources.delete(source)
    const entry = this.producers.get(source)
    if (!entry) return
    this.producers.delete(source)
    this.send({ type: 'close-producer', data: { producerId: entry.producer.id } })
    entry.producer.close()
    entry.track.stop()
  }

  requestConsumer(producerId) {
    if (!producerId || [...this.producers.values()].some(entry => entry.producer.id === producerId)) return
    if (!this.recvTransport || !this.device?.loaded) {
      this.pendingConsumers.add(producerId)
      return
    }
    this.pendingConsumers.delete(producerId)
    if ([...this.consumers.values()].some(entry => entry.producerId === producerId)) return
    this.send({
      type: 'consume',
      data: {
        transportId: this.recvTransport.id,
        producerId,
        rtpCapabilities: this.device.rtpCapabilities
      }
    })
  }

  async createConsumer(data) {
    if (!this.recvTransport || this.consumers.has(data.id)) return
    const consumer = await this.recvTransport.consume({
      id: data.id,
      producerId: data.producerId,
      kind: data.kind,
      rtpParameters: data.rtpParameters,
      appData: { userId: data.userId, source: data.source }
    })
    const entry = {
      key: data.producerId,
      producerId: data.producerId,
      userId: data.userId,
      source: data.source || data.kind,
      provider: 'sfu',
      consumer,
      track: consumer.track,
      stream: new MediaStream([consumer.track])
    }
    this.consumers.set(consumer.id, entry)
    const close = () => {
      this.consumers.delete(consumer.id)
      this.onRemoteTrackEnded?.(entry)
    }
    consumer.on('transportclose', close)
    consumer.on('trackended', close)
    this.onRemoteTrack?.(entry)
    this.send({ type: 'resume-consumer', data: { consumerId: consumer.id } })
  }

  closeConsumerByProducer(producerId) {
    const match = [...this.consumers.values()].find(entry => entry.producerId === producerId)
    if (!match) return
    match.consumer.close()
    this.consumers.delete(match.consumer.id)
    this.onRemoteTrackEnded?.(match)
  }

  async stats() {
    const transports = []
    for (const [kind, transport] of [['send', this.sendTransport], ['recv', this.recvTransport]]) {
      const pc = transport?._handler?._pc
      if (!pc) continue
      transports.push(await this.peerConnectionStats(pc, kind))
    }
    return transports
  }

  async mediaReady(expectedInbound) {
    if (!this.sendTransport || !this.recvTransport) return false
    let outbound = 0
    let inbound = 0
    for (const entry of this.producers.values()) {
      const report = await entry.producer.getStats()
      if ([...report.values()].some(stat => stat.type === 'outbound-rtp' && Number(stat.bytesSent) > 0)) outbound += 1
    }
    for (const entry of this.consumers.values()) {
      const report = await entry.consumer.getStats()
      if ([...report.values()].some(stat => stat.type === 'inbound-rtp' && Number(stat.bytesReceived) > 0)) inbound += 1
    }
    return outbound >= this.sources.size && inbound >= expectedInbound
  }

  async peerConnectionStats(pc, kind) {
    const report = await pc.getStats()
    const byId = new Map()
    report.forEach(stat => byId.set(stat.id, stat))
    const transport = [...byId.values()].find(stat => stat.type === 'transport' && stat.selectedCandidatePairId)
    const pair = transport ? byId.get(transport.selectedCandidatePairId) : null
    const local = pair ? byId.get(pair.localCandidateId) : null
    const remote = pair ? byId.get(pair.remoteCandidateId) : null
    let packetsLost = 0
    let packetsReceived = 0
    for (const stat of byId.values()) {
      if (stat.type !== 'inbound-rtp' || stat.isRemote) continue
      packetsLost += Math.max(0, Number(stat.packetsLost) || 0)
      packetsReceived += Math.max(0, Number(stat.packetsReceived) || 0)
    }
    return {
      kind,
      pcStates: {
        connectionState: pc.connectionState,
        iceConnectionState: pc.iceConnectionState,
        signalingState: pc.signalingState
      },
      candidatePair: pair ? {
        currentRoundTripTime: pair.currentRoundTripTime ?? null,
        availableOutgoingBitrate: pair.availableOutgoingBitrate ?? null,
        bytesSent: pair.bytesSent ?? null,
        bytesReceived: pair.bytesReceived ?? null,
        packetsSent: pair.packetsSent ?? null,
        packetsReceived: pair.packetsReceived ?? null,
        packetLoss: packetsLost + packetsReceived > 0 ? packetsLost * 100 / (packetsLost + packetsReceived) : null,
        local: local ? { address: local.address || null, port: local.port, protocol: local.protocol, candidateType: local.candidateType } : null,
        remote: remote ? { address: remote.address || null, port: remote.port, protocol: remote.protocol, candidateType: remote.candidateType } : null
      } : null
    }
  }

  closeMedia() {
    for (const entry of this.producers.values()) {
      entry.producer.close()
      entry.track.stop()
    }
    for (const entry of this.consumers.values()) entry.consumer.close()
    this.producers.clear()
    this.consumers.clear()
    this.sendTransport?.close()
    this.recvTransport?.close()
    this.sendTransport = null
    this.recvTransport = null
    this.device = null
    this.readyReject?.(new Error('SFU session closed'))
    this.resetReadiness()
    this.pending.clear()
    for (const request of this.pendingProduce) clearTimeout(request.timer)
    this.pendingProduce.splice(0)
  }

  resetReadiness() {
    clearTimeout(this.initializationTimer)
    this.initializationTimer = null
    this.readyPromise = null
    this.readyResolve = null
    this.readyReject = null
  }

  close() {
    this.closed = true
    this.closeMedia()
    this.sources.clear()
    this.pendingConsumers.clear()
  }
}
