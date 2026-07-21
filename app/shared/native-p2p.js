import { P2P_QUALIFICATION_TIMEOUT_MS } from './rtc-topology.js'

function directIceServers(servers) {
  return (Array.isArray(servers) ? servers : []).flatMap((server) => {
    const urls = (Array.isArray(server.urls) ? server.urls : [server.urls]).filter(url => /^stun:/i.test(String(url || '')))
    return urls.length ? [{ urls }] : []
  })
}

async function selectedPairSnapshot(pc) {
  const report = await pc.getStats()
  const byId = new Map()
  report.forEach(stat => byId.set(stat.id, stat))
  let pair = null
  let transport = null
  report.forEach((stat) => {
    if (stat.type === 'transport' && stat.selectedCandidatePairId) transport = stat
  })
  if (transport) pair = byId.get(transport.selectedCandidatePairId) || null
  if (!pair) {
    report.forEach((stat) => {
      if (stat.type === 'candidate-pair' && stat.state === 'succeeded' && stat.nominated) pair = stat
    })
  }
  if (!pair) return null
  const local = byId.get(pair.localCandidateId) || null
  const remote = byId.get(pair.remoteCandidateId) || null
  return {
    id: pair.id,
    state: pair.state,
    nominated: !!pair.nominated,
    currentRoundTripTime: pair.currentRoundTripTime ?? null,
    availableOutgoingBitrate: pair.availableOutgoingBitrate ?? null,
    bytesSent: pair.bytesSent ?? null,
    bytesReceived: pair.bytesReceived ?? null,
    packetsSent: pair.packetsSent ?? null,
    packetsReceived: pair.packetsReceived ?? null,
    local: local ? {
      address: local.address || local.ip || null,
      protocol: local.protocol || null,
      candidateType: local.candidateType || null
    } : null,
    remote: remote ? {
      address: remote.address || remote.ip || null,
      protocol: remote.protocol || null,
      candidateType: remote.candidateType || null
    } : null
  }
}

async function hasRequiredMediaFlow(pc, outboundCount, inboundCount) {
  if (outboundCount === 0 && inboundCount === 0) return true
  const flow = await mediaFlowSnapshot(pc)
  return flow.outboundCount >= outboundCount && flow.inboundCount >= inboundCount
}

async function mediaFlowSnapshot(pc) {
  const report = await pc.getStats()
  let flowingOutbound = 0
  let flowingInbound = 0
  let bytes = 0
  report.forEach((stat) => {
    if (stat.type === 'outbound-rtp' && !stat.isRemote && Number(stat.bytesSent) > 0) {
      flowingOutbound += 1
      bytes += Number(stat.bytesSent)
    }
    if (stat.type === 'inbound-rtp' && !stat.isRemote && Number(stat.bytesReceived) > 0) {
      flowingInbound += 1
      bytes += Number(stat.bytesReceived)
    }
  })
  return { outboundCount: flowingOutbound, inboundCount: flowingInbound, bytes }
}

function isDirectPair(pair) {
  return !!pair &&
    pair.state === 'succeeded' &&
    !!pair.local?.candidateType &&
    !!pair.remote?.candidateType &&
    pair.local.candidateType !== 'relay' &&
    pair.remote.candidateType !== 'relay'
}

export class NativeP2pMesh {
  constructor({ iceServers, sendSignal, onRemoteTrack, onRemoteTrackEnded, onFailure, onSnapshot }) {
    this.configuration = {
      iceServers: directIceServers(iceServers),
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      iceCandidatePoolSize: 2
    }
    this.sendSignal = sendSignal
    this.onRemoteTrack = onRemoteTrack
    this.onRemoteTrackEnded = onRemoteTrackEnded
    this.onFailure = onFailure
    this.onSnapshot = onSnapshot
    this.connections = new Map()
    this.localSources = new Map()
    this.remoteSources = new Map()
    this.localPeerId = null
    this.epoch = 0
    this.mode = 'idle'
    this.healthInterval = null
    this.qualificationTimeout = null
    this.readyReported = false
  }

