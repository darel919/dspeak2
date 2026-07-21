import { Device } from 'mediasoup-client'
import { useRuntimeConfig } from '#app'
import { useAuthStore } from '~/stores/auth'
import { useChannelsStore } from '~/stores/channels'
import { useRoomsStore } from '~/stores/rooms'
import { useSettingsStore } from '~/stores/settings'
import { useVoiceStore } from '~/stores/voice'
import { buildVideoConstraints, buildVideoProduceOptions, calculateEncodedFps, calculateFrameTimeMs, classifyCodecImplementation, rankVideoCodecsByHardwarePreference, updateVideoAdaptationState } from '~/shared/video-settings'
import { buildVoiceProducerOptions, getActiveMediaDirections, getAverageJitterBufferDelayMs, getReconnectDelayMs, getTransportRecoveryDelayMs } from '~/shared/voice-transport'

export function useMediasoupSfu() {

  const failedConsumeProducers = new Set()
  const config = useRuntimeConfig()
  const authStore = useAuthStore()

  const device = ref(null)
  const ws = ref(null)

  const lastPong = ref(null)
  const peerRoundTripTime = ref(null)
  const peerRoundTripTimes = ref({})
  const sfuRoundTripTime = ref(null)
  const participantSfuRoundTripTimes = ref({})
  const pendingPeerRttProbes = new Map()
  const peerRttSamples = new Map()

  const lastSentClientRtpCapabilities = ref(null)
  const lastReceivedConsumerParams = ref(null)

  const iceServers = ref([])
  const sendTransport = ref(null)
  const recvTransport = ref(null)
  const producers = ref(new Map())
  const consumers = ref(new Map())
  const localVideoFeeds = ref(new Map())
  const outboundVideoStatsHistory = new Map()
  const inboundVideoStatsHistory = new Map()
  const remoteVideoFeeds = ref(new Map())
  const remoteAudioFeeds = ref(new Map())
  const sharedAudioStats = ref({ kbps: 0, level: 0, dbfs: -60 })
  const producerSources = new Map()

  const localProducerIds = new Set()
  const connected = ref(false)
  const error = ref(null)
  const isProducing = ref(false)
  const transportReady = ref(false)
  const isProducingAudio = ref(false)

  const pendingTransportConnect = new Map()

  const pendingProduceQueue = []

  const pendingConsume = new Map()

  let manualDisconnect = false
  let isShuttingDown = false
  let autoStartTimeoutId = null

  let pendingStream = null
  let pendingTrack = null

  let messageHandlers = new Map()
  let messageQueue = []
  let reconnectAttempts = 0
  const maxReconnectAttempts = 5
  let transportPromiseResolve = null
  let transportPromise = null
  let rtpCapabilitiesTimeout = null
  let reconnectTimeoutId = null
  let transportDisconnectTimeoutId = null
  let transportReconnectRequested = false
  let allowReconnect = true
  let activeChannelId = null
  let hasEstablishedSession = false

  let lastClientRtpCapsSentAt = 0
  let lastClientRtpCapsPayload = null
  let pingIntervalId = null
  let peerRttIntervalId = null
  let lastSfuRttReportAt = 0
  let missedPongCount = 0
  const defaultPingIntervalMs = 15000
  const desiredGraceMs = 120000
  const allowedMisses = Math.max(1, Math.ceil(desiredGraceMs / defaultPingIntervalMs))
  let audioEnsureIntervalId = null
  let producersRequested = false
  let sharedAudioStatsIntervalId = null
  const sharedAudioBitrateHistory = new Map()

  function getSharedAudioCaptureConstraints() {
    return {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      suppressLocalAudioPlayback: false
    }
  }

  async function disableSharedAudioProcessing(track) {
    if (!track) return
    try { track.contentHint = 'music' } catch (_) { /* browser may not expose contentHint */ }
    if (!track.applyConstraints) return
    try {
      const supported = navigator.mediaDevices?.getSupportedConstraints?.() || {}
      const constraints = getSharedAudioCaptureConstraints()
      const applicable = Object.fromEntries(
        Object.entries(constraints).filter(([key]) => supported[key] === true)
      )
      if (Object.keys(applicable).length) await track.applyConstraints(applicable)
    } catch (err) {
      console.warn('[SFU] Browser did not accept all no-processing constraints for shared audio:', err)
    }
  }

  function createSharedAudioTrack(sourceTrack) {
    try { sourceTrack.contentHint = 'music' } catch (_) { /* browser may not expose contentHint */ }
    if (typeof window === 'undefined') return { track: sourceTrack, sourceTrack }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (!AudioContextClass) return { track: sourceTrack, sourceTrack }

    const audioContext = new AudioContextClass()
    const mediaSource = audioContext.createMediaStreamSource(new MediaStream([sourceTrack]))
    const gainNode = audioContext.createGain()
    const analyserNode = audioContext.createAnalyser()
    const destination = audioContext.createMediaStreamDestination()
    try {
      gainNode.channelCount = 2
      gainNode.channelCountMode = 'explicit'
      gainNode.channelInterpretation = 'speakers'
      analyserNode.channelCount = 2
      analyserNode.channelCountMode = 'explicit'
      analyserNode.channelInterpretation = 'speakers'
    } catch (_) { /* defaults are stereo where explicit channel controls are unavailable */ }
    gainNode.gain.value = useSettingsStore().sharedAudioVolume / 100
    analyserNode.fftSize = 512
    analyserNode.smoothingTimeConstant = 0.65
    mediaSource.connect(gainNode)
    gainNode.connect(analyserNode)
    analyserNode.connect(destination)
    audioContext.resume?.().catch(() => {})
    const processedTrack = destination.stream.getAudioTracks()[0]
    try { processedTrack.contentHint = 'music' } catch (_) { /* browser may not expose contentHint */ }
    return {
      track: processedTrack,
      sourceTrack,
      audioContext,
      mediaSource,
      gainNode,
      analyserNode,
      meterData: new Uint8Array(analyserNode.fftSize),
      destination
    }
  }

  async function updateSharedAudioStats() {
    const entry = Array.from(producers.value.values()).find(candidate => candidate.source === 'screen-audio')
    if (!entry) {
      sharedAudioStats.value = { kbps: 0, level: 0, dbfs: -60 }
      return
    }

    if (entry.audioContext?.state === 'suspended') {
      try { await entry.audioContext.resume() } catch (_) { /* user activation may be required */ }
    }

    let level = 0
    let dbfs = -60
    if (entry.analyserNode && entry.meterData) {
      entry.analyserNode.getByteTimeDomainData(entry.meterData)
      let sumSquares = 0
      for (const sample of entry.meterData) {
        const centered = (sample - 128) / 128
        sumSquares += centered * centered
      }
      const rms = Math.sqrt(sumSquares / entry.meterData.length)
      dbfs = rms > 0 ? Math.max(-60, 20 * Math.log10(rms)) : -60
      level = Math.min(1, Math.max(0, (dbfs + 60) / 60))
    }

    let kbps = sharedAudioStats.value.kbps
    try {
      const report = await entry.producer.getStats()
      let outbound = null
      report.forEach((stat) => {
        if (stat.type === 'outbound-rtp' && stat.kind === 'audio' && !stat.isRemote) outbound = stat
      })
      if (outbound) {
        const previous = sharedAudioBitrateHistory.get(entry.producer.id)
        const bytesSent = Number(outbound.bytesSent)
        const timestamp = Number(outbound.timestamp)
        if (previous && timestamp > previous.timestamp && bytesSent >= previous.bytesSent) {
          kbps = (bytesSent - previous.bytesSent) * 8 / (timestamp - previous.timestamp)
        }
        sharedAudioBitrateHistory.set(entry.producer.id, { bytesSent, timestamp })
      }
    } catch (_) { /* outbound audio stats vary by browser */ }

    sharedAudioStats.value = {
      kbps: Number.isFinite(kbps) ? Math.max(0, kbps) : 0,
      level,
      dbfs
    }
  }

  function ensureSharedAudioStatsTimer() {
    if (sharedAudioStatsIntervalId) return
    updateSharedAudioStats()
    sharedAudioStatsIntervalId = setInterval(updateSharedAudioStats, 250)
  }

  function stopSharedAudioStatsTimerIfIdle() {
    const hasSharedAudio = Array.from(producers.value.values()).some(entry => entry.source === 'screen-audio')
    if (hasSharedAudio) return
    if (sharedAudioStatsIntervalId) clearInterval(sharedAudioStatsIntervalId)
    sharedAudioStatsIntervalId = null
    sharedAudioBitrateHistory.clear()
    sharedAudioStats.value = { kbps: 0, level: 0, dbfs: -60 }
  }

  function setSharedAudioVolume(value) {
    const gain = Math.min(1, Math.max(0, Number(value) / 100))
    producers.value.forEach((entry) => {
      if (entry.source !== 'screen-audio' || !entry.gainNode) return
      const now = entry.audioContext?.currentTime || 0
      entry.gainNode.gain.setTargetAtTime(gain, now, 0.015)
    })
  }

  function getSystemAudioProduceOptions() {
    const bitrate = getEffectiveSystemAudioBitrate(useSettingsStore().systemAudioBitrate) * 1000
    return {
      encodings: [{ maxBitrate: bitrate }],
      codecOptions: {
        opusStereo: true,
        opusDtx: false,
        opusFec: true,
        opusNack: true,
        opusPtime: 10,
        opusMaxAverageBitrate: bitrate
      }
    }
  }

  function getEffectiveSystemAudioBitrate(requestedValue) {
    const requested = Math.min(256, Math.max(64, Number(requestedValue) || 128))
    try {
      const voiceStore = useVoiceStore()
      const channel = voiceStore.currentChannelId
        ? useChannelsStore().getChannelById(voiceStore.currentChannelId)
        : null
      const channelLimit = Number(channel?.audio_bitrate)
      return Number.isFinite(channelLimit) && channelLimit > 0
        ? Math.min(requested, channelLimit)
        : requested
    } catch (_) {
      return requested
    }
  }

  async function setSystemAudioBitrate(value) {
    const maxBitrate = getEffectiveSystemAudioBitrate(value) * 1000
    const entries = Array.from(producers.value.values()).filter(entry => entry.source === 'screen-audio')
    await Promise.all(entries.map(entry => entry.producer.setRtpEncodingParameters?.({ maxBitrate })))
  }

  const producerOwner = new Map()

  const iceConnectedBoth = ref(false)

  const lastInRoom = ref([])

  const remoteProducersCount = ref(0)

  const producerCname = new Map()

  const cnameOwner = new Map()


  try {
    if (typeof window !== 'undefined') {
      Object.defineProperty(window, 'sfuDebug', {
        configurable: true,
        enumerable: false,
        get() {
          return {
            lastSentClientRtpCapabilities: lastSentClientRtpCapabilities?.value || null,
            lastReceivedConsumerParams: lastReceivedConsumerParams?.value || null,
            lastPong: lastPong?.value || null,
            producerOwner: Array.from(producerOwner.entries()),
            failedConsumeProducers: Array.from(failedConsumeProducers.values())
          }
        }
      })
    }
  } catch (_) { /* noop */ }





  function normalizeRtpCapabilities(orig) {
    try {
      if (!orig) return orig
      const caps = JSON.parse(JSON.stringify(orig))
  if (!Array.isArray(caps.codecs)) return caps
      caps.codecs = caps.codecs.map(c => {
        try {
          const out = Object.assign({}, c)
          if (!out.parameters || typeof out.parameters !== 'object') out.parameters = {}
          const mime = (out.mimeType || '').toLowerCase()
          if (mime.includes('opus')) {


            if (typeof out.parameters['sprop-stereo'] === 'undefined') out.parameters['sprop-stereo'] = 1
            if (typeof out.parameters['usedtx'] === 'undefined') out.parameters['usedtx'] = 1

            if (typeof out.channels === 'undefined' || out.channels === null) out.channels = 2
          }
          return out
        } catch (_) { return c }
      })




  return caps
    } catch (_) { return orig }
  }


  function rebindAudioAndDetectionIfNeeded(producerId, userId) {
    try {
      if (!producerId || !userId) return

      const oldEl = document.getElementById(`audio-${producerId}`)
      if (oldEl) {
        oldEl.setAttribute('data-user-id', String(userId))
        oldEl.setAttribute('data-producer-id', String(producerId))

        try {
          const sinkId = useSettingsStore().outputDeviceId
          if (sinkId && typeof oldEl.setSinkId === 'function') {
            oldEl.setSinkId(sinkId).catch(() => {})
          }
        } catch (_) { /* noop */ }

        try {
          const source = oldEl.getAttribute('data-source') || producerSources.get(producerId) || 'audio'
          oldEl.volume = useVoiceStore().getTrackVolume(userId, source)
        } catch (_) { /* noop */ }
      }

      if (voiceDetection.has(producerId)) {
        cleanupVoiceDetection(producerId)
        const consumer = consumers.value.get(producerId)
        if (consumer && consumer.track && consumer.kind === 'audio') {
          setupVoiceDetection(userId, consumer.track)
        }
      }

      try {
        const voiceStore = useVoiceStore()
        applyVolumeForTrack(userId, 'audio', voiceStore.getTrackVolume(userId, 'audio'))
        applyVolumeForTrack(userId, 'screen-audio', voiceStore.getTrackVolume(userId, 'screen-audio'))
      } catch (_) { /* noop */ }
    } catch (_) { /* noop */ }
  }

  let voiceDetectCtx = null

  const voiceDetection = new Map()

  const localProducerVads = new Map()

  function getVoiceDetectCtx() {
    if (typeof window === 'undefined') return null
    if (!voiceDetectCtx) {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return null
      voiceDetectCtx = new AC()
    }

    try { voiceDetectCtx.resume && voiceDetectCtx.resume() } catch (_) { /* noop */ }
    return voiceDetectCtx
  }

  function setupVoiceDetection(ownerId, track) {
    try {

  const isUuidV4 = (id) => typeof id === 'string' && /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(id)
  let initialUserId = producerOwner.get(ownerId) || ownerId
  console.debug(`[SFU] Setting up voice detection for producer ${ownerId} → user ${initialUserId}`)


      cleanupVoiceDetection(ownerId)



      let lastSpeaking = false;
      let speakingCount = 0;
      let notSpeakingCount = 0;
      let lastBytesReceived = null;
  const SPEAKING_DEBOUNCE = 1;
  const NOT_SPEAKING_DEBOUNCE = 2;
      const intervalId = setInterval(async () => {
        try {
          if (!track || track.readyState !== 'live' || track.muted === true || !voiceDetection.has(ownerId)) {
            cleanupVoiceDetection(ownerId);
            return;
          }
          let consumer = null;
          for (const [producerId, c] of consumers.value.entries()) {
            if (c.track === track) {
              consumer = c;
              break;
            }
          }
          if (consumer && consumer.rtpReceiver && consumer.rtpReceiver.getStats) {
            const mappedUserId = producerOwner.get(ownerId) || initialUserId;
            if (isUuidV4(mappedUserId) && mappedUserId === ownerId) {

            }
            try {
              const stats = await consumer.rtpReceiver.getStats();
              let audioLevel = 0;
              let foundStats = false;
              let bytesReceived = null;
              for (const [id, stat] of stats.entries()) {
                if (stat.type === 'inbound-rtp' && stat.kind === 'audio' && typeof stat.audioLevel === 'number') {
                  audioLevel = stat.audioLevel;
                  bytesReceived = typeof stat.bytesReceived === 'number' ? stat.bytesReceived : null;
                  foundStats = true;
                  break;
                }
              }
              {
                const receivedFreshAudio = bytesReceived === null || lastBytesReceived === null || bytesReceived > lastBytesReceived;
                const speaking = foundStats && receivedFreshAudio && audioLevel > 0.005;
                if (bytesReceived !== null) lastBytesReceived = bytesReceived;
                if (speaking) {
                  speakingCount++;
                  notSpeakingCount = 0;
                } else {
                  notSpeakingCount++;
                  speakingCount = 0;
                }

                if (speaking && !lastSpeaking && speakingCount >= SPEAKING_DEBOUNCE) {
                  try {
                    const voiceStore = useVoiceStore();
                    const targetUserId = producerOwner.get(ownerId) || initialUserId;
                    if (!(isUuidV4(targetUserId) && targetUserId === ownerId)) {
                      voiceStore.updateUserSpeaking(targetUserId, true);
                    }
                  } catch (_) { /* noop */ }
                  lastSpeaking = true;
                } else if (!speaking && lastSpeaking && notSpeakingCount >= NOT_SPEAKING_DEBOUNCE) {
                  try {
                    const voiceStore = useVoiceStore();
                    const targetUserId = producerOwner.get(ownerId) || initialUserId;
                    if (!(isUuidV4(targetUserId) && targetUserId === ownerId)) {
                      voiceStore.updateUserSpeaking(targetUserId, false);
                    }
                  } catch (_) { /* noop */ }
                  lastSpeaking = false;
                }
              }
            } catch (statsError) {
              if (lastSpeaking) {
                try {
                  const voiceStore = useVoiceStore();
                  voiceStore.updateUserSpeaking(initialUserId, false);
                } catch (_) { /* noop */ }
                lastSpeaking = false;
              }
            }
          }
        } catch (_) { /* swallow tick errors */ }
      }, 200);
      voiceDetection.set(ownerId, { intervalId, track, userId: initialUserId });
    } catch (_) { /* noop */ }
  }

  function cleanupVoiceDetection(ownerId) {
    const entry = voiceDetection.get(ownerId)
    if (!entry) return
    try {
      if (entry.intervalId) clearInterval(entry.intervalId)
    } catch (_) { /* noop */ }
    voiceDetection.delete(ownerId)
    try {
      useVoiceStore().updateUserSpeaking(entry.userId || ownerId, false)
    } catch (_) { /* noop */ }
  }

  function cleanupAllVoiceDetections() {
    for (const key of Array.from(voiceDetection.keys())) {
      cleanupVoiceDetection(key)
    }
  }



  function setupLocalVADForProducer(producerId, track, userId) {
    try {
      if (!track || track.readyState !== 'live' || !userId) return

      if (localProducerVads.has(producerId)) return
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return
      const audioCtx = new AC()
      try { audioCtx.resume && audioCtx.resume() } catch (_) {}
      const src = audioCtx.createMediaStreamSource(new MediaStream([track]))
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 512
      src.connect(analyser)
      const dataArray = new Uint8Array(analyser.fftSize)
      let speaking = false
      let silentCount = 0
  const SPEAKING_DEBOUNCE = 1
  const NOT_SPEAKING_DEBOUNCE = 2
      let speakingCount = 0

      const normalizedUserId = String(userId)
      let lastRmsLog = 0

      const endedHandler = () => {
        try { clearInterval(intervalId) } catch (_) {}
        try { audioCtx.close() } catch (_) {}
        try {
          useVoiceStore().updateUserSpeaking(normalizedUserId, false)
        } catch (_) {}
        try { track && track.removeEventListener && track.removeEventListener('mute', muteHandler) } catch (_) {}
        try { track && track.removeEventListener && track.removeEventListener('ended', endedHandler) } catch (_) {}
        localProducerVads.delete(producerId)
      }

      const muteHandler = () => {

        try { clearInterval(intervalId) } catch (_) {}
        try { audioCtx.close() } catch (_) {}
        try {
          useVoiceStore().updateUserSpeaking(normalizedUserId, false)
        } catch (_) {}
        try { track && track.removeEventListener && track.removeEventListener('ended', endedHandler) } catch (_) {}
        try { track && track.removeEventListener && track.removeEventListener('mute', muteHandler) } catch (_) {}
        localProducerVads.delete(producerId)
      }

      const intervalId = setInterval(async () => {
        try {

          if (!track || track.readyState !== 'live' || track.muted === true || track.enabled === false) {
            try { clearInterval(intervalId) } catch (_) {}
            try { audioCtx.close() } catch (_) {}
            try {
              useVoiceStore().updateUserSpeaking(normalizedUserId, false)
            } catch (_) {}
            try { track && track.removeEventListener && track.removeEventListener('ended', endedHandler) } catch (_) {}
            try { track && track.removeEventListener && track.removeEventListener('mute', muteHandler) } catch (_) {}
            localProducerVads.delete(producerId)
            return
          }

          analyser.getByteTimeDomainData(dataArray)

          let sum = 0
          for (let i = 0; i < dataArray.length; i++) {
            const v = dataArray[i] - 128
            sum += v * v
          }
          const rms = Math.sqrt(sum / dataArray.length)



          const speakingNow = rms > 1
          if (speakingNow) {
            speakingCount++
            silentCount = 0
          } else {
            silentCount++
            speakingCount = 0
          }
          if (speakingNow && !speaking && speakingCount >= SPEAKING_DEBOUNCE) {
            speaking = true
            try {

              useVoiceStore().updateUserSpeaking(normalizedUserId, true)
            } catch (e) { console.debug('[SFU][LocalVAD] updateUserSpeaking error', e) }
          } else if (!speakingNow && speaking && silentCount >= NOT_SPEAKING_DEBOUNCE) {
            speaking = false
            try {
              useVoiceStore().updateUserSpeaking(normalizedUserId, false)
            } catch (e) { console.debug('[SFU][LocalVAD] updateUserSpeaking error', e) }
          }
        } catch (_) { /* noop */ }
      }, 200)


      track.addEventListener && track.addEventListener('ended', endedHandler)
      track.addEventListener && track.addEventListener('mute', muteHandler)
      localProducerVads.set(producerId, { intervalId, audioCtx, endedHandler, muteHandler, track })
    } catch (_) { /* noop */ }
  }

  function cleanupLocalVAD(producerId) {
    try {
      const entry = localProducerVads.get(producerId)
      if (!entry) return
      try { clearInterval(entry.intervalId) } catch (_) {}
  try { entry.track && entry.track.removeEventListener && entry.track.removeEventListener('ended', entry.endedHandler) } catch (_) {}
  try { entry.track && entry.track.removeEventListener && entry.track.removeEventListener('mute', entry.muteHandler) } catch (_) {}
      try { entry.audioCtx && entry.audioCtx.close && entry.audioCtx.close() } catch (_) {}
    } catch (_) { /* noop */ }
    try { localProducerVads.delete(producerId) } catch (_) {}
  }

  function setupMessageHandler(type, handler) {
    messageHandlers.set(type, handler)
  }

  function sendMessage(message) {
    try {
      if (ws.value && ws.value.readyState === WebSocket.OPEN) {
        ws.value.send(JSON.stringify(message));
      } else {
        messageQueue.push(message);
      }
    } catch (e) {

      try { messageQueue.push(message) } catch (_) { /* noop */ }
      console.error('[SFU] Failed to send message, queued instead', e);
    }
  }

  function sendPeerRttProbe() {
    const now = performance.now()
    const sampleCutoff = now - 30000
    for (const [userId, sample] of peerRttSamples) {
      if (sample.measuredAt < sampleCutoff) peerRttSamples.delete(userId)
    }
    const freshSamples = [...peerRttSamples.values()]
    peerRoundTripTime.value = freshSamples.length
      ? Math.max(...freshSamples.map(sample => sample.value))
      : null
    peerRoundTripTimes.value = Object.fromEntries(
      [...peerRttSamples].map(([userId, sample]) => [userId, sample.value])
    )

    if (!ws.value || ws.value.readyState !== WebSocket.OPEN || lastInRoom.value.length < 2) return
    const probeId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    pendingPeerRttProbes.set(probeId, now)
    sendMessage({ type: 'peer-rtt-probe', data: { probeId } })

    const cutoff = now - 30000
    for (const [id, startedAt] of pendingPeerRttProbes) {
      if (startedAt < cutoff) pendingPeerRttProbes.delete(id)
    }
  }

  async function fetchIceServers() {
    try {
      console.debug('[SFU] Fetching ICE servers from backend...');
      const runtimeConfig = useRuntimeConfig();
      const backend = runtimeConfig.public.apiPath;
      const servers = await $fetch(`${backend}/config`);
      if (Array.isArray(servers) && servers.length > 0) {
        iceServers.value = servers;
        console.debug('[SFU] ICE servers loaded:', servers);
      } else {
        throw new Error('Invalid ICE servers response format');
      }
    } catch (err) {
      console.error('[SFU] Failed to fetch ICE servers:', err);
      error.value = 'Unable to load ICE servers. Voice capability is disabled.';
      throw err;
    }
  }

  function processMessageQueue() {
      while (messageQueue.length > 0 && ws.value && ws.value.readyState === WebSocket.OPEN) {
        const message = messageQueue.shift();
        ws.value.send(JSON.stringify(message));
      }
    }

  async function connect(channelId) {
    try {

      manualDisconnect = false
      isShuttingDown = false
      allowReconnect = true
      transportReconnectRequested = false
      if (autoStartTimeoutId) {
        clearTimeout(autoStartTimeoutId)
        autoStartTimeoutId = null
      }
      if (reconnectTimeoutId) {
        clearTimeout(reconnectTimeoutId)
        reconnectTimeoutId = null
      }
      error.value = null
      activeChannelId = channelId


      await fetchIceServers()

      const userData = authStore.getUserData()

      if (!userData || !userData.id) {
        throw new Error('User not authenticated')
      }

      if (!channelId) {
        throw new Error('Channel ID is required')
      }

      const origin = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`
      const sfuPath = config.public.sfuPath || `${origin}/socket`

      const wsUrl = `${sfuPath}?auth=${encodeURIComponent(userData.id)}&channelId=${encodeURIComponent(channelId)}`
      console.debug('[SFU] Connecting to:', wsUrl)

      const socket = new WebSocket(wsUrl)
      ws.value = socket

      if (device.value && typeof device.value === 'object') {
        device.value.iceServers = iceServers.value
      }

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          try { socket.close() } catch (_) { /* noop */ }
          reject(new Error('Connection timeout'))
        }, 10000)

        socket.onopen = () => {
          if (ws.value !== socket) return
          clearTimeout(timeout)
          console.debug('[SFU] WebSocket connected')
          connected.value = true
          transportReconnectRequested = false
          reconnectAttempts = 0
          processMessageQueue()


          if (pingIntervalId) clearInterval(pingIntervalId)
          pingIntervalId = setInterval(() => {
            try {
              if (ws.value && ws.value.readyState === WebSocket.OPEN) {
                ws.value.send(JSON.stringify({ type: 'ping' }))
              }
            } catch (_) { /* noop */ }
          }, 15000)

          if (peerRttIntervalId) clearInterval(peerRttIntervalId)
          peerRttIntervalId = setInterval(sendPeerRttProbe, 5000)
          sendPeerRttProbe()

          try { missedPongCount = 0 } catch (_) { /* noop */ }


          const pongWatchdog = () => {
            try {
              if (typeof document !== 'undefined' && document.hidden) {


                return
              }

              const now = Date.now()
              if (!lastPong.value || (now - (lastPong.value || 0) > 15000)) {
                missedPongCount++
                console.debug('[SFU] Missed pong count:', missedPongCount)
              } else {
                missedPongCount = 0
              }
              if (missedPongCount >= allowedMisses) {
                console.error('[SFU] Pong missed threshold reached, handling disconnection')

                missedPongCount = 0
                handleDisconnection(channelId)
              }
            } catch (_) { /* noop */ }
          }
          if (pingIntervalId) {


            if (typeof window !== 'undefined') {
              try {
                if (typeof window.__sfuPongWatchdogId === 'number') clearInterval(window.__sfuPongWatchdogId)
                window.__sfuPongWatchdogId = setInterval(pongWatchdog, 15000)


                const visibilityHandler = () => {
                  try {
                    if (!document.hidden) {
                      missedPongCount = 0

                      lastPong.value = Date.now()
                    }
                  } catch (_) { /* noop */ }
                }
                document.addEventListener && document.addEventListener('visibilitychange', visibilityHandler)

                if (!window.__sfuVisibilityHandlers) window.__sfuVisibilityHandlers = []
                window.__sfuVisibilityHandlers.push(visibilityHandler)
              } catch (_) { /* noop */ }
            }
          }

          if (audioEnsureIntervalId) clearInterval(audioEnsureIntervalId)
          audioEnsureIntervalId = setInterval(() => {
            try { ensureAudioElements() } catch (_) { /* noop */ }
          }, 2000)

          setupEventHandlers()


          setTimeout(() => {
            initializeDevice()
              .then(() => resolve())
              .catch(reject)
          }, 100)
        }

        socket.onerror = (err) => {
          if (ws.value !== socket) return
          clearTimeout(timeout)
          console.error('[SFU] WebSocket error:', err)
          error.value = 'Connection failed'
          reject(new Error('WebSocket connection failed'))
        }

        socket.onclose = (event) => {
          if (ws.value !== socket) return
            try { console.debug('[SFU] WebSocket closed') } catch (_) { /* noop */ }


            try {
              const code = event?.code ?? null
              const reason = event?.reason || null
              if (code || reason) console.debug('[SFU] WebSocket close details - code:', code, 'reason:', reason)
            } catch (_) { /* noop */ }

            try {
              if (typeof window !== 'undefined' && window.__sfuDebugEnabled && typeof getWebRTCStatsSnapshot === 'function') {
                getWebRTCStatsSnapshot().then(snap => console.debug('[SFU] Debug stats snapshot on WS close:', snap)).catch(() => { /* noop */ })
              }
            } catch (_) { /* noop */ }
          connected.value = false
          ws.value = null

          if (pingIntervalId) {
            clearInterval(pingIntervalId)
            pingIntervalId = null
          }
          if (audioEnsureIntervalId) {
            clearInterval(audioEnsureIntervalId)
            audioEnsureIntervalId = null
          }

          cleanupAllVoiceDetections()
          producerOwner.clear()

          resetMediaSessionForReconnect()

          if (hasEstablishedSession && !manualDisconnect && allowReconnect && !isShuttingDown) {
            handleDisconnection(channelId)
          }
        }

        socket.onmessage = handleMessage
      })
    } catch (err) {
      console.error('[SFU] Connection error:', err)
      error.value = err.message
      throw err
    }
  }

  function setupEventHandlers() {
    setupMessageHandler('rtp-capabilities', async ({ data }) => {
      console.debug('[SFU] Received RTP capabilities')

      if (rtpCapabilitiesTimeout) {
        clearTimeout(rtpCapabilitiesTimeout)
        rtpCapabilitiesTimeout = null
      }
      try {
        console.debug('[SFU] About to load device with RTP capabilities:', data)


        device.value = await createCleanDevice(data)

        console.debug('[SFU] Device loaded with RTP capabilities:', device.value.loaded, device.value)

        try {
          let caps = null
          try { caps = JSON.parse(JSON.stringify(device.value.rtpCapabilities)) } catch (_) { caps = device.value.rtpCapabilities }
          console.debug('[SFU] Sending client RTP capabilities back to server for consume checks:', caps)
          try { lastSentClientRtpCapabilities.value = normalizeRtpCapabilities(caps) } catch (_) { /* noop */ }
          sendMessage({ type: 'client-rtp-capabilities', data: { rtpCapabilities: normalizeRtpCapabilities(caps) } })
        } catch (e) { /* noop */ }

        createTransports()
      } catch (err) {
        console.error('[SFU] Error loading device:', err)
        error.value = 'Failed to load media device'
      }
    })



    setupMessageHandler('rtp-capabilities-ack', async (message) => {
      try {
        const data = message && message.data ? message.data : null
        console.debug('[SFU] Received rtp-capabilities-ack', data ? (typeof data === 'object' ? JSON.stringify(data) : data) : '')

        if (data && (data.codecs || data.headerExtensions)) {
          const handler = messageHandlers.get('rtp-capabilities')
          if (handler) handler({ data })
        }
      } catch (e) { /* noop */ }
    })

    setupMessageHandler('transport-params', async ({ data }) => {
      console.debug('[SFU] Received transport params:', data)

      try {
        if (!device.value) {
          console.error('[SFU] Device is not initialized before creating transport!')
          return
        } else if (!device.value.loaded) {
          console.error('[SFU] Device is not loaded before creating transport!')
          return
        }




        const transportOptions = {
          id: data.id,
          iceParameters: data.iceParameters,
          iceCandidates: data.iceCandidates,
          dtlsParameters: data.dtlsParameters,
          ...(data.sctpParameters && { sctpParameters: data.sctpParameters }),
          appData: {},
          iceServers: iceServers.value
        }
        if (!sendTransport.value) {
          console.debug('[SFU] Creating send transport with params:', data)
          try {
            sendTransport.value = device.value.createSendTransport(transportOptions)
            if (!sendTransport.value) {
              console.warn('[SFU] createSendTransport returned falsy value!', transportOptions)
            } else {
              console.debug('[SFU] Created send transport:', sendTransport.value?.id)
              setupSendTransportEvents()
            }
          } catch (err) {
            console.error('[SFU] Error creating send transport:', err, data)
            error.value = 'Failed to create send transport: ' + err.message
          }
        } else if (!recvTransport.value) {
          console.debug('[SFU] Creating recv transport with params:', data)
          try {
            recvTransport.value = device.value.createRecvTransport(transportOptions)
            if (!recvTransport.value) {
              console.warn('[SFU] createRecvTransport returned falsy value!', transportOptions)
            } else {
              console.debug('[SFU] Created recv transport:', recvTransport.value?.id)
              setupRecvTransportEvents()
            }
          } catch (err) {
            console.error('[SFU] Error creating recv transport:', err, data)
            error.value = 'Failed to create recv transport: ' + err.message
          }
        } else {
          console.warn('[SFU] Received extra transport-params, ignoring:', data)
        }
      } catch (err) {
        console.error('[SFU] Error in transport-params handler:', err)
        error.value = 'Failed to create transport: ' + err.message
      }

      if (sendTransport.value) {
        if (!transportReady.value) {
          console.debug('[SFU] Transports initialized (send present). Setting transportReady = true')
          transportReady.value = true
          hasEstablishedSession = true
          if (transportPromiseResolve) {
            transportPromiseResolve()
            transportPromiseResolve = null
          }
        }

        autoStartTimeoutId = setTimeout(async () => {
          autoStartTimeoutId = null
          try {
            if (isShuttingDown || manualDisconnect) {
              return
            }

            if (isProducing.value) {
              console.debug('[SFU] Already producing audio, skipping auto-start')
              return
            }

            if (useVoiceStore().micMuted) {
              console.debug('[SFU] Microphone is muted; skipping automatic audio production')
              return
            }

            if (typeof navigator !== 'undefined' && navigator.mediaDevices) {


              let probeConstraints = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }
              let selectedDeviceId = null
              try {
                const settings = useSettingsStore()
                probeConstraints = { audio: { ...settings.audio } }
                selectedDeviceId = settings.micDeviceId
              } catch (_) { /* noop */ }
              if (selectedDeviceId) {
                try {
                  const withDevice = { audio: { ...probeConstraints.audio, deviceId: { exact: selectedDeviceId } } }
                  const stream = await navigator.mediaDevices.getUserMedia(withDevice)
                  stream.getTracks().forEach(track => track.stop())
                } catch (e) {
                  const stream = await navigator.mediaDevices.getUserMedia(probeConstraints)
                  stream.getTracks().forEach(track => track.stop())
                }
              } else {
                const stream = await navigator.mediaDevices.getUserMedia(probeConstraints)
                stream.getTracks().forEach(track => track.stop())
              }


      console.debug('[SFU] Auto-starting audio production')
      await startAudioProduction()
            }
          } catch (err) {
            console.debug('[SFU] Auto audio production failed (permission likely denied):', err)
          }


    }, 100)
      } else {
        console.debug('[SFU] Waiting for both transports. send:', !!sendTransport.value, 'recv:', !!recvTransport.value)
      }
    })

    setupMessageHandler('transport-connected', (message) => {
      const transportId = message.transportId || message.data?.transportId
      console.debug('[SFU] Transport connected:', transportId)
      if (transportId && pendingTransportConnect.has(transportId)) {
        const cb = pendingTransportConnect.get(transportId)
        pendingTransportConnect.delete(transportId)
        try { cb() } catch (_) { /* noop */ }
      } else if (!transportId && pendingTransportConnect.size > 0) {

        for (const [id, cb] of Array.from(pendingTransportConnect.entries())) {
          pendingTransportConnect.delete(id)
          try { cb() } catch (_) { /* noop */ }
        }
      }
    })

    setupMessageHandler('producer-id', ({ data }) => {
      console.debug('[SFU] Producer created:', data.id)

      const entry = pendingProduceQueue.shift()
      if (entry && typeof entry.callback === 'function') {
        try { entry.callback({ id: data.id }) } catch (_) { /* noop */ }
      }
    })


    setupMessageHandler('produced', (message) => {
      try {
        const data = message && message.data ? message.data : null
        console.debug('[SFU] Produced event received:', data)

        if (data && data.id) {
          const entry = pendingProduceQueue.shift()
          if (entry && typeof entry.callback === 'function') {
            try { entry.callback({ id: data.id }) } catch (_) { /* noop */ }
          }
        }
      } catch (e) { /* noop */ }
    })

    setupMessageHandler('consumer-params', async ({ data }) => {
      console.debug('[SFU] Received consumer params:', data)
      try { lastReceivedConsumerParams.value = data } catch (_) { /* noop */ }
      console.debug('[SFU] Full consumer-params data structure:', JSON.stringify(data, null, 2))
      try {
        const codecs = data?.rtpParameters?.codecs || []
        codecs.forEach(c => {
          if (c.parameters && Object.keys(c.parameters).length > 0) {
            console.debug(`[SFU] consumer codec ${c.mimeType} parameters:`, c.parameters)
          }
        })
      } catch (_) { /* noop */ }

      try {
        const cname = data?.rtpParameters?.rtcp?.cname
        if (data?.producerId && cname) {
          producerCname.set(data.producerId, cname)
        }
      } catch (_) { /* noop */ }

      if (data && data.producerId && data.userId) {
        console.debug(`[SFU] Explicit mapping: producer ${data.producerId} → user ${data.userId}`)
        producerOwner.set(data.producerId, data.userId)
        try {
          const cname = data?.rtpParameters?.rtcp?.cname
          if (cname) cnameOwner.set(cname, data.userId)
        } catch (_) { /* noop */ }
        rebindAudioAndDetectionIfNeeded(data.producerId, data.userId)
        try {
          const v = useVoiceStore().getUserVolume(data.userId)
          applyVolumeForUser(data.userId, v)
        } catch (_) { /* noop */ }
      } else {
        console.warn(`[SFU] No explicit user mapping in consumer-params for producer ${data.producerId}`)
      }
      if (data?.producerId) producerSources.set(data.producerId, data.source || data.kind)
  await createConsumer(data)
    })

    setupMessageHandler('new-producer', async ({ data }) => {
      console.debug('[SFU] New producer available:', data.producerId)
      if (data && data.producerId) {
        producerSources.set(data.producerId, data.source || 'video')
        const owner = data.userId || data.user_id || data.uid || data.ownerId || data.owner_id || (data.user && data.user.id)
        if (owner) {
          console.debug(`[SFU] Mapping new producer ${data.producerId} to user ${owner}`)
          producerOwner.set(data.producerId, owner)
          try { if (data.cname) cnameOwner.set(data.cname, owner) } catch (_) { /* noop */ }
          rebindAudioAndDetectionIfNeeded(data.producerId, owner)
          try {
            const v = useVoiceStore().getUserVolume(owner)
            applyVolumeForUser(owner, v)
          } catch (_) { /* noop */ }
        } else {

          try {
            const myId = useAuthStore().getUserData()?.id
            const others = Array.isArray(lastInRoom.value) ? lastInRoom.value.filter(uid => String(uid) !== String(myId) && typeof uid === 'string' && !uid.includes('-')) : []
            const taken = new Set(Array.from(producerOwner.values()).map(String))
            let candidate = null

            try {
              const cname = producerCname.get(data.producerId)
              if (cname && cnameOwner.has(cname)) {
                const mapped = cnameOwner.get(cname)
                if (others.includes(mapped)) candidate = mapped
              }
            } catch (_) { /* noop */ }
            if (!candidate) candidate = others.find(uid => !taken.has(String(uid))) || null
            if (!candidate && others.length > 0) candidate = others[0]
            if (candidate) {
              console.debug(`[SFU] Fallback mapping new producer ${data.producerId} → user ${candidate}`)
              producerOwner.set(data.producerId, candidate)
              try {
                const cname = producerCname.get(data.producerId)
                if (cname) cnameOwner.set(cname, candidate)
              } catch (_) { /* noop */ }
              rebindAudioAndDetectionIfNeeded(data.producerId, candidate)
              try {
                const v = useVoiceStore().getUserVolume(candidate)
                applyVolumeForUser(candidate, v)
              } catch (_) { /* noop */ }
            } else {
              console.debug(`[SFU] No user mapping in new-producer for ${data.producerId}`)
            }
          } catch (_) {
            console.debug(`[SFU] No user mapping in new-producer for ${data.producerId}`)
          }
        }
      }

      if (localProducerIds.has(data.producerId) || producers.value.has(data.producerId)) {
        console.debug('[SFU] Ignoring own producer')
        return
      }
      console.debug('[SFU][Debug] Requesting consumer for remote producer:', data.producerId)
      const tryRequest = () => {
        if (device.value && device.value.loaded && recvTransport.value) {
          requestConsumer(data.producerId);
        } else {
          setTimeout(tryRequest, 100);
        }
      };
      tryRequest();
    })

    setupMessageHandler('producer-closed', ({ data }) => {
      console.debug('[SFU] Producer closed:', data.producerId)
      const consumer = consumers.value.get(data.producerId)
      if (consumer) {
        inboundVideoStatsHistory.delete(consumer.id)
        consumer.close()
        consumers.value.delete(data.producerId)
        const ownerId = producerOwner.get(data.producerId) || data.producerId
        removeAudioElement(data.producerId)

        cleanupVoiceDetection(ownerId)
      }

      if (data && data.producerId) producerOwner.delete(data.producerId)
      if (data && data.producerId) {
        producerSources.delete(data.producerId)
        remoteVideoFeeds.value.delete(data.producerId)
        remoteVideoFeeds.value = new Map(remoteVideoFeeds.value)
        remoteAudioFeeds.value.delete(data.producerId)
        remoteAudioFeeds.value = new Map(remoteAudioFeeds.value)
      }
      try {
        const cname = producerCname.get(data.producerId)
        if (cname) {
          producerCname.delete(data.producerId)

          let stillUsed = false
          for (const [pid, cn] of producerCname.entries()) {
            if (cn === cname) { stillUsed = true; break }
          }
          if (!stillUsed) cnameOwner.delete(cname)
        }
      } catch (_) { /* noop */ }
    })

    setupMessageHandler('error', ({ data }) => {
      console.error('[SFU] Server error:', data)

      if (data && (data.type === 'connection' || data.type === 'voice' || data.fatal)) {
        error.value = data.message || 'Server error'
      } else {

        error.value = null

      }

      if (data && data.type === 'produce') {
        const entry = pendingProduceQueue.shift()
        if (entry && typeof entry.errback === 'function') {
          try { entry.errback(new Error(data.message || 'Producer creation failed')) } catch (_) { /* noop */ }
        }
      }





      try {

        let msg = ''
        if (typeof data === 'string') {
          msg = data
        } else if (data && typeof data === 'object') {
          msg = String(data.message || data.msg || data.error || '')
        }

        if (!msg && data && typeof data !== 'string') {
          try { msg = JSON.stringify(data) } catch (_) { msg = '' }
        }
        if (msg && /cannot consume this producer|codec\/parameter mismatch|cannot consume/i.test(msg)) {
          const caps = lastSentClientRtpCapabilities?.value || null
          const consumer = lastReceivedConsumerParams?.value || null
          console.warn('[SFU] Detected consume codec/parameter mismatch — showing compact diff')

          const summarizeCodecs = (list) => {
            if (!Array.isArray(list)) return []
            return list.map(c => ({ mimeType: c.mimeType, clockRate: c.clockRate, channels: c.channels, parameters: c.parameters }))
          }

          const rawClientCodecs = Array.isArray(caps?.codecs) ? caps.codecs : (caps && Array.isArray(caps) ? caps : [])
          const rawConsumerCodecs = Array.isArray(consumer?.rtpParameters?.codecs) ? consumer.rtpParameters.codecs : (consumer && Array.isArray(consumer) ? consumer : [])
          const clientCodecs = summarizeCodecs(rawClientCodecs)
          const consumerCodecs = summarizeCodecs(rawConsumerCodecs)
          console.debug('[SFU] client.rtpCapabilities.codecs:', clientCodecs)
          console.debug('[SFU] consumer.rtpParameters.codecs:', consumerCodecs)


          const diffs = []
          if (!Array.isArray(consumerCodecs)) {
            console.warn('[SFU] Unexpected consumer codec shape:', typeof consumerCodecs, consumerCodecs)
          } else {
            for (let i = 0; i < consumerCodecs.length; i++) {
              try {
                const cc = consumerCodecs[i]
                const mime = cc.mimeType || 'unknown'
                const match = Array.isArray(clientCodecs) ? clientCodecs.find(c2 => c2.mimeType && c2.mimeType.toLowerCase() === mime.toLowerCase()) : null
                if (!match) {
                  diffs.push(`Missing client codec: ${mime}`)
                  continue
                }

                const cChannels = Number(match.channels || 1)
                const pChannels = Number(cc.channels || 1)
                if (cChannels !== pChannels) diffs.push(`Channels mismatch for ${mime}: client=${cChannels} producer=${pChannels}`)

                const cp = match.parameters || {}
                const pp = cc.parameters || {}
                const keys = Array.from(new Set(Object.keys(cp || {}).concat(Object.keys(pp || {}))))
                for (let kIdx = 0; kIdx < keys.length; kIdx++) {
                  const k = keys[kIdx]
                  const a = typeof cp[k] === 'undefined' ? '<none>' : String(cp[k])
                  const b = typeof pp[k] === 'undefined' ? '<none>' : String(pp[k])
                  if (a !== b) diffs.push(`Param mismatch ${mime}.${k}: client=${a} producer=${b}`)
                }
              } catch (innerE) {
                diffs.push(`Error inspecting consumer codec at index ${i}: ${String(innerE)}`)
              }
            }
          }

          if (diffs.length === 0) {
            console.debug('[SFU] No codec-level diffs detected. Check headerExtensions or server-side router policies.')

            const hdr = (arr) => Array.isArray(arr) ? arr.map(h => h.uri || h) : []
            console.debug('[SFU] client.headerExtensions:', hdr(caps?.headerExtensions))
            console.debug('[SFU] consumer.headerExtensions:', hdr(consumer?.rtpParameters?.headerExtensions))
          } else {
            console.warn('[SFU] Codec diffs:', diffs)
          }
        }
      } catch (e) {
        console.warn('[SFU] Failed to generate codec diff:', e)
      }
    })

  setupMessageHandler('currentlyInChannel', async (message) => {

      const data = message && message.data ? message.data : {
        inRoom: message?.inRoom,
        producers: message?.producers,
        producerUserMap: message?.producerUserMap
      }
      if (typeof console !== 'undefined' && typeof console.debug === 'function') {
        console.debug('[SFU] Currently in channel info:', data)
        console.debug('[SFU] Full currentlyInChannel message:', JSON.stringify(message, null, 2))
      }

      if (Array.isArray(data.inRoom)) {
        console.debug('[SFU] Setting lastInRoom.value to:', data.inRoom)
        lastInRoom.value = data.inRoom.slice()
        const activeUsers = new Set(data.inRoom.map(userId => String(userId)))
        participantSfuRoundTripTimes.value = Object.fromEntries(
          Object.entries(participantSfuRoundTripTimes.value)
            .filter(([userId]) => activeUsers.has(String(userId)))
        )
        console.debug('[SFU] lastInRoom.value after setting:', lastInRoom.value)
      }

      try {
        const myId = useAuthStore().getUserData()?.id
        const localSet = new Set(localProducerIds)
        const list = Array.isArray(data.producers) ? data.producers : []

        const newCount = list.filter(pid => !localSet.has(pid) && !failedConsumeProducers.has(pid)).length
        console.debug('[SFU] Setting remoteProducersCount.value to:', newCount)
        remoteProducersCount.value = newCount
        console.debug('[SFU] remoteProducersCount.value after setting:', remoteProducersCount.value)
      } catch (_) {
        const newCount = Array.isArray(data.producers) ? data.producers.length : 0
        console.debug('[SFU] Setting remoteProducersCount.value to (fallback):', newCount)
        remoteProducersCount.value = newCount
        console.debug('[SFU] remoteProducersCount.value after setting (fallback):', remoteProducersCount.value)
      }


        if (data.producerUserMap && typeof data.producerUserMap === 'object' && Object.keys(data.producerUserMap).length > 0) {
          console.debug('[SFU] Setting up producer→user mapping:', data.producerUserMap)
          let voiceStoreInstance = null
          try {
            voiceStoreInstance = useVoiceStore()
          } catch (_) { /* noop */ }
          for (const [producerId, userId] of Object.entries(data.producerUserMap)) {
            producerOwner.set(producerId, userId)
            console.debug(`[SFU] Mapped producer ${producerId} → user ${userId}`)

            rebindAudioAndDetectionIfNeeded(producerId, userId)

            const allAudioEls = Array.from(document.querySelectorAll('audio[data-user-id]')).map(el => ({
              id: el.id,
              userId: el.getAttribute('data-user-id'),
              producerId: el.getAttribute('data-producer-id')
            }))
            console.debug('[SFU] Current audio elements:', allAudioEls)
            try {
              const v = voiceStoreInstance ? voiceStoreInstance.getUserVolume(userId) : undefined
              if (typeof v !== 'undefined') applyVolumeForUser(userId, v)
            } catch (_) { /* noop */ }
          }
        } else if (data.producerUserMap && typeof data.producerUserMap === 'object' && Object.keys(data.producerUserMap).length === 0) {
          console.warn('[SFU] WARNING: producerUserMap is empty. Backend must provide explicit mapping for stable audio routing.')
        } else if (data.producers && data.inRoom) {


        console.debug('[SFU] No explicit producer→user mapping, using fallback correlation')
        console.debug('[SFU] Producers:', data.producers)
        console.debug('[SFU] Users in room:', data.inRoom)
        const authStore = useAuthStore()
        const myUserId = authStore.getUserData()?.id

          const unmappedProducers = data.producers.filter(pid => !producerOwner.has(pid) && !localProducerIds.has(pid))

          const otherUsers = data.inRoom.filter(userId => userId !== myUserId && typeof userId === 'string' && !userId.includes('-'))

          let voiceStoreInstance = null
          try {
            voiceStoreInstance = useVoiceStore()
          } catch (_) { /* noop */ }

          const takenUsers = new Set(Array.from(producerOwner.values()).map(String))
          const availableUsers = otherUsers.filter(u => !takenUsers.has(String(u)))
          let nextIdx = 0
          for (const producerId of unmappedProducers) {
            let assign = null

            try {
              const cname = producerCname.get(producerId)
              if (cname && cnameOwner.has(cname)) {
                const mapped = cnameOwner.get(cname)
                if (otherUsers.includes(mapped)) assign = mapped
              }
            } catch (_) { /* noop */ }
            if (!assign) {
              assign = availableUsers[nextIdx] || otherUsers[nextIdx % Math.max(1, otherUsers.length)]
              if (availableUsers[nextIdx]) nextIdx++
            }
            if (assign && typeof assign === 'string' && !assign.includes('-')) {
              producerOwner.set(producerId, assign)
              console.debug(`[SFU] FALLBACK mapped producer ${producerId} → user ${assign}`)
              try { const cname = producerCname.get(producerId); if (cname) cnameOwner.set(cname, assign) } catch (_) { /* noop */ }
              rebindAudioAndDetectionIfNeeded(producerId, assign)
              try {
                if (voiceStoreInstance) {
                  const v = voiceStoreInstance.getUserVolume(assign)
                  applyVolumeForUser(assign, v)
                }
              } catch (_) { /* noop */ }
            }
          }

          try {
            const currentMappings = new Map(producerOwner)
            const counts = new Map()
            for (const uid of otherUsers) counts.set(uid, 0)
            for (const [pid, uid] of currentMappings.entries()) {
              if (typeof uid === 'string' && !uid.includes('-') && otherUsers.includes(uid) && !localProducerIds.has(pid)) {
                counts.set(uid, (counts.get(uid) || 0) + 1)
              }
            }
            const lacking = otherUsers.filter(u => (counts.get(u) || 0) === 0)
            if (lacking.length > 0) {
              for (const [pid, uid] of currentMappings.entries()) {
                if (lacking.length === 0) break
                if (!localProducerIds.has(pid) && otherUsers.includes(uid) && (counts.get(uid) || 0) > 1) {
                  const target = lacking.shift()
                  if (target) {
                    producerOwner.set(pid, target)
                    try { const cname = producerCname.get(pid); if (cname) cnameOwner.set(cname, target) } catch (_) { /* noop */ }
                    rebindAudioAndDetectionIfNeeded(pid, target)
                    try { const v = voiceStoreInstance?.getUserVolume(target); if (typeof v !== 'undefined') applyVolumeForUser(target, v) } catch (_) { /* noop */ }
                    counts.set(uid, (counts.get(uid) || 0) - 1)
                    counts.set(target, 1)
                  }
                }
              }
            }
          } catch (_) { /* noop */ }

        try {
          const container = document.getElementById('webrtc-audio-global')
          if (container) {

            const validUserIds = new Set(data.inRoom.map(u => typeof u === 'string' ? u : (u && u.id)).filter(Boolean))
            container.querySelectorAll('audio').forEach(el => {
              const userId = el.getAttribute('data-user-id')
              if (!validUserIds.has(userId)) {
                el.remove()
              }
            })

          }
        } catch (_) { /* noop */ }
      }





      (async () => {
        try {
          const voiceStore = useVoiceStore();
          const authStore = useAuthStore();
          const roomsStore = useRoomsStore();
          const myUserId = authStore.getUserData()?.id;

          const room = roomsStore.getRoomById && voiceStore.currentRoomId ? roomsStore.getRoomById(voiceStore.currentRoomId) : undefined
          if (room && Array.isArray(room.members)) {
            room.members.forEach(m => {

              voiceStore.upsertUserProfile({
                id: m.id,
                username: m.name || m.email || m.id,
                display_name: m.name || m.email || m.id,
                avatar: m.avatar
              })
            })

            if (room.owner && room.owner.id) {
              voiceStore.upsertUserProfile({
                id: room.owner.id,
                username: room.owner.name || room.owner.email || room.owner.id,
                display_name: room.owner.name || room.owner.email || room.owner.id,
                avatar: room.owner.avatar
              })
            }
          }
          if (data && Array.isArray(data.inRoom)) {

            const incomingIds = data.inRoom.map(u => typeof u === 'string' ? u : (u && u.id)).filter(Boolean)
            incomingIds.forEach(userId => {
              if (!voiceStore.isUserConnected(userId)) {
                voiceStore.addConnectedUser(userId, { id: userId });
              }
            })

            const validSet = new Set(incomingIds)
            voiceStore.getConnectedUsersArray().forEach(user => {
              if (!validSet.has(user.id)) {
                voiceStore.removeConnectedUser(user.id)
              }
            })
          }
        } catch (e) {
          window.console && window.console.warn && window.console.warn('[SFU] Failed to sync connected users:', e);
        }
      })();

  if (data && data.producers && Array.isArray(data.producers)) {
        console.debug('[SFU] Requesting consumers for existing producers:', data.producers)
        data.producers.forEach(producerId => {
          const tryRequest = () => {
    if (device.value && device.value.loaded && recvTransport.value) {
              requestConsumer(producerId);
            } else {
              setTimeout(tryRequest, 100);
            }
          };
          tryRequest();
        })
      }

      try {
        updateIceConnectedFlag(useSettingsStore().broadcastMode || remoteProducersCount.value === 0)
      } catch (_) {
        updateIceConnectedFlag(remoteProducersCount.value === 0)
      }
    })

    setupMessageHandler('connected', ({ data }) => {
      console.debug('[SFU] Connection confirmed by server:', data)



    })

    setupMessageHandler('pong', ({ data }) => {
      try {
        lastPong.value = Date.now()
        try { missedPongCount = 0 } catch (_) { /* noop */ }
      } catch (_) { /* noop */ }
    })
    setupMessageHandler('ping', ({ data }) => {
      try {

      } catch (_) { /* noop */ }
    })
    setupMessageHandler('peer-rtt-probe', ({ data }) => {
      if (!data?.probeId || !data?.originPeerId) return
      sendMessage({
        type: 'peer-rtt-echo',
        data: { probeId: data.probeId, originPeerId: data.originPeerId }
      })
    })
    setupMessageHandler('peer-rtt-result', ({ data }) => {
      const startedAt = pendingPeerRttProbes.get(data?.probeId)
      if (startedAt == null) return
      const measuredRtt = performance.now() - startedAt
      peerRttSamples.set(String(data.responderUserId || 'peer'), {
        value: measuredRtt,
        measuredAt: performance.now()
      })
      const cutoff = performance.now() - 30000
      const freshSamples = [...peerRttSamples.values()].filter(sample => sample.measuredAt >= cutoff)
      peerRoundTripTime.value = freshSamples.length
        ? Math.max(...freshSamples.map(sample => sample.value))
        : null
      peerRoundTripTimes.value = Object.fromEntries(
        [...peerRttSamples].map(([userId, sample]) => [userId, sample.value])
      )
    })
    setupMessageHandler('participant-sfu-rtt', ({ data }) => {
      const rttMs = Number(data?.rttMs)
      if (!data?.userId || !Number.isFinite(rttMs)) return
      participantSfuRoundTripTimes.value = {
        ...participantSfuRoundTripTimes.value,
        [String(data.userId)]: rttMs
      }
    })


    setupMessageHandler('server-shutdown', ({ data }) => {
      try {
        console.debug('[SFU] Server shutdown message received:', data)

        const reason = data && data.reason ? data.reason : 'unknown'
        const eta = data && typeof data.eta !== 'undefined' ? Number(data.eta) : null

        if (!eta || eta <= 10) {
          console.debug('[SFU] Server requested shutdown, closing signaling to start recovery')
          manualDisconnect = false
          if (ws.value?.readyState === WebSocket.OPEN) ws.value.close(4002, 'SFU server restart')
        }

        try {
          if (typeof window !== 'undefined' && window.__sfuDebugEnabled && typeof getWebRTCStatsSnapshot === 'function') {
            getWebRTCStatsSnapshot().then(snap => console.debug('[SFU] Debug stats snapshot on server-shutdown:', snap)).catch(() => { /* noop */ })
          }
        } catch (_) { /* noop */ }
      } catch (_) { /* noop */ }
    })

    setupMessageHandler('server-restarting', ({ data }) => {
      try {
        console.debug('[SFU] Server restarting advisory:', data)

        const eta = data && typeof data.eta !== 'undefined' ? Number(data.eta) : null
        if (eta && eta > 0) {

          allowReconnect = false
          setTimeout(() => {
            allowReconnect = true
            if (!connected.value && activeChannelId) handleDisconnection(activeChannelId)
          }, Math.min(60000, eta * 1000))
        }
      } catch (_) { /* noop */ }
    })

  setupMessageHandler('producers-list', ({ data }) => {
      console.debug('[SFU] Received producers list:', data)
      if (data && Array.isArray(data)) {
        data.forEach(producerId => {
          console.debug('[SFU] Requesting consumer for producer:', producerId)

      if (!localProducerIds.has(producerId) && !producers.value.has(producerId)) {
            requestConsumer(producerId)
          }
        })
      }
    })

    setupMessageHandler('available-producers', ({ data }) => {

      const list = Array.isArray(data) ? data : (Array.isArray(data?.producers) ? data.producers : [])
      console.debug('[SFU] Received available-producers:', list)

      try {
        const localSet = new Set(localProducerIds)
        const filtered = list.filter(pid => !localSet.has(pid) && !failedConsumeProducers.has(pid))
        remoteProducersCount.value = filtered.length
        console.debug('[SFU] remoteProducersCount updated from available-producers:', remoteProducersCount.value)
      } catch (_) { /* noop */ }


      list.forEach(pid => {
        if (!pid) return
        if (localProducerIds.has(pid) || producers.value.has(pid)) return
        if (failedConsumeProducers.has(pid)) return

        requestConsumer(pid)
      })
    })
  }

  function handleMessage(event) {
  try {
      const message = JSON.parse(event.data)
      if (typeof console !== 'undefined' && typeof console.debug === 'function') {
        console.debug('[SFU] Received message:', message.type)
      }

      const handler = messageHandlers.get(message.type)
      if (handler) {
        handler(message)
      } else {
        if (typeof console !== 'undefined' && typeof console.warn === 'function') {
          console.warn('[SFU] Unhandled message type:', message.type)
        }
      }
    } catch (err) {
      console.error('[SFU] Error parsing message:', err)

      error.value = 'Call failed: invalid message from server'
      disconnect()
    }
  }

  async function initializeDevice() {
    try {
      console.debug('[SFU] Requesting RTP capabilities')


      if (!ws.value || ws.value.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket not ready for RTP capabilities request')
      }


      rtpCapabilitiesTimeout = setTimeout(() => {
        console.error('[SFU] RTP capabilities request timed out')
        error.value = 'Failed to get RTP capabilities from server'
      }, 5000)

      sendMessage({ type: 'get-rtp-capabilities' })
    } catch (err) {
      console.error('[SFU] Error initializing device:', err)
      throw err
    }
  }


  async function createCleanDevice(rtpCapabilities) {

    const { Device } = await import('mediasoup-client');

    const newDevice = new Device();


    let cleanCapabilities;
    try {
      cleanCapabilities = JSON.parse(JSON.stringify(rtpCapabilities));
    } catch (e) {
      console.error('[SFU] Failed to deep clone RTP capabilities:', e, rtpCapabilities);
      throw new Error('Malformed RTP capabilities from server');
    }


    if (cleanCapabilities && typeof cleanCapabilities === 'object') {
      for (const key in cleanCapabilities) {
        if (typeof cleanCapabilities[key] === 'function' || typeof cleanCapabilities[key] === 'undefined') {
          delete cleanCapabilities[key];
        }
      }
    }


    if (!cleanCapabilities.codecs || !Array.isArray(cleanCapabilities.codecs)) {
      throw new Error('RTP capabilities missing codecs array');
    }
    if (!cleanCapabilities.headerExtensions || !Array.isArray(cleanCapabilities.headerExtensions)) {
      throw new Error('RTP capabilities missing headerExtensions array');
    }


    console.debug('[SFU] Sanitized RTP capabilities:', cleanCapabilities);


    await newDevice.load({
      routerRtpCapabilities: cleanCapabilities
    });

    return newDevice;
  }

  function createTransports() {
    console.debug('[SFU] Creating transports')
    transportReady.value = false


    transportPromise = new Promise((resolve) => {
      transportPromiseResolve = resolve
    })

    sendMessage({ type: 'create-transport', data: { type: 'send' } })
    sendMessage({ type: 'create-transport', data: { type: 'recv' } })
  }

  function setupSendTransportEvents() {
    sendTransport.value.on('connect', ({ dtlsParameters }, callback, errback) => {
      console.debug('[SFU] Send transport connecting')

      const cleanDtlsParameters = JSON.parse(JSON.stringify(dtlsParameters))
      sendMessage({
        type: 'connect-transport',
        data: {
          transportId: sendTransport.value.id,
          dtlsParameters: cleanDtlsParameters
        }
      })

      pendingTransportConnect.set(sendTransport.value.id, callback)
    })

    sendTransport.value.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
      console.debug('[SFU] Producing:', kind)
      try {

        const cleanRtpParameters = JSON.parse(JSON.stringify(rtpParameters))
        sendMessage({
          type: 'produce',
          data: {
            transportId: sendTransport.value.id,
            kind,
            rtpParameters: cleanRtpParameters,
            appData: JSON.parse(JSON.stringify(appData || {}))
          }
        })

        const timeoutId = setTimeout(() => {

          const idx = pendingProduceQueue.indexOf(entry)
          if (idx !== -1) {
            pendingProduceQueue.splice(idx, 1)
            try { errback(new Error('Producer creation timeout')) } catch (_) { /* noop */ }
          }
        }, 10000)
        const entry = {
          callback: (args) => { try { clearTimeout(timeoutId) } catch (_) { /* noop */ } try { callback(args) } catch (_) { /* noop */ } },
          errback: (e) => { try { clearTimeout(timeoutId) } catch (_) { /* noop */ } try { errback(e) } catch (_) { /* noop */ } }
        }
        pendingProduceQueue.push(entry)
      } catch (err) {
        console.error('[SFU] Error in produce event handler:', err)
        errback(err)
      }
    })


    sendTransport.value.on('connectionstatechange', () => {
      const state = sendTransport.value.connectionState
      console.debug('[SFU] Send transport connection state changed:', state)

      try { updateIceConnectedFlag() } catch (_) { /* noop */ }
      handleTransportConnectionState(state)
    })

  }

  function setupRecvTransportEvents() {
    recvTransport.value.on('connect', ({ dtlsParameters }, callback, errback) => {
      console.debug('[SFU] Recv transport connecting')

      const cleanDtlsParameters = JSON.parse(JSON.stringify(dtlsParameters))
      sendMessage({
        type: 'connect-transport',
        data: {
          transportId: recvTransport.value.id,
          dtlsParameters: cleanDtlsParameters
        }
      })

      pendingTransportConnect.set(recvTransport.value.id, callback)
    })


    recvTransport.value.on('connectionstatechange', () => {
      const state = recvTransport.value.connectionState
      console.debug('[SFU] Recv transport connection state changed:', state)

      try { updateIceConnectedFlag() } catch (_) { /* noop */ }
      handleTransportConnectionState(state)
    })
  }

  function handleTransportConnectionState(state) {
    if (state === 'connected') {
      if (transportDisconnectTimeoutId) {
        clearTimeout(transportDisconnectTimeoutId)
        transportDisconnectTimeoutId = null
      }
      transportReconnectRequested = false
      return
    }
    const delay = getTransportRecoveryDelayMs(state)
    if (delay == null) return
    if (manualDisconnect || isShuttingDown || !allowReconnect || transportReconnectRequested) return

    if (transportDisconnectTimeoutId) clearTimeout(transportDisconnectTimeoutId)
    transportDisconnectTimeoutId = setTimeout(() => {
      transportDisconnectTimeoutId = null
      if (manualDisconnect || isShuttingDown || !allowReconnect || transportReconnectRequested) return
      const sendState = sendTransport.value?.connectionState
      const recvState = recvTransport.value?.connectionState
      if (state === 'disconnected' && sendState !== 'disconnected' && recvState !== 'disconnected') return

      transportReconnectRequested = true
      console.warn('[SFU] RTC transport did not recover; restarting the signaling session')
      if (ws.value?.readyState === WebSocket.OPEN) {
        ws.value.close(4001, 'RTC transport recovery')
      } else {
        if (activeChannelId) handleDisconnection(activeChannelId)
      }
    }, delay)
  }


  async function getCandidatePairStats(pc) {
    if (!pc) return null;
    try {
      const stats = await pc.getStats();
      const byId = new Map()
      stats.forEach(stat => byId.set(stat.id, stat))
      let selectedPair = null;
      stats.forEach(s => {
        if (s.type === 'transport' && s.selectedCandidatePairId) {
          selectedPair = byId.get(s.selectedCandidatePairId) || selectedPair
        }
      });
      if (!selectedPair) {
        stats.forEach(s => {
          if (s.type === 'candidate-pair' && s.state === 'succeeded' && (s.nominated || s.selected)) selectedPair = s;
        });
      }
      return selectedPair;
    } catch (_) {
      return null;
    }
  }

  async function areTransportsIceConnected(broadcastMode = false) {
    try {
      const pcSend = sendTransport.value && sendTransport.value._handler && sendTransport.value._handler._pc
        ? sendTransport.value._handler._pc : null;
      const pcRecv = recvTransport.value && recvTransport.value._handler && recvTransport.value._handler._pc
        ? recvTransport.value._handler._pc : null;
      const ok = (s) => s === 'connected' || s === 'completed';
      const directions = getActiveMediaDirections(producers.value.size, remoteProducersCount.value)

      // A mediasoup transport does not start ICE until it carries media. An
      // unused send or receive direction must never block room admission.
      if (!directions.send && !directions.receive) return transportReady.value
      if (directions.send) {
        if (!pcSend || !ok(pcSend.iceConnectionState)) return false
        const pairSend = await getCandidatePairStats(pcSend)
        if (!pairSend || pairSend.state !== 'succeeded') return false
      }
      if (directions.receive) {
        if (!pcRecv || !ok(pcRecv.iceConnectionState)) return false
        const pairRecv = await getCandidatePairStats(pcRecv)
        if (!pairRecv || pairRecv.state !== 'succeeded') return false
      }
      return true
    } catch (_) {
      return false;
    }
  }

  async function updateIceConnectedFlag(broadcastMode = false) {
    iceConnectedBoth.value = await areTransportsIceConnected(broadcastMode)
  }

  async function waitForIceConnected(timeoutMs = 12000, broadcastMode = false) {
    const start = Date.now()

    if (await areTransportsIceConnected(broadcastMode)) { iceConnectedBoth.value = true; return true }
    return new Promise((resolve) => {
      const interval = setInterval(async () => {
        const done = await areTransportsIceConnected(broadcastMode)
        if (done || (Date.now() - start) > timeoutMs) {
          clearInterval(interval)
          iceConnectedBoth.value = done
          resolve(done)
        }
      }, 150)
    })
  }

  async function startAudioProduction(retryCount = 0) {
  console.debug('[SFU] startAudioProduction called', { retryCount })

    if (isProducingAudio.value) {
      console.debug('[SFU] Audio production already in progress, skipping')
      return
    }

    if (isShuttingDown || manualDisconnect) {
      return
    }

    isProducingAudio.value = true

    try {

      if (Array.from(producers.value.values()).some(entry => entry.source === 'audio')) {
        console.debug('[SFU] Already producing audio, stopping existing production first')
        stopAudioProduction()

        await new Promise(resolve => setTimeout(resolve, 100))
      }


      if (!transportReady.value && transportPromise) {
        console.debug('[SFU] Waiting for transports to be ready...')
        await transportPromise
      }

  if (!sendTransport.value || sendTransport.value.closed) {
        throw new Error('Send transport not available')
      }


      console.debug('[SFU] Send transport state:', {
        id: sendTransport.value.id,
        closed: sendTransport.value.closed,
        direction: sendTransport.value.direction,
        connectionState: sendTransport.value.connectionState
      })

  console.debug('[SFU] Starting audio production...', retryCount > 0 ? `(retry ${retryCount})` : '')


      let stream, audioTrack
      try {

        let constraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        let selectedDeviceId = null
        try {
          const settings = useSettingsStore()
          constraints = { ...constraints, ...settings.audio }
          selectedDeviceId = settings.micDeviceId
        } catch (_) { /* fallback to defaults */ }


        const supportedKeys = ['echoCancellation', 'noiseSuppression', 'autoGainControl']
        const sanitizedConstraints = {}
        for (const key of supportedKeys) {
          if (typeof constraints[key] !== 'undefined') {
            sanitizedConstraints[key] = constraints[key]
          }
        }

        console.debug('[SFU] getUserMedia constraints:', sanitizedConstraints, 'selectedDeviceId:', selectedDeviceId)

        try {
          const audioConstraints = selectedDeviceId ? { ...sanitizedConstraints, deviceId: { exact: selectedDeviceId } } : sanitizedConstraints
          stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })
        } catch (e) {

          stream = await navigator.mediaDevices.getUserMedia({ audio: sanitizedConstraints })
        }

        audioTrack = stream.getAudioTracks()[0]

        pendingStream = stream
        pendingTrack = audioTrack

        if (!audioTrack) {
          stream.getTracks().forEach(track => track.stop())
          throw new Error('No audio track available from getUserMedia')
        }


        if (audioTrack.readyState !== 'live') {
          stream.getTracks().forEach(track => track.stop())
          throw new Error(`Audio track is not live immediately after getUserMedia: ${audioTrack.readyState}`)
        }

        console.debug('[SFU] Successfully got live audio track:', {
          id: audioTrack.id,
          kind: audioTrack.kind,
          label: audioTrack.label,
          readyState: audioTrack.readyState,
          enabled: audioTrack.enabled
        })

      } catch (mediaError) {
        console.error('[SFU] Failed to get user media:', mediaError)
        throw mediaError
      }

      if (isShuttingDown || manualDisconnect) {
        try {
          if (pendingStream) pendingStream.getTracks().forEach(t => t.stop())
        } catch (_) { /* noop */ }
        pendingStream = null
        pendingTrack = null
        return
      }


      const trackEndedHandler = () => {
        console.warn('[SFU] Track ended unexpectedly during production setup')
      }


      let localAudioContext = null;
      let localAnalyser = null;
      let localSource = null;
      let vadInterval = null;
      try {
        localAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        localSource = localAudioContext.createMediaStreamSource(stream);
        localAnalyser = localAudioContext.createAnalyser();
        localAnalyser.fftSize = 512;
        localSource.connect(localAnalyser);
        const dataArray = new Uint8Array(localAnalyser.fftSize);
        let speaking = false;
        const threshold = 18;
        const silenceFrames = 6;
        let silentCount = 0;
        const myId = useAuthStore().getUserData()?.id;
        const voiceStore = useVoiceStore();
        vadInterval = setInterval(() => {
          localAnalyser.getByteTimeDomainData(dataArray);

          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            const val = dataArray[i] - 128;
            sum += val * val;
          }
          const rms = Math.sqrt(sum / dataArray.length);
          if (rms > threshold) {
            if (!speaking) {
              speaking = true;
              voiceStore.updateUserSpeaking(myId, true);
            }
            silentCount = 0;
          } else {
            silentCount++;
            if (speaking && silentCount > silenceFrames) {
              speaking = false;
              voiceStore.updateUserSpeaking(myId, false);
            }
          }
        }, 60);

        audioTrack.addEventListener('ended', () => {
          clearInterval(vadInterval);
          voiceStore.updateUserSpeaking(myId, false);
          try { localAudioContext.close(); } catch (_) {}
        });
      } catch (vadErr) {
        console.warn('[SFU] Local VAD setup failed:', vadErr);
      }
      audioTrack.addEventListener('ended', trackEndedHandler, { once: true })


      if (audioTrack.readyState !== 'live') {
        stream.getTracks().forEach(track => track.stop())
        throw new Error(`Track state changed to ${audioTrack.readyState} before produce call`)
      }

      console.debug('[SFU] Creating producer with track in state:', audioTrack.readyState)



      let maybeStereo = false
      try {
        let settings = {}
        try { settings = audioTrack.getSettings ? audioTrack.getSettings() : {} } catch (_) { settings = {} }
        const channelCount = settings.channelCount || (audioTrack && audioTrack.channelCount) || null
        if (channelCount && Number(channelCount) > 1) {
          maybeStereo = true
          console.debug('[SFU] Detected multi-channel audio track (channelCount=' + channelCount + '), requesting opus stereo in producer options')
        }
      } catch (e) { /* noop */ }


  let producer
      try {

        if (!device.value.canProduce('audio')) {
          throw new Error('Device cannot produce audio')
        }


        const isNativeTrack = (
          audioTrack instanceof MediaStreamTrack &&
          Object.getPrototypeOf(audioTrack) === MediaStreamTrack.prototype &&
          audioTrack.constructor === MediaStreamTrack
        );
        console.debug('[SFU] audioTrack instanceof MediaStreamTrack:', audioTrack instanceof MediaStreamTrack);
        console.debug('[SFU] audioTrack prototype:', Object.getPrototypeOf(audioTrack));
        console.debug('[SFU] audioTrack constructor:', audioTrack.constructor);
        if (!isNativeTrack) {
          throw new Error('audioTrack is not a native MediaStreamTrack. Prototype or constructor mismatch.');
        }


        const cleanTrack = audioTrack.clone();

        console.debug('[SFU] cleanTrack instanceof MediaStreamTrack:', cleanTrack instanceof MediaStreamTrack);
        console.debug('[SFU] cleanTrack prototype:', Object.getPrototypeOf(cleanTrack));
        console.debug('[SFU] cleanTrack constructor:', cleanTrack.constructor);





        const savedStructuredClone = typeof window !== 'undefined' ? window.structuredClone : undefined
        if (typeof window !== 'undefined') {
          try { window.structuredClone = undefined } catch (_) { /* noop */ }
        }
        try {

          let bitrateBps = null
          try {
            const v = useVoiceStore()
            const chStore = useChannelsStore()
            const channel = v.currentChannelId ? chStore.getChannelById(v.currentChannelId) : null
            const kbps = channel && typeof channel.audio_bitrate !== 'undefined' ? Number(channel.audio_bitrate) : null
            if (kbps && !Number.isNaN(kbps) && kbps > 0) bitrateBps = Math.floor(kbps * 1000)
          } catch (_) { /* optional */ }
          const produceOpts = buildVoiceProducerOptions(cleanTrack, bitrateBps)
          if (maybeStereo) {


            try { produceOpts.codecOptions.opusStereo = true } catch (_) { /* noop */ }
            try { produceOpts.codecOptions.stereo = true } catch (_) { /* noop */ }
          }
          producer = await sendTransport.value.produce(produceOpts)
        } finally {
          if (typeof window !== 'undefined') {
            try { window.structuredClone = savedStructuredClone } catch (_) { /* noop */ }
          }
        }

        audioTrack.stop();
        audioTrack = cleanTrack;

    pendingStream = null
    pendingTrack = null
      } catch (cloneError) {
        if (cloneError.name === 'DataCloneError') {
          console.debug('[SFU] DataCloneError encountered, trying last resort approach')
          try {

            let minimalProbe = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }
            let selectedDeviceId = null
            try {
              const settings = useSettingsStore()
              minimalProbe = { audio: { ...settings.audio } }
              selectedDeviceId = settings.micDeviceId
            } catch (_) { /* noop */ }
            let minimalStream
            try {
              const withDevice = selectedDeviceId ? { audio: { ...minimalProbe.audio, deviceId: { exact: selectedDeviceId } } } : minimalProbe
              minimalStream = await navigator.mediaDevices.getUserMedia(withDevice)
            } catch (e) {
              minimalStream = await navigator.mediaDevices.getUserMedia(minimalProbe)
            }
            const minimalTrack = minimalStream.getAudioTracks()[0]
            if (minimalTrack && minimalTrack.readyState === 'live') {
              stream.getTracks().forEach(track => track.stop())

              console.debug('[SFU] minimalTrack instanceof MediaStreamTrack:', minimalTrack instanceof MediaStreamTrack);
              console.debug('[SFU] minimalTrack prototype:', Object.getPrototypeOf(minimalTrack));
              console.debug('[SFU] minimalTrack constructor:', minimalTrack.constructor);

              const savedStructuredClone2 = typeof window !== 'undefined' ? window.structuredClone : undefined
              if (typeof window !== 'undefined') {
                try { window.structuredClone = undefined } catch (_) { /* noop */ }
              }
              try {

                let bitrateBps2 = null
                try {
                  const v2 = useVoiceStore()
                  const chStore2 = useChannelsStore()
                  const channel2 = v2.currentChannelId ? chStore2.getChannelById(v2.currentChannelId) : null
                  const kbps2 = channel2 && typeof channel2.audio_bitrate !== 'undefined' ? Number(channel2.audio_bitrate) : null
                  if (kbps2 && !Number.isNaN(kbps2) && kbps2 > 0) bitrateBps2 = Math.floor(kbps2 * 1000)
                } catch (_) { /* optional */ }
                const produceOpts2 = buildVoiceProducerOptions(minimalTrack, bitrateBps2)
                producer = await sendTransport.value.produce(produceOpts2)
              } finally {
                if (typeof window !== 'undefined') {
                  try { window.structuredClone = savedStructuredClone2 } catch (_) { /* noop */ }
                }
              }
              stream = minimalStream
              audioTrack = minimalTrack
      pendingStream = null
      pendingTrack = null
              console.debug('[SFU] Successfully created producer with minimal track')
            } else {
              throw new Error('Minimal track creation failed')
            }
          } catch (lastResortError) {
            console.error('[SFU] Last resort approach also failed:', lastResortError)
            throw cloneError
          }
        } else {
          throw cloneError
        }
      }


      audioTrack.removeEventListener('ended', trackEndedHandler)

  console.debug('[SFU] Producer created successfully:', producer.id)


      producers.value.set(producer.id, {
        producer,
        stream,
        track: audioTrack,
        source: 'audio'
      })

  localProducerIds.add(producer.id)

      try {
        const myId = useAuthStore().getUserData()?.id
        if (myId) setupLocalVADForProducer(producer.id, audioTrack, myId)
      } catch (_) { /* noop */ }

      isProducing.value = true

      producer.on('transportclose', () => {
        try { console.debug('[SFU] Producer transport closed - producerId:', producer?.id) } catch (_) { console.debug('[SFU] Producer transport closed') }
        const producerData = producers.value.get(producer.id)
        if (producerData) {

          producerData.stream.getTracks().forEach(track => track.stop())
          producers.value.delete(producer.id)
        }
        isProducing.value = producers.value.size > 0


        try { cleanupLocalVAD(producer.id) } catch (_) {}
      })

      producer.on('trackended', () => {
        console.debug('[SFU] Producer track ended')
        stopAudioProduction(producer.id)

        try { cleanupLocalVAD(producer.id) } catch (_) {}
      })

      console.debug('[SFU] Audio producer setup complete:', producer.id)
      return producer

    } catch (err) {
      if (isShuttingDown || manualDisconnect) {

        try {
          if (pendingStream) pendingStream.getTracks().forEach(t => t.stop())
        } catch (_) { /* noop */ }
        pendingStream = null
        pendingTrack = null

        return
      }
      console.error('[SFU] Error starting audio production:', err)

      if (isShuttingDown || manualDisconnect) {
        if (err && (err.name === 'AwaitQueueStoppedError' || /queue stopped/i.test(err.message || ''))) {
          return
        }
      }


      if ((err.name === 'InvalidStateError' && err.message.includes('track ended')) && retryCount < 2) {
        console.debug(`[SFU] Retrying audio production due to track ended error (attempt ${retryCount + 1}/3)`)
        isProducingAudio.value = false
        await new Promise(resolve => setTimeout(resolve, 200 * (retryCount + 1)))
        return startAudioProduction(retryCount + 1)
      } else if (err.name === 'DataCloneError' && retryCount < 1) {
        console.debug(`[SFU] Retrying audio production due to DataCloneError (attempt ${retryCount + 1}/2)`)
        isProducingAudio.value = false
        await new Promise(resolve => setTimeout(resolve, 500))
        return startAudioProduction(retryCount + 1)
      }


      if (err.name === 'InvalidStateError') {
        if (err.message.includes('track ended')) {
          error.value = 'Microphone track became unavailable. This may be due to system permissions or another application using the microphone.'
        } else {
          error.value = 'Invalid state for audio production. Please try again.'
        }
      } else if (err.name === 'DataCloneError') {
        error.value = 'Audio setup failed due to data serialization. This may be a browser compatibility issue. Try refreshing the page.'
      } else if (err.name === 'NotAllowedError') {
        error.value = 'Microphone permission denied'
      } else if (err.name === 'NotFoundError') {
        error.value = 'No microphone found'
      } else if (err.name === 'NotReadableError') {
        error.value = 'Microphone is already in use by another application'
      } else if (err.name === 'OverconstrainedError') {
        error.value = 'Audio constraints could not be satisfied'
      } else if (err.name === 'TypeError') {
        error.value = 'Invalid audio configuration'
      } else {
        error.value = `Failed to start audio: ${err.message}`
      }
      throw err
    } finally {
      isProducingAudio.value = false

      if (pendingStream) {
        try { pendingStream.getTracks().forEach(t => t.stop()) } catch (_) { /* noop */ }
        pendingStream = null
        pendingTrack = null
      }
    }
  }

  async function startVideoProduction(source) {
    if (source !== 'camera' && source !== 'screen') throw new Error('Invalid video source')
    if (!transportReady.value && transportPromise) await transportPromise
    if (!sendTransport.value || sendTransport.value.closed) throw new Error('Send transport not available')
    if (!device.value?.canProduce('video')) throw new Error('This browser cannot produce video')

    const existing = Array.from(producers.value.values()).find(entry => entry.source === source)
    if (existing) return existing.producer
    const settings = useSettingsStore()
    const isScreen = source === 'screen'
    const constraints = buildVideoConstraints(
      isScreen ? settings.screenVideo : settings.cameraVideo,
      { display: isScreen, deviceId: isScreen ? null : settings.cameraDeviceId }
    )

    let stream
    try {
      stream = isScreen
        ? await navigator.mediaDevices.getDisplayMedia({ video: constraints, audio: getSharedAudioCaptureConstraints() })
        : await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false })
      const track = stream.getVideoTracks()[0]
      if (!track) throw new Error(`No ${source} video track is available`)

      if (isScreen) {
        try { track.contentHint = 'motion' } catch (_) { /* browser may not expose contentHint */ }
      }

      const requestedFrameRate = isScreen ? settings.screenVideo.frameRate : settings.cameraVideo.frameRate
      const frameRate = Number(requestedFrameRate) || track.getSettings?.().frameRate || 30
      const trackSettings = track.getSettings?.() || {}
      const videoProduceOptions = buildVideoProduceOptions({
        width: trackSettings.width,
        height: trackSettings.height,
        frameRate,
        screen: isScreen
      })
      const rankedCodecs = await rankVideoCodecsByHardwarePreference(
        device.value?.rtpCapabilities?.codecs || [],
        {
          width: trackSettings.width,
          height: trackSettings.height,
          framerate: frameRate,
          bitrate: Math.max(2_500_000, (Number(trackSettings.width) || 1280) * (Number(trackSettings.height) || 720) * Number(frameRate || 30) * 0.08)
        }
      )
      const waitForEncoderStats = async (producer, timeoutMs = 1500) => {
        const deadline = Date.now() + timeoutMs
        while (Date.now() < deadline) {
          try {
            const report = await producer.getStats()
            let outbound = null
            report.forEach((stat) => {
              if (stat.type === 'outbound-rtp' && stat.kind === 'video' && stat.framesEncoded > 0) outbound = stat
            })
            if (outbound) {
              const classified = classifyCodecImplementation(outbound.encoderImplementation)
              const framesEncoded = Number(outbound.framesEncoded)
              const totalEncodeTime = Number(outbound.totalEncodeTime)
              const frameTimeMs = Number.isFinite(framesEncoded) && framesEncoded > 0 && Number.isFinite(totalEncodeTime)
                ? totalEncodeTime / framesEncoded * 1000
                : null
              if (classified.type !== 'unknown') return { type: classified.type, frameTimeMs }
              if (outbound.powerEfficientEncoder === true) return { type: 'hardware', frameTimeMs }
              if (outbound.powerEfficientEncoder === false) return { type: 'software', frameTimeMs }
            }
          } catch (_) { /* stats may not exist until the first encoded frame */ }
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        return { type: 'unknown', frameTimeMs: null }
      }

      let producer = null
      let selectedCodec = null
      let bestSoftware = null
      for (let index = 0; index < Math.max(1, rankedCodecs.length); index++) {
        const codec = rankedCodecs[index] || null
        producer = await sendTransport.value.produce({
          track,
          stopTracks: false,
          appData: { source },
          ...(codec ? { codec } : {}),
          ...videoProduceOptions
        })
        selectedCodec = codec
        const encoder = await waitForEncoderStats(producer)
        if (encoder.type === 'hardware') break
        if (!bestSoftware || (encoder.frameTimeMs != null && (bestSoftware.frameTimeMs == null || encoder.frameTimeMs < bestSoftware.frameTimeMs))) {
          bestSoftware = { codec, frameTimeMs: encoder.frameTimeMs }
        }
        const hasAnotherCodec = index < rankedCodecs.length - 1
        if (!hasAnotherCodec) break

        console.info(`[SFU] ${codec?.mimeType || 'default'} used ${encoder.type} encoding; trying the next codec`)
        sendMessage({ type: 'close-producer', data: { producerId: producer.id } })
        producer.close()
        producer = null
      }
      if (!producer) throw new Error('No compatible video encoder is available')
      if (bestSoftware?.codec && selectedCodec !== bestSoftware.codec) {
        console.info(`[SFU] No hardware encoder was instantiated; using fastest software codec ${bestSoftware.codec.mimeType}`)
        sendMessage({ type: 'close-producer', data: { producerId: producer.id } })
        producer.close()
        producer = await sendTransport.value.produce({
          track,
          stopTracks: false,
          appData: { source },
          codec: bestSoftware.codec,
          ...videoProduceOptions
        })
      }
      const entry = {
        producer,
        stream,
        track,
        source,
        targetFrameRate: Math.round(frameRate || 30),
        videoEncoding: videoProduceOptions.encodings[0],
        captureConstraints: constraints,
        resolutionScale: 1,
        backgroundFps: null,
        backgroundStatsBaseline: null
      }
      await configureVideoProducer(entry, videoProduceOptions.encodings[0])
      producers.value.set(producer.id, entry)
      localProducerIds.add(producer.id)
      producerSources.set(producer.id, source)
      localVideoFeeds.value.set(source, { producerId: producer.id, source, stream })
      localVideoFeeds.value = new Map(localVideoFeeds.value)
      const displayAudioTrack = isScreen ? stream.getAudioTracks()[0] : null
      const existingDisplayAudio = Array.from(producers.value.values()).find(entry => entry.source === 'screen-audio')
      if (displayAudioTrack && device.value?.canProduce('audio') && !existingDisplayAudio) {
        await disableSharedAudioProcessing(displayAudioTrack)
        const processedAudio = createSharedAudioTrack(displayAudioTrack)
        const audioProducer = await sendTransport.value.produce({
          track: processedAudio.track,
          stopTracks: false,
          appData: { source: 'screen-audio' },
          ...getSystemAudioProduceOptions()
        })
        const audioEntry = {
          producer: audioProducer,
          stream,
          ...processedAudio,
          source: 'screen-audio',
          ownerSource: 'screen'
        }
        producers.value.set(audioProducer.id, audioEntry)
        localProducerIds.add(audioProducer.id)
        producerSources.set(audioProducer.id, 'screen-audio')
        ensureSharedAudioStatsTimer()
        const cleanupAudio = () => stopVideoProduction('screen-audio', audioProducer.id)
        displayAudioTrack.addEventListener?.('ended', cleanupAudio, { once: true })
        audioProducer.on('trackended', cleanupAudio)
        audioProducer.on('transportclose', cleanupAudio)
      }
      startVideoFrameOptimization(entry)
      if (isScreen) setupScreenShareVisibilityProtection(entry)
      isProducing.value = true

      const cleanup = () => stopVideoProduction(source, producer.id)
      track.addEventListener?.('ended', cleanup, { once: true })
      producer.on('trackended', cleanup)
      producer.on('transportclose', cleanup)
      return producer
    } catch (err) {
      stream?.getTracks().forEach(track => track.stop())
      throw err
    }
  }

  async function configureVideoProducer(entry, encoding) {
    const sender = entry.producer?.rtpSender
    if (sender?.getParameters && sender?.setParameters) {
      try {
        const parameters = sender.getParameters()
        if (parameters.degradationPreference !== 'maintain-framerate') {
          parameters.degradationPreference = 'maintain-framerate'
          await sender.setParameters(parameters)
        }
      } catch (_) { /* browser controls degradation when this preference is unavailable */ }
    }

    try {
      await entry.producer.setRtpEncodingParameters({
        maxBitrate: encoding.maxBitrate,
        maxFramerate: encoding.maxFramerate,
        networkPriority: encoding.networkPriority,
        priority: encoding.priority,
        scaleResolutionDownBy: Number(entry.resolutionScale) || 1
      })
    } catch (_) { /* initial produce parameters remain active */ }
  }

  async function readEncodedFrameCounter(entry) {
    try {
      const report = await entry.producer.getStats()
      let outbound = null
      report.forEach((stat) => {
        if (stat.type === 'outbound-rtp' && stat.kind === 'video' && !stat.isRemote) outbound = stat
      })
      if (!outbound) return null
      const framesEncoded = Number(outbound.framesEncoded)
      const timestamp = Number(outbound.timestamp)
      return Number.isFinite(framesEncoded) && Number.isFinite(timestamp)
        ? { framesEncoded, timestamp }
        : null
    } catch (_) {
      return null
    }
  }

  async function reinforceScreenSharePerformance(entry) {
    if (!entry || entry.producer.closed || entry.track.readyState !== 'live') return
    try { entry.track.contentHint = 'motion' } catch (_) { /* unsupported */ }
    try {
      await entry.track.applyConstraints(entry.captureConstraints)
    } catch (_) { /* the selected display surface may have a fixed cadence */ }
    await configureVideoProducer(entry, entry.videoEncoding)
  }

  function setupScreenShareVisibilityProtection(entry) {
    if (typeof document === 'undefined') return
    const onVisibilityChange = async () => {
      if (entry.producer.closed || entry.track.readyState !== 'live') return
      if (document.hidden) {
        entry.backgroundStatsBaseline = await readEncodedFrameCounter(entry)
        await reinforceScreenSharePerformance(entry)
        return
      }

      const current = await readEncodedFrameCounter(entry)
      entry.backgroundFps = current && entry.backgroundStatsBaseline
        ? calculateEncodedFps(current.framesEncoded, current.timestamp, entry.backgroundStatsBaseline)
        : null
      entry.backgroundStatsBaseline = null
      await reinforceScreenSharePerformance(entry)
    }
    entry.visibilityHandler = onVisibilityChange
    document.addEventListener('visibilitychange', onVisibilityChange)
  }

  function startVideoFrameOptimization(entry) {
    let adaptation = { scale: 1, lowSamples: 0, healthySamples: 0 }
    let previous = null
    let updating = false

    entry.optimizationIntervalId = setInterval(async () => {
      if (updating || entry.producer.closed || entry.track.readyState !== 'live') return
      updating = true
      try {
        const report = await entry.producer.getStats()
        let outbound = null
        report.forEach((stat) => {
          if (stat.type === 'outbound-rtp' && stat.kind === 'video' && !stat.isRemote) outbound = stat
        })
        if (!outbound) return

        const frames = Number(outbound.framesEncoded)
        const timestamp = Number(outbound.timestamp)
        const measuredFps = calculateEncodedFps(frames, timestamp, previous)
        let sendFps = measuredFps ?? Number(outbound.framesPerSecond)
        previous = { framesEncoded: frames, timestamp }

        const next = updateVideoAdaptationState(adaptation, sendFps, entry.targetFrameRate)
        adaptation = next
        if (!next.changed) return

        await entry.producer.setRtpEncodingParameters({ scaleResolutionDownBy: next.scale })
        entry.resolutionScale = next.scale
      } catch (_) { /* optimization resumes on the next sample */ }
      finally { updating = false }
    }, 2000)
  }

  async function startSystemAudioProduction() {
    if (!transportReady.value && transportPromise) await transportPromise
    if (!sendTransport.value || sendTransport.value.closed) throw new Error('Send transport not available')
    if (!device.value?.canProduce('audio')) throw new Error('This browser cannot produce audio')

    const existing = Array.from(producers.value.values()).find(entry => entry.source === 'screen-audio')
    if (existing?.ownerSource === 'system-audio') return existing.producer
    if (existing) throw new Error('System audio is already being shared with your screen')

    let stream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: getSharedAudioCaptureConstraints(),
        systemAudio: 'include',
        selfBrowserSurface: 'exclude'
      })
      const sourceAudioTrack = stream.getAudioTracks()[0]
      if (!sourceAudioTrack) {
        stream.getTracks().forEach(track => track.stop())
        throw new Error('No system audio was shared. Select a source with audio and enable the share-audio option.')
      }
      stream.getVideoTracks().forEach(track => track.stop())
      await disableSharedAudioProcessing(sourceAudioTrack)
      const processedAudio = createSharedAudioTrack(sourceAudioTrack)

      const producer = await sendTransport.value.produce({
        track: processedAudio.track,
        stopTracks: false,
        appData: { source: 'screen-audio' },
        ...getSystemAudioProduceOptions()
      })
      const entry = { producer, stream, ...processedAudio, source: 'screen-audio', ownerSource: 'system-audio' }
      producers.value.set(producer.id, entry)
      localProducerIds.add(producer.id)
      producerSources.set(producer.id, 'screen-audio')
      isProducing.value = true
      ensureSharedAudioStatsTimer()

      const cleanup = () => stopSystemAudioProduction(producer.id)
      sourceAudioTrack.addEventListener?.('ended', cleanup, { once: true })
      producer.on('trackended', cleanup)
      producer.on('transportclose', cleanup)
      return producer
    } catch (err) {
      stream?.getTracks().forEach(track => track.stop())
      throw err
    }
  }

  function stopSystemAudioProduction(expectedProducerId = null) {
    const match = Array.from(producers.value.entries()).find(([id, entry]) =>
      entry.source === 'screen-audio' && entry.ownerSource === 'system-audio' && (!expectedProducerId || id === expectedProducerId)
    )
    if (match) stopVideoProduction('screen-audio', match[0])
  }

  function stopVideoProduction(source, expectedProducerId = null) {
    const match = Array.from(producers.value.entries()).find(([id, entry]) =>
      entry.source === source && (!expectedProducerId || id === expectedProducerId)
    )
    if (!match) return
    const [producerId, entry] = match
    if (entry.optimizationIntervalId) clearInterval(entry.optimizationIntervalId)
    if (entry.visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', entry.visibilityHandler)
    }
    sendMessage({ type: 'close-producer', data: { producerId } })
    producers.value.delete(producerId)
    outboundVideoStatsHistory.delete(producerId)
    localProducerIds.delete(producerId)
    producerSources.delete(producerId)
    localVideoFeeds.value.delete(source)
    localVideoFeeds.value = new Map(localVideoFeeds.value)
    try { if (!entry.producer.closed) entry.producer.close() } catch (_) { /* noop */ }
    try { entry.track?.stop?.() } catch (_) { /* noop */ }
    try { entry.mediaSource?.disconnect?.() } catch (_) { /* noop */ }
    try { entry.gainNode?.disconnect?.() } catch (_) { /* noop */ }
    try { entry.analyserNode?.disconnect?.() } catch (_) { /* noop */ }
    try { entry.audioContext?.close?.() } catch (_) { /* noop */ }
    entry.stream?.getTracks().forEach(track => track.stop())
    if (source === 'screen') {
      const screenAudio = Array.from(producers.value.entries()).find(([, candidate]) =>
        candidate.source === 'screen-audio' && candidate.ownerSource === 'screen'
      )
      if (screenAudio) stopVideoProduction('screen-audio', screenAudio[0])
    }
    isProducing.value = producers.value.size > 0
    stopSharedAudioStatsTimerIfIdle()
  }

  function stopAudioProduction(producerId = null) {
    if (producerId) {
      const producerData = producers.value.get(producerId)
      if (producerData?.source === 'audio') {
        sendMessage({ type: 'close-producer', data: { producerId } })

        if (producerData.producer) {
          producerData.producer.close()
        }

        if (producerData.stream) {
          producerData.stream.getTracks().forEach(track => track.stop())
        }
  producers.value.delete(producerId)
  localProducerIds.delete(producerId)
  try { cleanupLocalVAD(producerId) } catch (_) {}
      }
    } else {

      producers.value.forEach((producerData, id) => {
        if (producerData.source !== 'audio') return
        sendMessage({ type: 'close-producer', data: { producerId: id } })
        if (producerData.producer) {
          producerData.producer.close()
        }
        if (producerData.stream) {
          producerData.stream.getTracks().forEach(track => track.stop())
        }
      })
  Array.from(producers.value.entries()).forEach(([pid, entry]) => {
    if (entry.source === 'audio') {
      try { cleanupLocalVAD(pid) } catch (_) {}
      producers.value.delete(pid)
      localProducerIds.delete(pid)
    }
  })
    }

        if (failedConsumeProducers.has(producerId)) {
          console.debug('[SFU] Skipping consume request for failed producer:', producerId)
          return
        }
    isProducing.value = producers.value.size > 0
  }

  async function requestConsumer(producerId) {



    if (!device.value || !device.value.rtpCapabilities) {
      console.error('[SFU] Device not ready for consuming')
      return
    }


    if (localProducerIds.has(producerId) || producers.value.has(producerId)) {
      return
    }


    if (consumers.value.has(producerId)) {
      return
    }


    if (!recvTransport.value) {
      let attempts = 0
      await new Promise((resolve) => {
        const check = () => {
          if (recvTransport.value && recvTransport.value.connectionState !== 'closed') return resolve()
          if (++attempts > 50) return resolve()
          setTimeout(check, 100)
        }
        check()
      })
      if (!recvTransport.value) {
        console.error('[SFU] recvTransport still not ready; deferring consume for', producerId)


  setTimeout(() => { if (!consumers.value.has(producerId)) requestConsumer(producerId) }, 750)
        return
      }
    }


    let safeCaps = null
    try {

      const preferred = device.value && device.value._recvRtpCapabilities ? device.value._recvRtpCapabilities : device.value.rtpCapabilities
      safeCaps = JSON.parse(JSON.stringify(preferred))
    } catch (_) { safeCaps = device.value.rtpCapabilities }

    try {

  try {
    const now = Date.now()
    const payloadStr = JSON.stringify(safeCaps || {})
    const shouldSend = (now - lastClientRtpCapsSentAt) > 2000 || payloadStr !== lastClientRtpCapsPayload
    if (shouldSend) {
      const norm = normalizeRtpCapabilities(safeCaps)
      console.debug('[SFU] Sending client-rtp-capabilities for consume:', norm)
      try { lastSentClientRtpCapabilities.value = norm } catch (_) { /* noop */ }
      sendMessage({ type: 'client-rtp-capabilities', data: { rtpCapabilities: norm } })
      lastClientRtpCapsSentAt = now
      lastClientRtpCapsPayload = payloadStr
    } else {

      console.debug('[SFU] Skipping duplicate client-rtp-capabilities send')
    }
  } catch (e) {
    console.warn('[SFU] Failed to send client-rtp-capabilities:', e)
  }
    } catch (e) { console.warn('[SFU] Failed to send client-rtp-capabilities:', e) }
    sendMessage({
      type: 'consume',
      data: {
        producerId,
        rtpCapabilities: safeCaps,
        transportId: recvTransport.value.id
      }
    })


    if (pendingConsume.has(producerId)) {
      clearTimeout(pendingConsume.get(producerId))
    }
  const timeoutId = setTimeout(() => {

      if (!consumers.value.has(producerId)) {
        console.debug('[SFU] Specific consume timed out; will not send generic consume without producerId to avoid server errors')
        try {
          failedConsumeProducers.add(producerId)
          console.debug('[SFU] Marking producer as failed to consume:', producerId)
        } catch (_) { /* noop */ }
      }
      pendingConsume.delete(producerId)
  }, 3000)
    pendingConsume.set(producerId, timeoutId)
  }

  async function createConsumer(consumerData) {
    try {
      if (!recvTransport.value) {
        console.error('[SFU] Recv transport not available')
        return
      }

      const consumer = await recvTransport.value.consume({
        id: consumerData.id,
        producerId: consumerData.producerId,
        kind: consumerData.kind,
        rtpParameters: consumerData.rtpParameters
      })

      consumers.value.set(consumerData.producerId, consumer)

      if (consumer.kind === 'audio' && consumer.rtpReceiver) {
        try {
          if ('playoutDelayHint' in consumer.rtpReceiver) {
            consumer.rtpReceiver.playoutDelayHint = 0
          }
        } catch (_) { /* browser may expose a read-only or unsupported hint */ }
      }


      if (pendingConsume.has(consumerData.producerId)) {
        clearTimeout(pendingConsume.get(consumerData.producerId))
        pendingConsume.delete(consumerData.producerId)
      }


      try {
        if (!producerOwner.has(consumerData.producerId)) {
          const myId = useAuthStore().getUserData()?.id
          const others = Array.isArray(lastInRoom.value)
            ? lastInRoom.value.filter(uid => String(uid) !== String(myId) && typeof uid === 'string' && !uid.includes('-'))
            : []
          let candidate = null
          if (others.length === 1) {
            candidate = others[0]
          } else if (others.length > 1) {
            const taken = new Set(Array.from(producerOwner.values()).map(String))
            candidate = others.find(uid => !taken.has(String(uid))) || others[0]
          }
          if (candidate) {
            console.debug(`[SFU] Safety mapping in createConsumer: producer ${consumerData.producerId} → user ${candidate}`)
            producerOwner.set(consumerData.producerId, candidate)
            rebindAudioAndDetectionIfNeeded(consumerData.producerId, candidate)
            try {
              const v = useVoiceStore().getUserVolume(candidate)
              applyVolumeForUser(candidate, v)
            } catch (_) { /* noop */ }
          }
        }
      } catch (_) { /* noop */ }


      if (consumer.track && consumer.kind === 'audio') {
        console.debug('[SFU][Debug] Consumer audio track state:', {
          enabled: consumer.track.enabled,
          readyState: consumer.track.readyState,
          muted: consumer.track.muted
        })
        const ownerId = producerOwner.get(consumerData.producerId) || consumerData.producerId

        const audioSource = consumerData.source || producerSources.get(consumerData.producerId) || 'audio'
        producerSources.set(consumerData.producerId, audioSource)
        remoteAudioFeeds.value.set(consumerData.producerId, {
          producerId: consumerData.producerId,
          userId: ownerId,
          source: audioSource
        })
        remoteAudioFeeds.value = new Map(remoteAudioFeeds.value)
        createAudioElement(consumerData.producerId, ownerId, consumer.track, audioSource)

  setupVoiceDetection(ownerId, consumer.track)
        failedConsumeProducers.delete(consumerData.producerId)
      }
      if (consumer.track && consumer.kind === 'video') {
        const source = consumerData.source || producerSources.get(consumerData.producerId) || 'camera'
        const ownerId = producerOwner.get(consumerData.producerId) || consumerData.userId || consumerData.producerId
        producerSources.set(consumerData.producerId, source)
        remoteVideoFeeds.value.set(consumerData.producerId, {
          producerId: consumerData.producerId,
          userId: ownerId,
          source,
          stream: new MediaStream([consumer.track])
        })
        remoteVideoFeeds.value = new Map(remoteVideoFeeds.value)
      }



      consumer.on('transportclose', () => {
        try {
          console.debug('[SFU] Consumer transport closed - consumerId:', consumer?.id, 'producerId:', consumerData?.producerId)
        } catch (_) { console.debug('[SFU] Consumer transport closed') }
        const ownerId = producerOwner.get(consumerData.producerId) || consumerData.producerId
        removeAudioElement(consumerData.producerId)
        inboundVideoStatsHistory.delete(consumer.id)
        consumers.value.delete(consumerData.producerId)
        cleanupVoiceDetection(ownerId)
        remoteVideoFeeds.value.delete(consumerData.producerId)
        remoteVideoFeeds.value = new Map(remoteVideoFeeds.value)
        remoteAudioFeeds.value.delete(consumerData.producerId)
        remoteAudioFeeds.value = new Map(remoteAudioFeeds.value)
      })

      consumer.on('trackended', () => {
        console.debug('[SFU] Consumer track ended')
        const ownerId = producerOwner.get(consumerData.producerId) || consumerData.producerId
        removeAudioElement(consumerData.producerId)
        inboundVideoStatsHistory.delete(consumer.id)
        consumers.value.delete(consumerData.producerId)
        cleanupVoiceDetection(ownerId)
        remoteVideoFeeds.value.delete(consumerData.producerId)
        remoteVideoFeeds.value = new Map(remoteVideoFeeds.value)
        remoteAudioFeeds.value.delete(consumerData.producerId)
        remoteAudioFeeds.value = new Map(remoteAudioFeeds.value)
      })



      console.debug('[SFU] Consumer created:', consumer.id)
      return consumer
    } catch (err) {
      console.error('[SFU] Error creating consumer:', err)
    }
  }

  function getOrCreateGlobalAudioContainer() {
    let container = document.getElementById('webrtc-audio-global')
    if (!container) {
      container = document.createElement('div')
      container.id = 'webrtc-audio-global'

      container.style.position = 'fixed'
      container.style.left = '-9999px'
      container.style.top = '0'
      container.style.width = '1px'
      container.style.height = '1px'
      document.body.appendChild(container)
      console.debug('[SFU] Created global audio container')
    }
    return container
  }

  function createAudioElement(producerId, ownerId, track, source = 'audio') {
    const container = getOrCreateGlobalAudioContainer()

    const realUserId = producerOwner.get(producerId) || ownerId || producerId
    console.debug(`[SFU] Creating audio element for producer ${producerId} → user ${realUserId}`)

    removeAudioElement(producerId)

    const audio = document.createElement('audio')
    audio.id = `audio-${producerId}`
    audio.setAttribute('data-user-id', String(realUserId))
    audio.setAttribute('data-producer-id', String(producerId))
    audio.setAttribute('data-source', source)
    audio.autoplay = true
    audio.controls = false
    audio.playsInline = true
    audio.srcObject = new MediaStream([track])
    const resumePlayback = () => {
      if (!audio.muted && audio.paused) audio.play().catch(() => {})
    }
    audio.addEventListener('canplay', resumePlayback)


    function setInitialVolume(userId) {
      const voiceStore = useVoiceStore()

      const saved = voiceStore.getTrackVolume?.(userId, source)
      const volume = typeof saved === 'number' && !Number.isNaN(saved) ? saved : audio.volume
      audio.volume = volume
      applyVolumeForUser(userId, volume)
    }
    setInitialVolume(realUserId)


    if (!producerOwner.get(producerId)) {
      let mappingInterval = setInterval(() => {
        const mapped = producerOwner.get(producerId)
        if (mapped && mapped !== realUserId) {

          audio.setAttribute('data-user-id', String(mapped))
          audio.setAttribute('data-producer-id', String(producerId))
          setInitialVolume(mapped)
          clearInterval(mappingInterval)
        }
      }, 200)

      setTimeout(() => clearInterval(mappingInterval), 10000)
    }


    try {
      const settings = useSettingsStore()
      const sinkId = settings.outputDeviceId
      if (sinkId && typeof audio.setSinkId === 'function') {
        audio.setSinkId(sinkId).catch((err) => {
          console.warn('[SFU] Failed to set output device on audio element:', err)
        })
      }
      if (settings.broadcastMode) audio.muted = true
    } catch (_) { /* noop */ }


    try {
      if (useVoiceStore().deafened) audio.muted = true
    } catch (_) { /* noop */ }

    container.appendChild(audio)
    resumePlayback()
    console.debug('[SFU] Created audio element for user:', realUserId, 'with sinkId applied')
  }


  function ensureAudioElements() {
    try {
      const container = getOrCreateGlobalAudioContainer()
      consumers.value.forEach((consumer, producerId) => {
        if (!consumer || consumer.kind !== 'audio') return
        const ownerId = producerOwner.get(producerId) || producerId

        let audioEl = document.getElementById(`audio-${producerId}`)
        if (!audioEl) {
          if (consumer.track && consumer.track.readyState === 'live') {
            createAudioElement(producerId, ownerId, consumer.track, producerSources.get(producerId) || 'audio')
          }
        } else {

          const boundTrack = audioEl.srcObject?.getAudioTracks?.()[0]
          if (boundTrack !== consumer.track || boundTrack?.readyState !== 'live') {
            audioEl.srcObject = new MediaStream([consumer.track])
          }

          if (audioEl.paused && !audioEl.muted) {
            audioEl.play().catch(() => {})
          }

          try {
            const sinkId = useSettingsStore().outputDeviceId
            if (sinkId && typeof audioEl.setSinkId === 'function') {
              audioEl.setSinkId(sinkId).catch(() => {})
            }
          } catch (_) { /* noop */ }

          try {
            const voiceStore = useVoiceStore()
            const source = audioEl.getAttribute('data-source') || producerSources.get(producerId) || 'audio'
            const saved = voiceStore.getTrackVolume?.(ownerId, source)
            if (typeof saved === 'number' && !Number.isNaN(saved)) audioEl.volume = saved
          } catch (_) { /* noop */ }
        }
      })
    } catch (e) {

    }
  }

  function removeAudioElement(ownerId) {
    try {

      const direct = document.getElementById(`audio-${ownerId}`)
      if (direct) {
        direct.remove()
        console.debug(`[SFU] Removed audio element: audio-${ownerId}`)
        return
      }


      const container = document.getElementById('webrtc-audio-global')
      if (container) {
        const byUserId = container.querySelector(`audio[data-user-id="${ownerId}"]`)
        if (byUserId) {
          byUserId.remove()
          console.debug(`[SFU] Removed audio element by data-user-id: ${ownerId}`)
          return
        }

        const byProducerId = container.querySelector(`audio[data-producer-id="${ownerId}"]`)
        if (byProducerId) {
          byProducerId.remove()
          console.debug(`[SFU] Removed audio element by data-producer-id: ${ownerId}`)
          return
        }
      }
    } catch (_) { /* noop */ }
  }

  async function applyOutputDeviceToAll() {
    try {
      const settings = useSettingsStore()
      const sinkId = settings.outputDeviceId
      const container = document.getElementById('webrtc-audio-global')
      if (!container) return
      const audios = container.querySelectorAll('audio')
      audios.forEach(el => {
        if (typeof el.setSinkId === 'function') {
          if (sinkId) {
            el.setSinkId(sinkId).catch(() => { /* noop */ })
          }
        }
      })
    } catch (_) { /* noop */ }
  }




  function applyVolumeForUser(userId, volume) {
    try {
      const v = Math.max(0, Math.min(1, Number(volume)))

      let elementsFound = 0


      const container = document.getElementById('webrtc-audio-global')
      if (container) {
        container.querySelectorAll('audio').forEach((el) => {
          if (!el) return
          const dataUid = el.getAttribute('data-user-id')
          const source = el.getAttribute('data-source') || 'audio'
          if (String(dataUid) === String(userId) && source === 'audio') {
            try {
              el.volume = v
              elementsFound++
              console.debug(`[SFU] Volume updated via data-user-id: ${userId}`)
            } catch (_) { /* noop */ }
          }
        })
      }



      for (const [producerId, owner] of Array.from(producerOwner.entries())) {
        if (String(owner) === String(userId)) {
          const alt = document.getElementById(`audio-${producerId}`)
          if (alt && typeof alt.volume === 'number') {
            try {
              alt.volume = v

              if (alt.id !== `audio-${userId}`) {
                alt.id = `audio-${userId}`
                alt.setAttribute('data-user-id', String(userId))
                alt.setAttribute('data-producer-id', String(producerId))
              }
              elementsFound++
              console.debug(`[SFU] Volume updated via producer mapping: producer ${producerId} → user ${userId}`)
            } catch (_) { /* noop */ }
          }
        }
      }


      if (elementsFound === 0) {
        console.debug(`[SFU] Volume mapping issue: No audio elements found for user ${userId}`)
        if (container) {
          const available = Array.from(container.querySelectorAll('audio')).map(el => ({
            id: el.id,
            dataUserId: el.getAttribute('data-user-id'),
            dataProducerId: el.getAttribute('data-producer-id')
          }))
          console.debug(`[SFU] Available audio elements:`, available)
          console.debug(`[SFU] Producer→User mappings:`, Array.from(producerOwner.entries()))
        }
      } else {
        console.debug(`[SFU] Volume successfully updated on ${elementsFound} audio element(s) for user ${userId}`)
      }
    } catch (_) { /* noop */ }
  }

  function applyVolumeForTrack(userId, source, volume) {
    try {
      const v = Math.max(0, Math.min(1, Number(volume)))
      const container = document.getElementById('webrtc-audio-global')
      if (!container) return
      container.querySelectorAll('audio').forEach((el) => {
        if (String(el.getAttribute('data-user-id')) === String(userId) && el.getAttribute('data-source') === source) {
          el.volume = v
        }
      })
    } catch (_) { /* noop */ }
  }

  async function handleDisconnection(channelId) {
    if (manualDisconnect || isShuttingDown || !allowReconnect) {
      return
    }
    if (reconnectAttempts < maxReconnectAttempts) {
      reconnectAttempts++
      console.debug(`[SFU] Attempting reconnection ${reconnectAttempts}/${maxReconnectAttempts}`)

      if (reconnectTimeoutId) {
        clearTimeout(reconnectTimeoutId)
      }
      reconnectTimeoutId = setTimeout(() => {
        reconnectTimeoutId = null
        if (manualDisconnect || isShuttingDown || !allowReconnect) {
          return
        }
        connect(channelId).catch(err => {
          console.error('[SFU] Reconnection failed:', err)
          handleDisconnection(channelId)
        })
      }, getReconnectDelayMs(reconnectAttempts))
    } else {
      console.error('[SFU] Max reconnection attempts reached')
      error.value = 'Connection lost'
    }
  }

  function resetMediaSessionForReconnect() {
    if (transportDisconnectTimeoutId) {
      clearTimeout(transportDisconnectTimeoutId)
      transportDisconnectTimeoutId = null
    }
    for (const [producerId, entry] of producers.value) {
      try { entry.producer?.close?.() } catch (_) { /* noop */ }
      try { entry.track?.stop?.() } catch (_) { /* noop */ }
      try { entry.stream?.getTracks?.().forEach(track => track.stop()) } catch (_) { /* noop */ }
      try { entry.audioContext?.close?.() } catch (_) { /* noop */ }
      cleanupLocalVAD(producerId)
    }
    producers.value.clear()
    localProducerIds.clear()

    for (const [producerId, entry] of consumers.value) {
      const consumer = entry?.consumer || entry
      try { consumer?.close?.() } catch (_) { /* noop */ }
      removeAudioElement(producerId)
      cleanupVoiceDetection(producerId)
    }
    consumers.value.clear()
    remoteAudioFeeds.value.clear()
    remoteAudioFeeds.value = new Map(remoteAudioFeeds.value)
    remoteVideoFeeds.value.clear()
    remoteVideoFeeds.value = new Map(remoteVideoFeeds.value)
    producerOwner.clear()
    producerCname.clear()
    cnameOwner.clear()

    try { sendTransport.value?.close?.() } catch (_) { /* noop */ }
    try { recvTransport.value?.close?.() } catch (_) { /* noop */ }
    sendTransport.value = null
    recvTransport.value = null
    device.value = null
    transportReady.value = false
    iceConnectedBoth.value = false
    isProducing.value = false
    isProducingAudio.value = false
    pendingTransportConnect.clear()
    pendingProduceQueue.splice(0)
    for (const timeoutId of pendingConsume.values()) clearTimeout(timeoutId)
    pendingConsume.clear()
    messageHandlers.clear()
  }

    if (sendTransport.value) {
      sendTransport.value.close()
      sendTransport.value = null
    }

    if (recvTransport.value) {
      recvTransport.value.close()
      recvTransport.value = null
    }

    if (ws.value) {

      try {
        ws.value.onopen = null
        ws.value.onmessage = null
        ws.value.onerror = null
        ws.value.onclose = null
      } catch (_) { /* noop */ }
      try { ws.value.close() } catch (_) { /* noop */ }
      ws.value = null
    }

    if (pingIntervalId) {
      clearInterval(pingIntervalId)
      pingIntervalId = null
    }
    if (peerRttIntervalId) {
      clearInterval(peerRttIntervalId)
      peerRttIntervalId = null
    }
    pendingPeerRttProbes.clear()
    peerRttSamples.clear()
    peerRoundTripTime.value = null
    peerRoundTripTimes.value = {}
    sfuRoundTripTime.value = null
    participantSfuRoundTripTimes.value = {}

    if (audioEnsureIntervalId) {
      clearInterval(audioEnsureIntervalId)
      audioEnsureIntervalId = null
    }

    cleanupAllVoiceDetections()

    connected.value = false
    isProducing.value = false
    isProducingAudio.value = false
    transportReady.value = false
    device.value = null
    messageHandlers.clear()
    messageQueue.length = 0
    reconnectAttempts = 0
    transportPromiseResolve = null
    transportPromise = null
  iceConnectedBoth.value = false

    if (rtpCapabilitiesTimeout) {
      clearTimeout(rtpCapabilitiesTimeout)
      rtpCapabilitiesTimeout = null
    }



  function disconnect() {
    console.debug('[SFU] Disconnecting')

    manualDisconnect = true
    isShuttingDown = true
    allowReconnect = false
    activeChannelId = null
    hasEstablishedSession = false

    if (transportDisconnectTimeoutId) {
      clearTimeout(transportDisconnectTimeoutId)
      transportDisconnectTimeoutId = null
    }
    transportReconnectRequested = false


    if (autoStartTimeoutId) {
      clearTimeout(autoStartTimeoutId)
      autoStartTimeoutId = null
    }

    if (reconnectTimeoutId) {
      clearTimeout(reconnectTimeoutId)
      reconnectTimeoutId = null
    }


    stopAudioProduction()

    if (pendingStream) {
      try { pendingStream.getTracks().forEach(t => t.stop()) } catch (_) { /* noop */ }
      pendingStream = null
      pendingTrack = null
    }

    consumers.value.forEach((consumer, producerId) => {
      try { consumer.close() } catch (_) { /* noop */ }
      removeAudioElement(producerId)
      cleanupVoiceDetection(producerId)
    })
    consumers.value.clear()
    localProducerIds.clear()
    producerOwner.clear()
    producerCname.clear()
    cnameOwner.clear()

    if (sendTransport.value) {
      try { sendTransport.value.close() } catch (_) { /* noop */ }
      sendTransport.value = null
    }

    if (recvTransport.value) {
      try { recvTransport.value.close() } catch (_) { /* noop */ }
      recvTransport.value = null
    }

    if (ws.value) {

      try {
        ws.value.onopen = null
        ws.value.onmessage = null
        ws.value.onerror = null
        ws.value.onclose = null
      } catch (_) { /* noop */ }
      try { ws.value.close() } catch (_) { /* noop */ }
      ws.value = null
    }

    if (pingIntervalId) {
      clearInterval(pingIntervalId)
      pingIntervalId = null
    }
    if (peerRttIntervalId) {
      clearInterval(peerRttIntervalId)
      peerRttIntervalId = null
    }
    pendingPeerRttProbes.clear()
    peerRttSamples.clear()
    peerRoundTripTime.value = null
    peerRoundTripTimes.value = {}
    sfuRoundTripTime.value = null
    participantSfuRoundTripTimes.value = {}

    if (audioEnsureIntervalId) {
      clearInterval(audioEnsureIntervalId)
      audioEnsureIntervalId = null
    }

    cleanupAllVoiceDetections()

    connected.value = false
    isProducing.value = false
    isProducingAudio.value = false
    transportReady.value = false
    device.value = null
    messageHandlers.clear()
    messageQueue.length = 0
    reconnectAttempts = 0
    transportPromiseResolve = null
    transportPromise = null
    iceConnectedBoth.value = false

    if (rtpCapabilitiesTimeout) {
      clearTimeout(rtpCapabilitiesTimeout)
      rtpCapabilitiesTimeout = null
    }


  }



  async function getWebRTCStatsSnapshot() {
    const buildSnapshotForPc = async (pc, kind) => {
      if (!pc) return null
      try {
        const report = await pc.getStats()
        const byId = new Map()
        report.forEach(s => byId.set(s.id, s))


        let transportStat = null
        report.forEach(s => {
          if (s.type === 'transport' && (s.selectedCandidatePairId || s.dtlsState)) {
            transportStat = s
          }
        })

        let selectedPair = null
        if (transportStat && transportStat.selectedCandidatePairId) {
          selectedPair = byId.get(transportStat.selectedCandidatePairId) || null
        }
        if (!selectedPair) {
          report.forEach(s => {
            if (s.type === 'candidate-pair' && (s.nominated || s.state === 'succeeded')) {
              selectedPair = s
            }
          })
        }


        let localCandidate = null
        let remoteCandidate = null
        if (selectedPair) {
          if (selectedPair.localCandidateId) localCandidate = byId.get(selectedPair.localCandidateId) || null
          if (selectedPair.remoteCandidateId) remoteCandidate = byId.get(selectedPair.remoteCandidateId) || null
        }


        let inboundAudio = null
        let outboundAudio = null
        let remoteInboundAudio = null
        report.forEach(s => {
          if (s.type === 'inbound-rtp' && s.kind === 'audio' && !s.isRemote) inboundAudio = s
          if (s.type === 'outbound-rtp' && s.kind === 'audio' && !s.isRemote) outboundAudio = s
          if (s.type === 'remote-inbound-rtp' && s.kind === 'audio') remoteInboundAudio = s
        })

        return {
          kind,
          pcStates: {
            connectionState: pc.connectionState,
            iceConnectionState: pc.iceConnectionState,
            signalingState: pc.signalingState
          },
          transport: transportStat ? {
            id: transportStat.id,
            dtlsState: transportStat.dtlsState,
            iceRole: transportStat.iceRole,
            selectedCandidatePairId: transportStat.selectedCandidatePairId || null,
            srtpCipher: transportStat.srtpCipher || null
          } : null,
          candidatePair: selectedPair ? {
            id: selectedPair.id,
            state: selectedPair.state,
            nominated: !!selectedPair.nominated,
            currentRoundTripTime: selectedPair.currentRoundTripTime ?? null,
            availableOutgoingBitrate: selectedPair.availableOutgoingBitrate ?? null,
            bytesSent: selectedPair.bytesSent ?? null,
            bytesReceived: selectedPair.bytesReceived ?? null,
            packetsSent: selectedPair.packetsSent ?? null,
            packetsReceived: selectedPair.packetsReceived ?? null,
            requestsSent: selectedPair.requestsSent ?? null,
            responsesReceived: selectedPair.responsesReceived ?? null,
            local: localCandidate ? {
              id: localCandidate.id,
              address: localCandidate.address || localCandidate.ip || null,
              port: localCandidate.port || null,
              protocol: localCandidate.protocol || null,
              candidateType: localCandidate.candidateType || null,
              networkType: localCandidate.networkType || null
            } : null,
            remote: remoteCandidate ? {
              id: remoteCandidate.id,
              address: remoteCandidate.address || remoteCandidate.ip || null,
              port: remoteCandidate.port || null,
              protocol: remoteCandidate.protocol || null,
              candidateType: remoteCandidate.candidateType || null
            } : null
          } : null,
          inboundAudio: inboundAudio ? {
            id: inboundAudio.id,
            ssrc: inboundAudio.ssrc,
            jitter: inboundAudio.jitter ?? null,
            jitterBufferDelay: inboundAudio.jitterBufferDelay ?? null,
            jitterBufferEmittedCount: inboundAudio.jitterBufferEmittedCount ?? null,
            averageJitterBufferDelayMs: getAverageJitterBufferDelayMs(inboundAudio),
            packetsReceived: inboundAudio.packetsReceived ?? null,
            packetsLost: inboundAudio.packetsLost ?? null,
            bytesReceived: inboundAudio.bytesReceived ?? null,
            audioLevel: inboundAudio.audioLevel ?? null,
            totalSamplesDuration: inboundAudio.totalSamplesDuration ?? null
          } : null,
          outboundAudio: outboundAudio ? {
            id: outboundAudio.id,
            ssrc: outboundAudio.ssrc,
            packetsSent: outboundAudio.packetsSent ?? null,
            bytesSent: outboundAudio.bytesSent ?? null,
            retransmittedPacketsSent: outboundAudio.retransmittedPacketsSent ?? null,
            targetBitrate: outboundAudio.targetBitrate ?? null
          } : null,
          remoteInboundAudio: remoteInboundAudio ? {
            id: remoteInboundAudio.id,
            ssrc: remoteInboundAudio.ssrc,
            roundTripTime: remoteInboundAudio.roundTripTime ?? null,
            fractionLost: remoteInboundAudio.fractionLost ?? null
          } : null
        }
      } catch (e) {
        console.warn('[SFU] getWebRTCStatsSnapshot failed for', kind, e)
        return { kind, error: e?.message || String(e) }
      }
    }


    const pcSend = sendTransport.value && sendTransport.value._handler && sendTransport.value._handler._pc
      ? sendTransport.value._handler._pc : null
    const pcRecv = recvTransport.value && recvTransport.value._handler && recvTransport.value._handler._pc
      ? recvTransport.value._handler._pc : null

    const [sendSnap, recvSnap] = await Promise.all([
      buildSnapshotForPc(pcSend, 'send'),
      buildSnapshotForPc(pcRecv, 'recv')
    ])

    const localRtt = sendSnap?.candidatePair?.currentRoundTripTime
    sfuRoundTripTime.value = Number.isFinite(Number(localRtt))
      ? Number(localRtt) * 1000
      : null
    if (sfuRoundTripTime.value != null && Date.now() - lastSfuRttReportAt >= 5000) {
      lastSfuRttReportAt = Date.now()
      sendMessage({ type: 'client-sfu-rtt', data: { rttMs: sfuRoundTripTime.value } })
    }

    return {
      timestamp: Date.now(),
      peerRoundTripTime: peerRoundTripTime.value,
      transports: [sendSnap, recvSnap].filter(Boolean)
    }
  }

  async function getOutboundVideoStats() {
    const results = []
    for (const entry of producers.value.values()) {
      if (entry.source !== 'camera' && entry.source !== 'screen') continue
      const settings = entry.track?.getSettings?.() || {}
      let outbound = null
      let report = null
      try {
        report = await entry.producer.getStats()
        report.forEach((stat) => {
          if (stat.type === 'outbound-rtp' && stat.kind === 'video' && !stat.isRemote) outbound = stat
        })
      } catch (_) { /* use track settings below */ }
      const previous = outboundVideoStatsHistory.get(entry.producer.id) || null
      const framesEncoded = Number(outbound?.framesEncoded)
      const totalEncodeTime = Number(outbound?.totalEncodeTime)
      const measuredFrameTimeMs = calculateFrameTimeMs(totalEncodeTime, framesEncoded, previous)
      const frameTimeMs = measuredFrameTimeMs ?? previous?.frameTimeMs ?? null
      const outboundFps = Number(outbound?.framesPerSecond)
      if (Number.isFinite(framesEncoded) && Number.isFinite(totalEncodeTime)) {
        outboundVideoStatsHistory.set(entry.producer.id, { framesEncoded, totalEncodeTime, frameTimeMs })
      }
      results.push({
        producerId: entry.producer.id,
        source: entry.source,
        width: Number(outbound?.frameWidth || settings.width) || null,
        height: Number(outbound?.frameHeight || settings.height) || null,
        fps: Number.isFinite(outboundFps) ? outboundFps : null,
        backgroundFps: Number.isFinite(Number(entry.backgroundFps)) ? Number(entry.backgroundFps) : null,
        targetFps: Number(entry.targetFrameRate || settings.frameRate) || null,
        resolutionScale: Number(entry.resolutionScale) || 1,
        frameTimeMs,
        codec: outbound?.codecId ? report?.get?.(outbound.codecId)?.mimeType || null : null,
        encoderImplementation: outbound?.encoderImplementation || null,
        powerEfficientEncoder: typeof outbound?.powerEfficientEncoder === 'boolean' ? outbound.powerEfficientEncoder : null,
        framesEncoded: Number.isFinite(framesEncoded) ? framesEncoded : null,
        qualityLimitationReason: outbound?.qualityLimitationReason || null,
        qualityLimitationDurations: outbound?.qualityLimitationDurations || null
      })
    }
    return results
  }

  async function getInboundVideoStats() {
    const results = []
    for (const entry of consumers.value.values()) {
      const consumer = entry?.consumer || entry
      if (consumer?.kind !== 'video' && entry?.kind !== 'video') continue
      try {
        const report = await consumer.getStats()
        let inbound = null
        report.forEach((stat) => {
          if (stat.type === 'inbound-rtp' && stat.kind === 'video' && !stat.isRemote) inbound = stat
        })
        if (!inbound) continue
        const framesDecoded = Number(inbound.framesDecoded)
        const totalDecodeTime = Number(inbound.totalDecodeTime)
        const previous = inboundVideoStatsHistory.get(consumer.id) || null
        const measuredDecodeTimeMs = calculateFrameTimeMs(totalDecodeTime, framesDecoded, previous)
        const decodeTimeMs = measuredDecodeTimeMs ?? previous?.frameTimeMs ?? null
        if (Number.isFinite(framesDecoded) && Number.isFinite(totalDecodeTime)) {
          inboundVideoStatsHistory.set(consumer.id, {
            framesEncoded: framesDecoded,
            totalEncodeTime: totalDecodeTime,
            frameTimeMs: decodeTimeMs
          })
        }
        results.push({
          consumerId: consumer.id || entry?.id || null,
          width: Number(inbound.frameWidth) || null,
          height: Number(inbound.frameHeight) || null,
          fps: Number.isFinite(Number(inbound.framesPerSecond)) ? Number(inbound.framesPerSecond) : null,
          codec: inbound.codecId ? report.get?.(inbound.codecId)?.mimeType || null : null,
          decoderImplementation: inbound.decoderImplementation || null,
          powerEfficientDecoder: typeof inbound.powerEfficientDecoder === 'boolean' ? inbound.powerEfficientDecoder : null,
          decodeTimeMs,
          framesDecoded: Number.isFinite(framesDecoded) ? framesDecoded : null
        })
      } catch (_) { /* stats support varies by browser */ }
    }
    return results
  }

  return {
    connected: readonly(connected),
    error: readonly(error),
    isProducing: readonly(isProducing),
    transportReady: readonly(transportReady),
    iceConnectedBoth: readonly(iceConnectedBoth),
    producers: readonly(producers),
    consumers: readonly(consumers),
    localVideoFeeds: readonly(localVideoFeeds),
    remoteVideoFeeds: readonly(remoteVideoFeeds),
    remoteAudioFeeds: readonly(remoteAudioFeeds),
    sharedAudioStats: readonly(sharedAudioStats),
    peerRoundTripTimes: readonly(peerRoundTripTimes),
    sfuRoundTripTime: readonly(sfuRoundTripTime),
    participantSfuRoundTripTimes: readonly(participantSfuRoundTripTimes),
    remoteProducersCount: remoteProducersCount,
    lastInRoom: lastInRoom,
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
    applyOutputDeviceToAll,
    applyVolumeForUser,
    applyVolumeForTrack,
    getWebRTCStatsSnapshot,
    getInboundVideoStats,
    getOutboundVideoStats,
    ensureAudioElements,
    waitForIceConnected,
    areTransportsIceConnected
  ,

  lastSentClientRtpCapabilities: readonly(lastSentClientRtpCapabilities),
  lastReceivedConsumerParams: readonly(lastReceivedConsumerParams)
  }
}
