import { computed, readonly, ref } from 'vue'
import { useRuntimeConfig } from '#app'
import { MediaCaptureManager } from '~/shared/media-capture.js'
import { MediasoupClientSession } from '~/shared/mediasoup-client-session.js'
import { NativeP2pMesh } from '~/shared/native-p2p.js'
import { RemoteMediaRegistry } from '~/shared/remote-media-registry.js'
import { addressFamily, buildTopologyGraph } from '~/shared/rtc-topology.js'
import { shouldAcceptTopologyEvent, topologyEventKey } from '#shared/media-transition.js'
import { useAuthStore } from '~/stores/auth'
import { useSettingsStore } from '~/stores/settings'
import { useVoiceStore } from '~/stores/voice'

const connectionTimeoutMs = 10000
const mediaHandoffTimeoutMs = 3000

export function useHybridMediaSession() {
  const runtimeConfig = useRuntimeConfig()
  const authStore = useAuthStore()
  const settingsStore = useSettingsStore()
  const voiceStore = useVoiceStore()
  const connected = ref(false)
  const error = ref(null)
  const transportReady = ref(false)
  const iceConnectedBoth = ref(false)
  const localVideoFeeds = ref(new Map())
  const remoteVideoFeeds = ref(new Map())
  const remoteAudioFeeds = ref(new Map())
  const lastInRoom = ref([])
  const remoteProducersCount = ref(0)
  const sharedAudioStats = ref({ kbps: 0, level: 0, dbfs: -60 })
  const peerRoundTripTimes = ref({})
  const sfuRoundTripTime = ref(null)
  const participantSfuRoundTripTimes = ref({})
  const topologyState = ref({ mode: 'idle', epoch: 0, reason: 'waiting-for-peer', peers: [], activatedAt: null })
  const topologyGraph = ref(buildTopologyGraph({ mode: 'idle', participantIds: [] }))
  const producers = ref(new Map())
  const consumers = ref(new Map())
  const lastSentClientRtpCapabilities = ref(null)
  const lastReceivedConsumerParams = ref(null)
  const stagedTracks = { p2p: new Map(), sfu: new Map() }
  const messageHandlers = new Map()
  const messageQueue = []
  const localSources = new Map()
  let socket = null
  let channelId = null
  let localPeerId = null
  let iceServers = []
  let p2pMesh = null
  let sfu = null
  let activeProvider = null
  let intentionalClose = false
  let pingTimer = null
  let reconnectTimer = null
  let reconnectAttempt = 0
  let topologyWaiter = null
  let statsTimer = null
  let sharedAudioMeter = null
  let topologyOperation = Promise.resolve()
  let pendingTopologyKey = null
  let appliedTopologyKey = null
  let highestQueuedEpoch = 0
  let lastP2pEdges = []

  const registry = new RemoteMediaRegistry({
    audioFeeds: remoteAudioFeeds,
    videoFeeds: remoteVideoFeeds,
    getVolume: (userId, source) => voiceStore.getTrackVolume(userId, source),
    getOutputDevice: () => settingsStore.outputDeviceId,
    isDeafened: () => voiceStore.deafened,
    isBroadcastMode: () => settingsStore.broadcastMode,
    onSpeaking: (userId, speaking) => voiceStore.updateUserSpeaking(userId, speaking)
  })

  const capture = new MediaCaptureManager({
    getSettings: () => settingsStore,
    onSource: publishSource,
    onSourceEnded: removeSource
  })

  function send(message) {
    if (intentionalClose) return false
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message))
      return true
    }
    if (!intentionalClose) messageQueue.push(message)
    return false
  }

  function flushMessages() {
    while (messageQueue.length && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(messageQueue.shift()))
  }

  function registerHandler(type, handler) {
    messageHandlers.set(type, handler)
  }

  async function fetchIceServers() {
    const result = await $fetch(`${runtimeConfig.public.apiPath}/config`)
    if (!Array.isArray(result)) throw new Error('The ICE server configuration is invalid')
    iceServers = result
  }

  async function connect(nextChannelId) {
    if (connected.value && channelId === nextChannelId) return
    intentionalClose = false
    channelId = nextChannelId
    error.value = null
    await fetchIceServers()
    setupHandlers()
    await openSocket()
    await waitForInitialTopology()
  }

  function openSocket() {
    const userId = authStore.getUserData()?.id
    if (!userId) return Promise.reject(new Error('User not authenticated'))
    if (!channelId) return Promise.reject(new Error('Channel ID is required'))
    const origin = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`
    const base = runtimeConfig.public.sfuPath || `${origin}/socket`
    const url = `${base}?auth=${encodeURIComponent(userId)}&channelId=${encodeURIComponent(channelId)}`
    return new Promise((resolve, reject) => {
      const candidate = new WebSocket(url)
      socket = candidate
      const timeout = setTimeout(() => {
        candidate.close()
        reject(new Error('Media signaling connection timed out'))
      }, connectionTimeoutMs)
      candidate.onopen = () => {
        if (socket !== candidate) return
        clearTimeout(timeout)
        connected.value = true
        reconnectAttempt = 0
        flushMessages()
        sendSourceState()
        startKeepalive()
        resolve()
      }
      candidate.onmessage = event => handleMessage(event.data)
      candidate.onerror = () => {
        clearTimeout(timeout)
        if (!connected.value) reject(new Error('Media signaling connection failed'))
      }
      candidate.onclose = () => {
        clearTimeout(timeout)
        if (socket !== candidate) return
        socket = null
        connected.value = false
        stopKeepalive()
        if (!intentionalClose) {
          messageQueue.splice(0)
          p2pMesh?.closeAll()
          sfu?.closeMedia()
          registry.clear()
          stagedTracks.p2p.clear()
          stagedTracks.sfu.clear()
          activeProvider = null
          transportReady.value = false
          iceConnectedBoth.value = false
          scheduleReconnect()
        }
      }
    })
  }

  function waitForInitialTopology() {
    if (topologyState.value.epoch > 0) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        topologyWaiter = null
        reject(new Error('Initial media topology timed out'))
      }, connectionTimeoutMs)
      topologyWaiter = () => {
        clearTimeout(timeout)
        topologyWaiter = null
        resolve()
      }
    })
  }

  function startKeepalive() {
    stopKeepalive()
    pingTimer = setInterval(() => send({ type: 'ping' }), 15000)
  }

  function stopKeepalive() {
    if (pingTimer) clearInterval(pingTimer)
    pingTimer = null
  }

  function scheduleReconnect() {
    if (reconnectTimer || intentionalClose) return
    const delay = Math.min(10000, 500 * 2 ** reconnectAttempt) + Math.floor(Math.random() * 250)
    reconnectAttempt += 1
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null
      try {
        await openSocket()
      } catch (reconnectError) {
        error.value = reconnectError.message
        scheduleReconnect()
      }
    }, delay)
  }

  function handleMessage(raw) {
    let message
    try {
      if (typeof raw !== 'string' || raw.length > 600000) throw new Error('Invalid signaling payload')
      message = JSON.parse(raw)
    } catch (_) {
      failSession('The media server sent an invalid message')
      return
    }
    const handler = messageHandlers.get(message.type)
    if (!handler) return
    Promise.resolve(handler(message.data || {})).catch(handlerError => {
      failSession(handlerError.message || 'Media message handling failed')
    })
  }

  function setupHandlers() {
    if (messageHandlers.size) return
    registerHandler('connected', data => { localPeerId = String(data.peerId) })
    registerHandler('topology-state', queueTopology)
    registerHandler('p2p-signal', data => ensureP2p()?.receiveSignal(data))
    registerHandler('currentlyInChannel', data => {
      lastInRoom.value = Array.isArray(data.inRoom) ? data.inRoom : []
      syncConnectedUsers(data.inRoom)
    })
    registerHandler('available-producers', data => {
      remoteProducersCount.value = (data.producers || []).filter(id => ![...sfuProducerIds()].includes(id)).length
      return sfu?.handle('available-producers', data)
    })
    registerHandler('new-producer', data => {
      remoteProducersCount.value += 1
      return sfu?.handle('new-producer', data)
    })
    registerHandler('producer-closed', data => {
      remoteProducersCount.value = Math.max(0, remoteProducersCount.value - 1)
      return sfu?.handle('producer-closed', data)
    })
    registerHandler('participant-sfu-rtt', data => {
      if (data.userId && Number.isFinite(Number(data.rttMs))) {
        participantSfuRoundTripTimes.value = { ...participantSfuRoundTripTimes.value, [data.userId]: Number(data.rttMs) }
      }
    })
    registerHandler('server-shutdown', () => socket?.close())
    for (const type of ['rtp-capabilities', 'transport-params', 'transport-connected', 'producer-id', 'consumer-params']) {
      registerHandler(type, data => sfu?.handle(type, data))
    }
  }

  function ensureP2p() {
    if (p2pMesh || typeof RTCPeerConnection === 'undefined') return p2pMesh
    p2pMesh = new NativeP2pMesh({
      iceServers,
      sendSignal: payload => {
        if (payload.type === 'ready') send({ type: 'p2p-ready', data: payload })
        else send({ type: 'p2p-signal', data: payload })
      },
      onRemoteTrack: entry => stageRemote({ ...entry, provider: 'p2p' }),
      onRemoteTrackEnded: entry => removeRemote({ ...entry, provider: 'p2p' }),
      onFailure: failure => send({ type: 'p2p-failed', data: failure }),
      onSnapshot: updateP2pStats
    })
    return p2pMesh
  }

  function queueTopology(data) {
    const epoch = Number(data.epoch)
    if (!shouldAcceptTopologyEvent(data, highestQueuedEpoch)) return topologyOperation
    highestQueuedEpoch = Math.max(highestQueuedEpoch, epoch)
    const key = topologyEventKey(data)
    if (key === appliedTopologyKey || key === pendingTopologyKey) return topologyOperation
    pendingTopologyKey = key
    topologyOperation = topologyOperation
      .catch(() => {})
      .then(() => applyTopology(data))
      .then(() => { appliedTopologyKey = key })
      .finally(() => {
        if (pendingTopologyKey === key) pendingTopologyKey = null
      })
    return topologyOperation
  }

  function ensureSfu() {
    if (sfu) return sfu
    sfu = new MediasoupClientSession({
      send,
      iceServers,
      onRemoteTrack: entry => stageRemote(entry),
      onRemoteTrackEnded: removeRemote,
      onStateChange: (_, state) => {
        if (state === 'failed' && topologyState.value.mode === 'sfu') failSession('The SFU media transport failed')
      }
    })
    return sfu
  }

  async function applyTopology(data) {
    if (Number(data.epoch) < topologyState.value.epoch) return
    const previousProvider = activeProvider
    topologyState.value = {
      mode: data.mode,
      epoch: Number(data.epoch),
      reason: data.reason || null,
      target: data.target || null,
      sourceRevision: Number(data.sourceRevision) || 0,
      peers: Array.isArray(data.peers) ? data.peers : [],
      activatedAt: data.activatedAt || Date.now(),
      displayMode: data.mode === 'probing' && previousProvider ? 'switching' : null
    }
    topologyWaiter?.()
    if (data.mode === 'idle') {
      activeProvider = null
      transportReady.value = true
      iceConnectedBoth.value = true
      refreshPublicMaps()
      refreshTopologyGraph()
      return
    }
    if (data.mode === 'probing') {
      const mesh = ensureP2p()
      if (!mesh) {
        send({ type: 'p2p-failed', data: { epoch: data.epoch, reason: 'webrtc-unavailable' } })
        return
      }
      mesh.applyTopology({ ...data, localPeerId })
      for (const entry of localSources.values()) mesh.publishSource(entry.source, entry.track, entry.stream)
      transportReady.value = true
      iceConnectedBoth.value = true
      refreshTopologyGraph()
      return
    }
    if (data.mode === 'switching') {
      await prepareTransition(data)
      return
    }
    if (data.mode === 'p2p') {
      await activateP2p(data)
      return
    }
    if (data.mode === 'sfu') await activateSfu(data)
  }

  async function prepareTransition(data) {
    try {
      transportReady.value = true
      if (data.target === 'p2p') {
        const mesh = ensureP2p()
        if (!mesh) throw new Error('Native WebRTC is unavailable')
        mesh.applyTopology({ ...data, mode: 'p2p', localPeerId })
        for (const entry of localSources.values()) mesh.publishSource(entry.source, entry.track, entry.stream)
        await waitForRemoteTracks('p2p')
      } else if (data.target === 'sfu') {
        const session = ensureSfu()
        await session.initialize()
        for (const entry of localSources.values()) await session.addSource(entry)
        await waitForRemoteTracks('sfu')
      } else {
        throw new Error('The server requested an invalid media topology')
      }
      send({ type: 'topology-ready', data: { epoch: data.epoch, target: data.target, sourceRevision: data.sourceRevision } })
      refreshPublicMaps()
      refreshTopologyGraph()
    } catch (transitionError) {
      if (data.target === 'sfu') sfu?.closeMedia()
      send({ type: 'topology-failed', data: { epoch: data.epoch, target: data.target, reason: transitionError.message } })
      throw transitionError
    }
  }

  async function activateP2p(data) {
    const mesh = ensureP2p()
    mesh.applyTopology({ ...data, localPeerId })
    for (const entry of localSources.values()) mesh.publishSource(entry.source, entry.track, entry.stream)
    await waitForRemoteTracks('p2p')
    bindStaged('p2p')
    registry.activateProvider('p2p')
    activeProvider = 'p2p'
    registry.clearProvider('sfu')
    sfu?.closeMedia()
    transportReady.value = true
    iceConnectedBoth.value = true
    error.value = null
    refreshPublicMaps()
    refreshTopologyGraph()
  }

  async function activateSfu(data) {
    transportReady.value = false
    const session = ensureSfu()
    await session.initialize()
    for (const entry of localSources.values()) await session.addSource(entry)
    await waitForRemoteTracks('sfu')
    bindStaged('sfu')
    registry.activateProvider('sfu')
    activeProvider = 'sfu'
    registry.clearProvider('p2p')
    for (const entry of localSources.values()) p2pMesh?.unpublishSource(entry.source)
    transportReady.value = true
    iceConnectedBoth.value = true
    error.value = null
    refreshPublicMaps()
    refreshTopologyGraph()
  }

  function waitForRemoteTracks(provider) {
    const startedAt = Date.now()
    return new Promise((resolve, reject) => {
      const poll = () => {
        const expected = topologyState.value.peers
          .filter(peer => String(peer.peerId) !== String(localPeerId))
          .reduce((count, peer) => count + (Array.isArray(peer.sources) ? peer.sources.length : 0), 0)
        const tracksReady = stagedTracks[provider].size >= expected
        const mediaReady = provider === 'p2p'
          ? !!p2pMesh?.isMediaReady()
          : false
        const check = provider === 'sfu' && tracksReady
          ? sfu?.mediaReady(expected).catch(() => false)
          : Promise.resolve(mediaReady)
        check.then((flowing) => {
          if ((tracksReady && flowing) || (expected === 0 && localSources.size === 0)) {
            resolve()
            return
          }
          if (Date.now() - startedAt >= mediaHandoffTimeoutMs) {
            reject(new Error(`${provider.toUpperCase()} media did not become ready for handoff`))
            return
          }
          setTimeout(poll, 50)
        })
      }
      poll()
    })
  }

  function stageRemote(entry) {
    stagedTracks[entry.provider].set(entry.key, entry)
    if (activeProvider === entry.provider) registry.bind(entry)
  }

  function bindStaged(provider) {
    for (const entry of stagedTracks[provider].values()) registry.bind(entry, { staged: true })
  }

  function removeRemote(entry) {
    stagedTracks[entry.provider]?.delete(entry.key)
    registry.remove(entry.key)
  }

  function publishSource(entry) {
    localSources.set(entry.source, entry)
    if (entry.source === 'camera' || entry.source === 'screen') {
      localVideoFeeds.value.set(entry.source, { source: entry.source, stream: entry.stream, producerId: `${activeProvider || 'local'}:${entry.track.id}` })
      localVideoFeeds.value = new Map(localVideoFeeds.value)
    }
    if (topologyState.value.mode === 'p2p' || topologyState.value.mode === 'probing' || topologyState.value.target === 'p2p') {
      p2pMesh?.publishSource(entry.source, entry.track, entry.stream)
    }
    if (topologyState.value.mode === 'sfu' || topologyState.value.target === 'sfu') {
      sfu?.addSource(entry).catch(sourceError => failSession(sourceError.message))
    }
    if (entry.source === 'screen-audio') startSharedAudioMeter(entry.track)
    sendSourceState()
    refreshPublicMaps()
  }

  function removeSource(entry) {
    if (localSources.get(entry.source)?.track !== entry.track) return
    localSources.delete(entry.source)
    p2pMesh?.unpublishSource(entry.source)
    sfu?.removeSource(entry.source)
    localVideoFeeds.value.delete(entry.source)
    localVideoFeeds.value = new Map(localVideoFeeds.value)
    if (entry.source === 'screen-audio') stopSharedAudioMeter()
    sendSourceState()
    refreshPublicMaps()
  }

  function sendSourceState() {
    send({ type: 'media-sources', data: { sources: [...localSources.keys()] } })
  }

  function startAudioProduction() {
    return capture.startMicrophone().then(entry => producerFacade(entry))
  }

  function stopAudioProduction() {
    capture.stop('audio')
  }

  function startVideoProduction(source) {
    return capture.startVideo(source).then(entry => producerFacade(entry))
  }

  function stopVideoProduction(source) {
    capture.stop(source)
  }

  function startSystemAudioProduction() {
    return capture.startSystemAudio().then(entry => producerFacade(entry))
  }

  function stopSystemAudioProduction() {
    const entry = localSources.get('screen-audio')
    if (entry?.ownerSource === 'system-audio') capture.stop('screen-audio')
  }

  function producerFacade(entry) {
    return {
      id: `${activeProvider || 'local'}:${entry.source}:${entry.track.id}`,
      track: entry.track,
      closed: entry.track.readyState !== 'live',
      on() {},
      close: () => capture.stop(entry.source)
    }
  }

  function setSharedAudioVolume(value) {
    settingsStore.sharedAudioVolume = Math.max(0, Math.min(1, Number(value)))
  }

  function setSystemAudioBitrate(value) {
    settingsStore.systemAudioBitrate = Number(value)
    return Promise.resolve()
  }

  function startSharedAudioMeter(track) {
    stopSharedAudioMeter()
    try {
      const AudioContextConstructor = window.AudioContext || window.webkitAudioContext
      if (!AudioContextConstructor) throw new Error('Web Audio is unavailable')
      const context = new AudioContextConstructor()
      const source = context.createMediaStreamSource(new MediaStream([track]))
      const analyser = context.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      const values = new Float32Array(analyser.fftSize)
      const timer = setInterval(() => {
        analyser.getFloatTimeDomainData(values)
        const rms = Math.sqrt(values.reduce((sum, sample) => sum + sample * sample, 0) / values.length)
        const dbfs = rms > 0 ? 20 * Math.log10(rms) : -60
        sharedAudioStats.value = { kbps: Number(settingsStore.systemAudioBitrate) || 128, level: Math.min(100, rms * 400), dbfs: Math.max(-60, dbfs) }
      }, 250)
      sharedAudioMeter = { context, source, analyser, timer }
    } catch (_) {
      sharedAudioStats.value = { kbps: 0, level: 0, dbfs: -60 }
    }
  }

  function stopSharedAudioMeter() {
    if (!sharedAudioMeter) return
    clearInterval(sharedAudioMeter.timer)
    sharedAudioMeter.source.disconnect()
    sharedAudioMeter.analyser.disconnect()
    sharedAudioMeter.context.close().catch(() => {})
    sharedAudioMeter = null
    sharedAudioStats.value = { kbps: 0, level: 0, dbfs: -60 }
  }

  function syncConnectedUsers(userIds = []) {
    const active = new Set(userIds.map(String))
    for (const userId of active) if (!voiceStore.isUserConnected(userId)) voiceStore.addConnectedUser(userId, { id: userId })
    for (const user of voiceStore.getConnectedUsersArray()) if (!active.has(String(user.id))) voiceStore.removeConnectedUser(user.id)
  }

  function updateP2pStats(edges) {
    lastP2pEdges = edges
    const values = edges.filter(edge => Number.isFinite(Number(edge.rtt)))
    peerRoundTripTimes.value = Object.fromEntries(values.map(edge => [edge.peerId, Number(edge.rtt)]))
    refreshTopologyGraph()
  }

  function refreshTopologyGraph(candidatePair = null) {
    const details = {}
    for (const connection of p2pMesh ? p2pMesh.connections.values() : []) {
      const edge = lastP2pEdges.find(candidate => candidate.peerId === connection.peerId) || {}
      const key = [localPeerId, connection.peerId].sort().join(':')
      details[key] = {
        state: edge.state || (connection.pc.connectionState === 'connected' ? 'active' : 'probing'),
        rtt: edge.rtt ?? null,
        network: edge.network || null,
        candidateType: edge.candidatePair?.local?.candidateType || null,
        addressFamily: addressFamily(edge.candidatePair?.remote?.address),
        bitrate: edge.bitrate ?? null,
        packetLoss: edge.packetLoss ?? null
      }
    }
    topologyGraph.value = buildTopologyGraph({
      mode: topologyState.value.displayMode || topologyState.value.mode,
      currentMode: activeProvider,
      target: topologyState.value.target,
      epoch: topologyState.value.epoch,
      reason: topologyState.value.reason,
      activatedAt: topologyState.value.activatedAt,
      participantIds: topologyState.value.peers.map(peer => peer.peerId),
      localPeerId,
      edgeDetails: details,
      sfuEdge: candidatePair ? {
        rtt: candidatePair.currentRoundTripTime == null ? null : candidatePair.currentRoundTripTime * 1000,
        network: candidatePair.local?.protocol || candidatePair.remote?.protocol || null,
        candidateType: candidatePair.local?.candidateType || null,
        bitrate: candidatePair.availableOutgoingBitrate ?? null,
        packetLoss: candidatePair.packetLoss ?? null
      } : null,
      candidatePair
    })
  }

  function refreshPublicMaps() {
    producers.value = new Map(sfu ? [...sfu.producers].map(([source, entry]) => [entry.producer.id, entry]) : [])
    consumers.value = new Map(sfu ? [...sfu.consumers.values()].map(entry => [entry.producerId, entry.consumer]) : [])
  }

  function sfuProducerIds() {
    return sfu ? [...sfu.producers.values()].map(entry => entry.producer.id) : []
  }

  async function getWebRTCStatsSnapshot() {
    const transports = sfu ? await sfu.stats() : []
    const pair = transports.find(transport => transport.candidatePair)?.candidatePair || null
    sfuRoundTripTime.value = pair?.currentRoundTripTime == null ? null : pair.currentRoundTripTime * 1000
    if (sfuRoundTripTime.value != null) send({ type: 'client-sfu-rtt', data: { rttMs: sfuRoundTripTime.value } })
    refreshTopologyGraph(pair)
    return {
      timestamp: Date.now(),
      peerRoundTripTime: Math.max(0, ...Object.values(peerRoundTripTimes.value)),
      transports,
      topology: topologyGraph.value.topology,
      nodes: topologyGraph.value.nodes,
      edges: topologyGraph.value.edges
    }
  }

  async function getOutboundVideoStats() {
    return [...localSources.values()].filter(entry => entry.track.kind === 'video').map(entry => {
      const settings = entry.track.getSettings?.() || {}
      return { source: entry.source, width: settings.width || null, height: settings.height || null, captureFps: settings.frameRate || null, fps: settings.frameRate || null }
    })
  }

  async function getInboundVideoStats() {
    return [...remoteVideoFeeds.value.values()].map(entry => {
      const settings = entry.track.getSettings?.() || {}
      return { consumerId: entry.key, width: settings.width || null, height: settings.height || null, fps: settings.frameRate || null }
    })
  }

  function failSession(message) {
    error.value = message
    iceConnectedBoth.value = false
  }

  function areTransportsIceConnected() {
    return Promise.resolve(iceConnectedBoth.value)
  }

  function waitForIceConnected(timeoutMs = 12000) {
    const startedAt = Date.now()
    return new Promise(resolve => {
      const poll = () => {
        if (iceConnectedBoth.value || Date.now() - startedAt >= timeoutMs) {
          resolve(iceConnectedBoth.value)
          return
        }
        setTimeout(poll, 50)
      }
      poll()
    })
  }

  function disconnect() {
    intentionalClose = true
    channelId = null
    clearTimeout(reconnectTimer)
    reconnectTimer = null
    stopKeepalive()
    stopSharedAudioMeter()
    if (statsTimer) clearInterval(statsTimer)
    statsTimer = null
    socket?.close()
    socket = null
    capture.stopAll()
    p2pMesh?.closeAll()
    p2pMesh = null
    sfu?.close()
    sfu = null
    registry.clear()
    messageQueue.splice(0)
    stagedTracks.p2p.clear()
    stagedTracks.sfu.clear()
    activeProvider = null
    connected.value = false
    transportReady.value = false
    iceConnectedBoth.value = false
    topologyState.value = { mode: 'idle', epoch: 0, reason: 'disconnected', peers: [], activatedAt: null }
    pendingTopologyKey = null
    appliedTopologyKey = null
    topologyOperation = Promise.resolve()
    highestQueuedEpoch = 0
    lastP2pEdges = []
    refreshPublicMaps()
    refreshTopologyGraph()
  }

  return {
    connected: readonly(connected),
    error: readonly(error),
    transportReady: readonly(transportReady),
    iceConnectedBoth: readonly(iceConnectedBoth),
    isProducing: computed(() => localSources.size > 0),
    producers: readonly(producers),
    consumers: readonly(consumers),
    localVideoFeeds: readonly(localVideoFeeds),
    remoteVideoFeeds: readonly(remoteVideoFeeds),
    remoteAudioFeeds: readonly(remoteAudioFeeds),
    sharedAudioStats: readonly(sharedAudioStats),
    peerRoundTripTimes: readonly(peerRoundTripTimes),
    sfuRoundTripTime: readonly(sfuRoundTripTime),
    participantSfuRoundTripTimes: readonly(participantSfuRoundTripTimes),
    remoteProducersCount,
    lastInRoom,
    topologyState: readonly(topologyState),
    topologyGraph: readonly(topologyGraph),
    lastSentClientRtpCapabilities: readonly(lastSentClientRtpCapabilities),
    lastReceivedConsumerParams: readonly(lastReceivedConsumerParams),
    connect,
    disconnect,
    startAudioProduction,
    stopAudioProduction,
    startVideoProduction,
    stopVideoProduction,
    startSystemAudioProduction,
    stopSystemAudioProduction,
    setSharedAudioVolume,
    setSystemAudioBitrate,
    applyOutputDeviceToAll: () => registry.applyOutputDevice(),
    applyVolumeForUser: (userId, volume) => registry.applyVolume(userId, null, volume),
    applyVolumeForTrack: (userId, source, volume) => registry.applyVolume(userId, source, volume),
    ensureAudioElements: () => registry.ensurePlayback(),
    getWebRTCStatsSnapshot,
    getOutboundVideoStats,
    getInboundVideoStats,
    areTransportsIceConnected,
    waitForIceConnected
  }
}