  applyTopology({ mode, epoch, peers, localPeerId }) {
    this.mode = mode
    this.epoch = Number(epoch) || 0
    this.localPeerId = String(localPeerId || this.localPeerId || '')
    this.readyReported = false
    const expected = new Set((peers || []).map(peer => String(peer.peerId)).filter(peerId => peerId !== this.localPeerId))
    for (const peerId of this.connections.keys()) {
      if (!expected.has(peerId)) this.closeConnection(peerId)
    }
    if (mode === 'probing' || mode === 'p2p') {
      for (const peer of peers || []) {
        const peerId = String(peer.peerId)
        if (peerId !== this.localPeerId) {
          const state = this.ensureConnection(peerId, peer.userId)
          state.expectedRemoteSources = Array.isArray(peer.sources) ? peer.sources.length : 0
        }
      }
      this.startHealthChecks()
      if (mode === 'probing') this.startQualificationTimeout()
    } else {
      this.stopHealthChecks()
      if (mode === 'idle') this.closeAll()
    }
    this.emitSnapshot()
  }

  ensureConnection(peerId, userId) {
    if (this.connections.has(peerId)) return this.connections.get(peerId)
    const pc = new RTCPeerConnection(this.configuration)
    const state = {
      peerId,
      userId: String(userId || peerId),
      pc,
      polite: String(this.localPeerId) > String(peerId),
      makingOffer: false,
      ignoreOffer: false,
      settingRemoteAnswer: false,
      candidates: [],
      channel: null,
      healthReceived: 0,
      missedHealth: 0,
      selectedPair: null,
      disconnectTimer: null,
      restarted: false,
      senders: new Map(),
      expectedRemoteSources: 0,
      mediaReady: false,
      mediaMissingSamples: 0,
      lastMediaBytes: null
    }
    this.connections.set(peerId, state)

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.signal(peerId, { candidate: candidate.toJSON() })
    }
    pc.onnegotiationneeded = async () => {
      try {
        state.makingOffer = true
        await pc.setLocalDescription()
        this.signal(peerId, { description: pc.localDescription })
      } catch (error) {
        this.fail('negotiation-failed', error)
      } finally {
        state.makingOffer = false
      }
    }
    pc.onconnectionstatechange = () => this.handleConnectionState(state)
    pc.oniceconnectionstatechange = () => this.handleIceState(state)
    pc.ontrack = event => this.handleTrack(state, event)
    pc.ondatachannel = event => this.bindHealthChannel(state, event.channel)

    if (String(this.localPeerId) < peerId) {
      this.bindHealthChannel(state, pc.createDataChannel('health', { ordered: false, maxRetransmits: 0 }))
    }
    for (const [source, entry] of this.localSources) this.attachSource(state, source, entry)
    return state
  }

  signal(targetPeerId, signal) {
    this.sendSignal({ targetPeerId, epoch: this.epoch, signal })
  }

  async receiveSignal({ fromPeerId, epoch, signal }) {
    if (Number(epoch) !== this.epoch || !signal) return
    const state = this.connections.get(String(fromPeerId)) || this.ensureConnection(String(fromPeerId), String(fromPeerId))
    const pc = state.pc
    if (signal.source) {
      this.remoteSources.set(`${state.peerId}:${signal.source.trackId}`, signal.source.source)
      return
    }
    if (signal.description) {
      const readyForOffer = !state.makingOffer && (pc.signalingState === 'stable' || state.settingRemoteAnswer)
      const collision = signal.description.type === 'offer' && !readyForOffer
      state.ignoreOffer = !state.polite && collision
      if (state.ignoreOffer) return
      state.settingRemoteAnswer = signal.description.type === 'answer'
      try {
        await pc.setRemoteDescription(signal.description)
      } finally {
        state.settingRemoteAnswer = false
      }
      for (const candidate of state.candidates.splice(0)) await pc.addIceCandidate(candidate)
      if (signal.description.type === 'offer') {
        await pc.setLocalDescription()
        this.signal(state.peerId, { description: pc.localDescription })
      }
      return
    }
    if (signal.candidate) {
      if (!pc.remoteDescription) {
        state.candidates.push(signal.candidate)
        return
      }
      try {
        await pc.addIceCandidate(signal.candidate)
      } catch (error) {
        if (!state.ignoreOffer) throw error
      }
    }
  }

  bindHealthChannel(state, channel) {
    state.channel = channel
    channel.onmessage = (event) => {
      let message = null
      try { message = JSON.parse(event.data) } catch (_) { return }
      if (message.type === 'health') {
        state.healthReceived += 1
        state.missedHealth = 0
        if (channel.readyState === 'open') channel.send(JSON.stringify({ type: 'health-ack', sequence: message.sequence }))
      } else if (message.type === 'health-ack') {
        state.healthReceived += 1
        state.missedHealth = 0
      }
    }
    channel.onopen = () => this.checkQualification()
    channel.onclose = () => {
      if (this.mode === 'p2p') this.fail('health-channel-closed')
    }
  }

  handleConnectionState(state) {
    const connectionState = state.pc.connectionState
    if (connectionState === 'failed') this.fail('peer-connection-failed')
    if (connectionState === 'closed' && this.mode === 'p2p') this.fail('peer-connection-closed')
    this.emitSnapshot()
  }

  handleIceState(state) {
    if (state.pc.iceConnectionState === 'disconnected') {
      clearTimeout(state.disconnectTimer)
      state.disconnectTimer = setTimeout(() => {
        if (state.pc.iceConnectionState !== 'disconnected') return
        if (!state.restarted) {
          state.restarted = true
          state.pc.restartIce()
          return
        }
        this.fail('ice-disconnected')
      }, 2000)
    } else {
      clearTimeout(state.disconnectTimer)
      state.disconnectTimer = null
    }
    if (state.pc.iceConnectionState === 'failed') this.fail('ice-failed')
    this.emitSnapshot()
  }

  handleTrack(state, event) {
    const track = event.track
    const source = this.remoteSources.get(`${state.peerId}:${track.id}`) || track.kind
    const key = `p2p:${state.peerId}:${track.id}`
    this.onRemoteTrack({ key, peerId: state.peerId, userId: state.userId, source, track, stream: new MediaStream([track]) })
    track.addEventListener('ended', () => this.onRemoteTrackEnded({ key, peerId: state.peerId, userId: state.userId, source }), { once: true })
  }

  publishSource(source, track, stream) {
    this.localSources.set(source, { track, stream })
    for (const state of this.connections.values()) this.attachSource(state, source, { track, stream })
  }

  attachSource(state, source, entry) {
    const existing = state.senders.get(source)
    if (existing) {
      existing.replaceTrack(entry.track)
      return
    }
    const sender = state.pc.addTrack(entry.track, entry.stream || new MediaStream([entry.track]))
    state.senders.set(source, sender)
    this.signal(state.peerId, { source: { trackId: entry.track.id, source } })
  }

  unpublishSource(source) {
    this.localSources.delete(source)
    for (const state of this.connections.values()) {
      const sender = state.senders.get(source)
      if (!sender) continue
      state.senders.delete(source)
      sender.replaceTrack(null)
    }
  }

  startQualificationTimeout() {
    clearTimeout(this.qualificationTimeout)
    this.qualificationTimeout = setTimeout(() => {
      if (!this.readyReported && this.mode === 'probing') this.fail('qualification-timeout')
    }, P2P_QUALIFICATION_TIMEOUT_MS)
  }

  startHealthChecks() {
    this.stopHealthChecks()
    let sequence = 0
    const run = async () => {
      sequence += 1
      for (const state of this.connections.values()) {
        if (state.channel?.readyState === 'open') {
          state.missedHealth += 1
          state.channel.send(JSON.stringify({ type: 'health', sequence, sentAt: performance.now() }))
          if (this.mode === 'p2p' && state.missedHealth >= 3) this.fail('health-timeout')
        }
        try {
          state.selectedPair = await selectedPairSnapshot(state.pc)
          const flow = await mediaFlowSnapshot(state.pc)
          const countsReady = flow.outboundCount >= this.localSources.size && flow.inboundCount >= state.expectedRemoteSources
          const needsMedia = this.localSources.size > 0 || state.expectedRemoteSources > 0
          const progressing = !needsMedia || state.lastMediaBytes == null || flow.bytes > state.lastMediaBytes
          state.mediaReady = countsReady && progressing
          state.lastMediaBytes = flow.bytes
          state.mediaMissingSamples = state.mediaReady ? 0 : state.mediaMissingSamples + 1
          if (this.mode === 'p2p' && state.mediaMissingSamples >= 3) this.fail('media-flow-stopped')
          if (state.selectedPair && !isDirectPair(state.selectedPair)) this.fail('relay-candidate-selected')
        } catch (_) {
          state.selectedPair = null
          state.mediaReady = false
        }
      }
      this.checkQualification()
      this.emitSnapshot()
    }
    run()
    this.healthInterval = setInterval(run, this.mode === 'probing' ? 250 : 1000)
  }

  stopHealthChecks() {
    if (this.healthInterval) clearInterval(this.healthInterval)
    this.healthInterval = null
    clearTimeout(this.qualificationTimeout)
    this.qualificationTimeout = null
  }

  checkQualification() {
    if (this.mode !== 'probing' || this.readyReported || this.connections.size === 0) return
    const qualified = [...this.connections.values()].filter(state =>
      state.pc.connectionState === 'connected' &&
      state.channel?.readyState === 'open' &&
      state.healthReceived >= 3 &&
      state.mediaReady &&
      isDirectPair(state.selectedPair)
    )
    if (qualified.length !== this.connections.size) return
    this.readyReported = true
    clearTimeout(this.qualificationTimeout)
    this.sendSignal({
      type: 'ready',
      epoch: this.epoch,
      qualifiedPeerIds: qualified.map(state => state.peerId)
    })
  }

  async getSnapshot() {
    const edges = []
    for (const state of this.connections.values()) {
      const pair = state.selectedPair || await selectedPairSnapshot(state.pc).catch(() => null)
      const report = await state.pc.getStats().catch(() => null)
      let packetsLost = 0
      let packetsReceived = 0
      report?.forEach((stat) => {
        if (stat.type !== 'inbound-rtp' || stat.isRemote) return
        packetsLost += Math.max(0, Number(stat.packetsLost) || 0)
        packetsReceived += Math.max(0, Number(stat.packetsReceived) || 0)
      })
      const packetLoss = packetsLost + packetsReceived > 0 ? packetsLost * 100 / (packetsLost + packetsReceived) : null
      edges.push({
        peerId: state.peerId,
        state: state.pc.connectionState === 'connected' ? 'active' : state.pc.connectionState === 'failed' ? 'failed' : 'probing',
        candidatePair: pair,
        network: pair?.local?.protocol || pair?.remote?.protocol || null,
        rtt: pair?.currentRoundTripTime == null ? null : pair.currentRoundTripTime * 1000,
        bitrate: pair?.availableOutgoingBitrate ?? null,
        packetLoss
      })
    }
    return edges
  }

  isMediaReady() {
    return this.connections.size > 0 && [...this.connections.values()].every(state => state.mediaReady)
  }

  emitSnapshot() {
    this.getSnapshot().then(snapshot => this.onSnapshot?.(snapshot)).catch(() => {})
  }

  fail(reason, error) {
    if (this.mode !== 'probing' && this.mode !== 'p2p') return
    this.onFailure({ reason, error, epoch: this.epoch })
  }

  closeConnection(peerId) {
    const state = this.connections.get(peerId)
    if (!state) return
    clearTimeout(state.disconnectTimer)
    try { state.channel?.close() } catch (_) {}
    try { state.pc.close() } catch (_) {}
    this.connections.delete(peerId)
  }

  closeAll() {
    this.stopHealthChecks()
    for (const peerId of [...this.connections.keys()]) this.closeConnection(peerId)
    this.remoteSources.clear()
    this.readyReported = false
  }
}

export { directIceServers, hasRequiredMediaFlow, isDirectPair, mediaFlowSnapshot, selectedPairSnapshot }
