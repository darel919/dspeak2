import { Device } from 'mediasoup-client'
import { useRuntimeConfig } from '#app'
import { useAuthStore } from '~/stores/auth'

export function useMediasoupSfu() {
  // Track producerIds that failed to consume
  const failedConsumeProducers = new Set()
  const config = useRuntimeConfig()
  const authStore = useAuthStore()
  
  const device = ref(null)
  const ws = ref(null)
  // Timestamp of last 'pong' message received from server (for keepalive diagnostics)
  const lastPong = ref(null)
  // Runtime debug refs for capturing last sent/received protocol objects
  const lastSentClientRtpCapabilities = ref(null)
  const lastReceivedConsumerParams = ref(null)
  // ICE servers config for WebRTC transports - loaded dynamically from backend
  const iceServers = ref([])
  const sendTransport = ref(null)
  const recvTransport = ref(null)
  const producers = ref(new Map())
  const consumers = ref(new Map())
  // Track local producer ids to avoid self-consume
  const localProducerIds = new Set()
  const connected = ref(false)
  const error = ref(null)
  const isProducing = ref(false)
  const transportReady = ref(false)
  const isProducingAudio = ref(false) // Prevent concurrent production attempts
  // Pending handshake callbacks keyed by transportId
  const pendingTransportConnect = new Map()
  // Queue of pending produce callbacks (FIFO) since server response has no correlation id
  const pendingProduceQueue = []
  // Track pending consume attempts to avoid spamming and for fallback
  const pendingConsume = new Map() // producerId -> timeoutId
  // Control reconnection and shutdown behavior
  let manualDisconnect = false
  let isShuttingDown = false
  let autoStartTimeoutId = null
  // Track pending local mic resources to clean up on early exit/shutdown
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
  let allowReconnect = true
  let pingIntervalId = null // For keepalive pings
  let audioEnsureIntervalId = null // For re-attaching audio elements across navigation
  let producersRequested = false
  // Map producerId -> userId when provided by server
  const producerOwner = new Map()
  // Helper ref to reflect when both transports are ICE-connected
  const iceConnectedBoth = ref(false)
  // Track last known users in room for fallback mapping
  const lastInRoom = ref([])
  // Track count of remote producers to decide send-only connectivity when alone
  const remoteProducersCount = ref(0)
  // Map producerId -> RTCP CNAME (to group multiple producers/tracks from same remote peer)
  const producerCname = new Map()
  // Map RTCP CNAME -> userId assignment to keep grouping consistent
  const cnameOwner = new Map()

  // Expose quick debug access in browser console: window.sfuDebug
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
  

  function rebindAudioAndDetectionIfNeeded(producerId, userId) {
    try {
      if (!producerId || !userId) return
      // Always try to rebind audio element from producerId to userId
      const oldEl = document.getElementById(`audio-${producerId}`)
      const newId = `audio-${userId}`
      const existingNew = document.getElementById(newId)
      if (oldEl) {
        // If not already renamed, rename and reapply userId
        if (oldEl.id !== newId) {
          oldEl.id = newId
          oldEl.setAttribute('data-user-id', String(userId))
          oldEl.setAttribute('data-producer-id', String(producerId))
         }
        // Reapply sink/output
        try {
          import('~/stores/settings').then(({ useSettingsStore }) => {
            const settings = useSettingsStore()
            const sinkId = settings.outputDeviceId
            if (sinkId && typeof oldEl.setSinkId === 'function') {
              oldEl.setSinkId(sinkId).catch(() => { /* noop */ })
            }
          })
        } catch (_) { /* noop */ }
        // Reapply user volume
        try {
          import('~/stores/voice').then(({ useVoiceStore }) => {
            const voiceStore = useVoiceStore()
            oldEl.volume = voiceStore.getUserVolume(userId)
          })
        } catch (_) { /* noop */ }
      }
      // Always restart voice detection under userId if it exists under producerId
      if (voiceDetection.has(producerId)) {
        cleanupVoiceDetection(producerId)
        const consumer = consumers.value.get(producerId)
        if (consumer && consumer.track && consumer.kind === 'audio') {
          setupVoiceDetection(userId, consumer.track)
        }
      }
      // Ensure any element (even if created under userId already) has the correct volume
      try {
        import('~/stores/voice').then(({ useVoiceStore }) => {
          const voiceStore = useVoiceStore()
          const v = voiceStore.getUserVolume(userId)
          applyVolumeForUser(userId, v)
        })
      } catch (_) { /* noop */ }
    } catch (_) { /* noop */ }
  }
  // Shared Web Audio resources for voice detection to avoid per-interval AudioContext creation
  let voiceDetectCtx = null
  // Map: producerId -> { source, analyser, data, intervalId }
  const voiceDetection = new Map()

  function getVoiceDetectCtx() {
    if (typeof window === 'undefined') return null
    if (!voiceDetectCtx) {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return null
      voiceDetectCtx = new AC()
    }
    // Some browsers require resume before use
    try { voiceDetectCtx.resume && voiceDetectCtx.resume() } catch (_) { /* noop */ }
    return voiceDetectCtx
  }

  function setupVoiceDetection(ownerId, track) {
    try {
      // ownerId might be a producer ID - find the real user ID
  const isUuidV4 = (id) => typeof id === 'string' && /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(id)
  let initialUserId = producerOwner.get(ownerId) || ownerId
  console.log(`[SFU] Setting up voice detection for producer ${ownerId} → user ${initialUserId}`)
      
      // Avoid duplicates under the same owner key
      cleanupVoiceDetection(ownerId)
      
      // Use WebRTC native stats for voice activity detection - much more reliable than manual analysis
      // Debounce logic for VAD
      let lastSpeaking = false;
      let speakingCount = 0;
      let notSpeakingCount = 0;
      const SPEAKING_DEBOUNCE = 3; // require 3 consecutive intervals
      const NOT_SPEAKING_DEBOUNCE = 3;
      const intervalId = setInterval(async () => {
        try {
          if (!track || track.readyState !== 'live' || !voiceDetection.has(ownerId)) {
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
              // Wait for mapping
            }
            try {
              const stats = await consumer.rtpReceiver.getStats();
              let audioLevel = 0;
              let foundStats = false;
              for (const [id, stat] of stats.entries()) {
                if (stat.type === 'inbound-rtp' && stat.kind === 'audio' && typeof stat.audioLevel === 'number') {
                  audioLevel = stat.audioLevel;
                  foundStats = true;
                  break;
                }
              }
              if (foundStats) {
                const speaking = audioLevel > 0.005;
                if (speaking) {
                  speakingCount++;
                  notSpeakingCount = 0;
                } else {
                  notSpeakingCount++;
                  speakingCount = 0;
                }
                // Only update if debounce threshold met
                if (speaking && !lastSpeaking && speakingCount >= SPEAKING_DEBOUNCE) {
                  try {
                    const { useVoiceStore } = await import('~/stores/voice');
                    const voiceStore = useVoiceStore();
                    const targetUserId = producerOwner.get(ownerId) || initialUserId;
                    if (!(isUuidV4(targetUserId) && targetUserId === ownerId)) {
                      voiceStore.updateUserSpeaking(targetUserId, true);
                    }
                  } catch (_) { /* noop */ }
                  lastSpeaking = true;
                } else if (!speaking && lastSpeaking && notSpeakingCount >= NOT_SPEAKING_DEBOUNCE) {
                  try {
                    const { useVoiceStore } = await import('~/stores/voice');
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
                  const { useVoiceStore } = await import('~/stores/voice');
                  const voiceStore = useVoiceStore();
                  voiceStore.updateUserSpeaking(initialUserId, false);
                } catch (_) { /* noop */ }
                lastSpeaking = false;
              }
            }
          }
        } catch (_) { /* swallow tick errors */ }
      }, 200);
      voiceDetection.set(ownerId, { intervalId, track });
    } catch (_) { /* noop */ }
  }

  function cleanupVoiceDetection(ownerId) {
    const entry = voiceDetection.get(ownerId)
    if (!entry) return
    try {
      if (entry.intervalId) clearInterval(entry.intervalId)
    } catch (_) { /* noop */ }
    voiceDetection.delete(ownerId)
  }

  function cleanupAllVoiceDetections() {
    for (const key of Array.from(voiceDetection.keys())) {
      cleanupVoiceDetection(key)
    }
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
      // If sending fails for any reason, queue the message for later
      try { messageQueue.push(message) } catch (_) { /* noop */ }
      console.error('[SFU] Failed to send message, queued instead', e);
    }
  }

  async function fetchIceServers() {
    try {
      console.log('[SFU] Fetching ICE servers from backend...');
      const runtimeConfig = useRuntimeConfig();
      const backend = runtimeConfig.public.apiPath;
      const servers = await $fetch(`${backend}/config`);
      if (Array.isArray(servers) && servers.length > 0) {
        iceServers.value = servers;
        console.log('[SFU] ICE servers loaded:', servers);
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
      // Reset shutdown/reconnect flags on fresh connect
      manualDisconnect = false
      isShuttingDown = false
      allowReconnect = true
      if (autoStartTimeoutId) {
        clearTimeout(autoStartTimeoutId)
        autoStartTimeoutId = null
      }
      if (reconnectTimeoutId) {
        clearTimeout(reconnectTimeoutId)
        reconnectTimeoutId = null
      }
      error.value = null

      // Fetch ICE servers configuration before establishing connection
      await fetchIceServers()

      const userData = authStore.getUserData()
      
      if (!userData || !userData.id) {
        throw new Error('User not authenticated')
      }

      if (!channelId) {
        throw new Error('Channel ID is required')
      }

      const sfuPath = config.public.sfuPath
      if (!sfuPath) {
        throw new Error('SFU path not configured')
      }

      const wsUrl = `${sfuPath}?auth=${encodeURIComponent(userData.id)}&channelId=${encodeURIComponent(channelId)}`
      console.log('[SFU] Connecting to:', wsUrl)
      
      ws.value = new WebSocket(wsUrl)
      // Patch mediasoup-client device to use custom ICE servers for transports
      if (device.value && typeof device.value === 'object') {
        device.value.iceServers = iceServers.value
      }

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'))
        }, 10000)

        ws.value.onopen = () => {
          clearTimeout(timeout)
          console.log('[SFU] WebSocket connected')
          connected.value = true
          reconnectAttempts = 0
          processMessageQueue()

          // Start keepalive ping every 30 seconds
          if (pingIntervalId) clearInterval(pingIntervalId)
          pingIntervalId = setInterval(() => {
            if (ws.value && ws.value.readyState === WebSocket.OPEN) {
              ws.value.send(JSON.stringify({ type: 'ping' }))
            }
          }, 30000)
          // Periodically ensure audio elements are attached
          if (audioEnsureIntervalId) clearInterval(audioEnsureIntervalId)
          audioEnsureIntervalId = setInterval(() => {
            try { ensureAudioElements() } catch (_) { /* noop */ }
          }, 10000)

          setupEventHandlers()

          // Wait for server to send initial status messages before requesting capabilities
          setTimeout(() => {
            initializeDevice()
              .then(() => resolve())
              .catch(reject)
          }, 100)
        }

        ws.value.onerror = (err) => {
          clearTimeout(timeout)
          console.error('[SFU] WebSocket error:', err)
          error.value = 'Connection failed'
          reject(new Error('WebSocket connection failed'))
        }

        ws.value.onclose = () => {
          console.log('[SFU] WebSocket closed')
          connected.value = false
          // Stop keepalive ping
          if (pingIntervalId) {
            clearInterval(pingIntervalId)
            pingIntervalId = null
          }
          if (audioEnsureIntervalId) {
            clearInterval(audioEnsureIntervalId)
            audioEnsureIntervalId = null
          }
          // Cleanup voice detection on close to prevent leaks
          cleanupAllVoiceDetections()
          producerOwner.clear()
          // Avoid reconnection if manual/user-initiated or reconnection disabled
          if (!manualDisconnect && allowReconnect && !isShuttingDown) {
            handleDisconnection(channelId)
          }
        }

        ws.value.onmessage = handleMessage
      })
    } catch (err) {
      console.error('[SFU] Connection error:', err)
      error.value = err.message
      throw err
    }
  }

  function setupEventHandlers() {
    setupMessageHandler('rtp-capabilities', async ({ data }) => {
      console.log('[SFU] Received RTP capabilities')
      // Clear the timeout since we received the response
      if (rtpCapabilitiesTimeout) {
        clearTimeout(rtpCapabilitiesTimeout)
        rtpCapabilitiesTimeout = null
      }
      try {
        console.log('[SFU] About to load device with RTP capabilities:', data)
        
        // Create a completely clean device to avoid any DataCloneError issues
        device.value = await createCleanDevice(data)

        console.log('[SFU] Device loaded with RTP capabilities:', device.value.loaded, device.value)
        // Proactively inform server of our client recv RTP capabilities to aid consume negotiation
        try {
          let caps = null
          try { caps = JSON.parse(JSON.stringify(device.value.rtpCapabilities)) } catch (_) { caps = device.value.rtpCapabilities }
          console.log('[SFU] Sending client RTP capabilities back to server for consume checks:', caps)
          try { lastSentClientRtpCapabilities.value = caps } catch (_) { /* noop */ }
          sendMessage({ type: 'client-rtp-capabilities', data: { rtpCapabilities: caps } })
        } catch (e) { /* noop */ }

        createTransports()
      } catch (err) {
        console.error('[SFU] Error loading device:', err)
        error.value = 'Failed to load media device'
      }
    })

    setupMessageHandler('transport-params', async ({ data }) => {
      console.log('[SFU] Received transport params:', data)
      
      try {
        if (!device.value) {
          console.error('[SFU] Device is not initialized before creating transport!')
          return
        } else if (!device.value.loaded) {
          console.error('[SFU] Device is not loaded before creating transport!')
          return
        }

        // The server sends transport params directly in data, without type field
        // We need to determine if this is send or recv transport based on order
        // First transport-params received = send, second = recv
        const transportOptions = {
          id: data.id,
          iceParameters: data.iceParameters,
          iceCandidates: data.iceCandidates,
          dtlsParameters: data.dtlsParameters,
          ...(data.sctpParameters && { sctpParameters: data.sctpParameters }),
          appData: {}, // Clean appData object
          iceServers: iceServers.value // <-- ensure ICE servers are included
        }
        if (!sendTransport.value) {
          console.log('[SFU] Creating send transport with params:', data)
          try {
            sendTransport.value = device.value.createSendTransport(transportOptions)
            if (!sendTransport.value) {
              console.warn('[SFU] createSendTransport returned falsy value!', transportOptions)
            } else {
              console.log('[SFU] Created send transport:', sendTransport.value?.id)
              setupSendTransportEvents()
            }
          } catch (err) {
            console.error('[SFU] Error creating send transport:', err, data)
            error.value = 'Failed to create send transport: ' + err.message
          }
        } else if (!recvTransport.value) {
          console.log('[SFU] Creating recv transport with params:', data)
          try {
            recvTransport.value = device.value.createRecvTransport(transportOptions)
            if (!recvTransport.value) {
              console.warn('[SFU] createRecvTransport returned falsy value!', transportOptions)
            } else {
              console.log('[SFU] Created recv transport:', recvTransport.value?.id)
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
      // Mark transports ready as soon as send transport exists; recv may be absent when alone
      if (sendTransport.value) {
        if (!transportReady.value) {
          console.log('[SFU] Transports initialized (send present). Setting transportReady = true')
          transportReady.value = true
          if (transportPromiseResolve) {
            transportPromiseResolve()
            transportPromiseResolve = null
          }
        }
        // Automatically start audio production if user has mic permission
        autoStartTimeoutId = setTimeout(async () => {
          autoStartTimeoutId = null
          try {
            if (isShuttingDown || manualDisconnect) {
              return
            }
            // Only auto-start if we're not already producing
            if (isProducing.value) {
              console.log('[SFU] Already producing audio, skipping auto-start')
              return
            }
            
            if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
              // Check if we can get user media
              // Use current settings even for probe
              let probeConstraints = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }
              let selectedDeviceId = null
              try {
                const { useSettingsStore } = await import('~/stores/settings')
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
              
              // Start actual production
      console.log('[SFU] Auto-starting audio production')
      await startAudioProduction()
            }
          } catch (err) {
            console.log('[SFU] Auto audio production failed (permission likely denied):', err)
          }
          
          // Note: Don't automatically request producers - wait for currentlyInChannel or server events
    }, 100)
      } else {
        console.log('[SFU] Waiting for both transports. send:', !!sendTransport.value, 'recv:', !!recvTransport.value)
      }
    })

    setupMessageHandler('transport-connected', (message) => {
      const transportId = message.transportId || message.data?.transportId
      console.log('[SFU] Transport connected:', transportId)
      if (transportId && pendingTransportConnect.has(transportId)) {
        const cb = pendingTransportConnect.get(transportId)
        pendingTransportConnect.delete(transportId)
        try { cb() } catch (_) { /* noop */ }
      } else if (!transportId && pendingTransportConnect.size > 0) {
        // Fallback: if no id provided, resolve all pending connect callbacks
        for (const [id, cb] of Array.from(pendingTransportConnect.entries())) {
          pendingTransportConnect.delete(id)
          try { cb() } catch (_) { /* noop */ }
        }
      }
    })

    setupMessageHandler('producer-id', ({ data }) => {
      console.log('[SFU] Producer created:', data.id)
      // Resolve the oldest pending produce callback
      const entry = pendingProduceQueue.shift()
      if (entry && typeof entry.callback === 'function') {
        try { entry.callback({ id: data.id }) } catch (_) { /* noop */ }
      }
    })

    setupMessageHandler('consumer-params', async ({ data }) => {
      console.log('[SFU] Received consumer params:', data)
      try { lastReceivedConsumerParams.value = data } catch (_) { /* noop */ }
      console.log('[SFU] Full consumer-params data structure:', JSON.stringify(data, null, 2))
      try {
        const codecs = data?.rtpParameters?.codecs || []
        codecs.forEach(c => {
          if (c.parameters && Object.keys(c.parameters).length > 0) {
            console.log(`[SFU] consumer codec ${c.mimeType} parameters:`, c.parameters)
          }
        })
      } catch (_) { /* noop */ }
      // Track RTCP CNAME for this producer (if available)
      try {
        const cname = data?.rtpParameters?.rtcp?.cname
        if (data?.producerId && cname) {
          producerCname.set(data.producerId, cname)
        }
      } catch (_) { /* noop */ }
      // Always use explicit mapping if provided
      if (data && data.producerId && data.userId) {
        console.log(`[SFU] Explicit mapping: producer ${data.producerId} → user ${data.userId}`)
        producerOwner.set(data.producerId, data.userId)
        try {
          const cname = data?.rtpParameters?.rtcp?.cname
          if (cname) cnameOwner.set(cname, data.userId)
        } catch (_) { /* noop */ }
        rebindAudioAndDetectionIfNeeded(data.producerId, data.userId)
        try {
          const { useVoiceStore } = await import('~/stores/voice')
          const v = useVoiceStore().getUserVolume(data.userId)
          applyVolumeForUser(data.userId, v)
        } catch (_) { /* noop */ }
      } else {
        console.warn(`[SFU] No explicit user mapping in consumer-params for producer ${data.producerId}`)
      }
  await createConsumer(data)
    })

    setupMessageHandler('new-producer', async ({ data }) => {
      console.log('[SFU] New producer available:', data.producerId)
      if (data && data.producerId) {
        const owner = data.userId || data.user_id || data.uid || data.ownerId || data.owner_id || (data.user && data.user.id)
        if (owner) {
          console.log(`[SFU] Mapping new producer ${data.producerId} to user ${owner}`)
          producerOwner.set(data.producerId, owner)
          try { if (data.cname) cnameOwner.set(data.cname, owner) } catch (_) { /* noop */ }
          rebindAudioAndDetectionIfNeeded(data.producerId, owner)
          try {
            const { useVoiceStore } = await import('~/stores/voice')
            const v = useVoiceStore().getUserVolume(owner)
            applyVolumeForUser(owner, v)
          } catch (_) { /* noop */ }
        } else {
          // Fallback: use lastInRoom to map this new producer to a likely user.
          try {
            const { useAuthStore } = await import('~/stores/auth')
            const myId = useAuthStore().getUserData()?.id
            const others = Array.isArray(lastInRoom.value) ? lastInRoom.value.filter(uid => String(uid) !== String(myId) && typeof uid === 'string' && !uid.includes('-')) : []
            const taken = new Set(Array.from(producerOwner.values()).map(String))
            let candidate = null
            // If we already learned the CNAME for this producer elsewhere, prefer an existing owner
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
              console.log(`[SFU] Fallback mapping new producer ${data.producerId} → user ${candidate}`)
              producerOwner.set(data.producerId, candidate)
              try {
                const cname = producerCname.get(data.producerId)
                if (cname) cnameOwner.set(cname, candidate)
              } catch (_) { /* noop */ }
              rebindAudioAndDetectionIfNeeded(data.producerId, candidate)
              try {
                const { useVoiceStore } = await import('~/stores/voice')
                const v = useVoiceStore().getUserVolume(candidate)
                applyVolumeForUser(candidate, v)
              } catch (_) { /* noop */ }
            } else {
              console.log(`[SFU] No user mapping in new-producer for ${data.producerId}`)
            }
          } catch (_) {
            console.log(`[SFU] No user mapping in new-producer for ${data.producerId}`)
          }
        }
      }
      // Ignore our own producer announcements (robust: check both set and map)
      if (localProducerIds.has(data.producerId) || producers.value.has(data.producerId)) {
        console.log('[SFU] Ignoring own producer')
        return
      }
      console.log('[SFU][Debug] Requesting consumer for remote producer:', data.producerId)
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
      console.log('[SFU] Producer closed:', data.producerId)
      const consumer = consumers.value.get(data.producerId)
      if (consumer) {
        consumer.close()
        consumers.value.delete(data.producerId)
        const ownerId = producerOwner.get(data.producerId) || data.producerId
        removeAudioElement(ownerId)
        // Ensure detection cleanup
        cleanupVoiceDetection(ownerId)
      }
      // Drop mapping
      if (data && data.producerId) producerOwner.delete(data.producerId)
      try {
        const cname = producerCname.get(data.producerId)
        if (cname) {
          producerCname.delete(data.producerId)
          // If no other producer uses this cname, drop cnameOwner entry too
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
      // Only set fatal error if connection is lost or voice is disabled
      if (data && (data.type === 'connection' || data.type === 'voice' || data.fatal)) {
        error.value = data.message || 'Server error'
      } else {
        // For transient or recoverable errors, show a warning but do not set fatal error
        error.value = null
        // Optionally, trigger a toast or warning UI here
      }
      // If this is a produce error, reject the pending produce callback
      if (data && data.type === 'produce') {
        const entry = pendingProduceQueue.shift()
        if (entry && typeof entry.errback === 'function') {
          try { entry.errback(new Error(data.message || 'Producer creation failed')) } catch (_) { /* noop */ }
        }
      }
    })

  setupMessageHandler('currentlyInChannel', async (message) => {
      // Support both shapes: { type, data: {...} } and { type, inRoom, producers }
      const data = message && message.data ? message.data : {
        inRoom: message?.inRoom,
        producers: message?.producers,
        producerUserMap: message?.producerUserMap
      }
      if (typeof console !== 'undefined' && typeof console.log === 'function') {
        console.log('[SFU] Currently in channel info:', data)
        console.log('[SFU] Full currentlyInChannel message:', JSON.stringify(message, null, 2))
      }
      // Track users for fallback mapping
      if (Array.isArray(data.inRoom)) {
        console.log('[SFU] Setting lastInRoom.value to:', data.inRoom)
        lastInRoom.value = data.inRoom.slice()
        console.log('[SFU] lastInRoom.value after setting:', lastInRoom.value)
      }
      // Track remote producer count (exclude local producers)
      try {
        const { useAuthStore } = await import('~/stores/auth')
        const myId = useAuthStore().getUserData()?.id
        const localSet = new Set(localProducerIds)
        const list = Array.isArray(data.producers) ? data.producers : []
        // Exclude producers we have marked as unconsumable so they don't block ICE/connect logic
        const newCount = list.filter(pid => !localSet.has(pid) && !failedConsumeProducers.has(pid)).length
        console.log('[SFU] Setting remoteProducersCount.value to:', newCount)
        remoteProducersCount.value = newCount
        console.log('[SFU] remoteProducersCount.value after setting:', remoteProducersCount.value)
      } catch (_) {
        const newCount = Array.isArray(data.producers) ? data.producers.length : 0
        console.log('[SFU] Setting remoteProducersCount.value to (fallback):', newCount)
        remoteProducersCount.value = newCount
        console.log('[SFU] remoteProducersCount.value after setting (fallback):', remoteProducersCount.value)
      }
      
        // CRITICAL: Establish producer → user mapping if provided
        if (data.producerUserMap && typeof data.producerUserMap === 'object' && Object.keys(data.producerUserMap).length > 0) {
          console.log('[SFU] Setting up producer→user mapping:', data.producerUserMap)
          let voiceStoreInstance = null
          try {
            const { useVoiceStore } = await import('~/stores/voice')
            voiceStoreInstance = useVoiceStore()
          } catch (_) { /* noop */ }
          for (const [producerId, userId] of Object.entries(data.producerUserMap)) {
            producerOwner.set(producerId, userId)
            console.log(`[SFU] Mapped producer ${producerId} → user ${userId}`)
            // Ensure audio element exists for this user
            let audioEl = document.getElementById(`audio-${userId}`)
            if (!audioEl) {
              audioEl = document.createElement('audio')
              audioEl.id = `audio-${userId}`
              audioEl.setAttribute('data-user-id', String(userId))
              audioEl.setAttribute('data-producer-id', String(producerId))
              audioEl.autoplay = true
              audioEl.controls = false
              audioEl.style.display = 'none'
              document.body.appendChild(audioEl)
              console.log(`[SFU] Created audio element for user ${userId} and producer ${producerId}`)
            } else {
              audioEl.setAttribute('data-producer-id', String(producerId))
              console.log(`[SFU] Reusing existing audio element for user ${userId} and producer ${producerId}`)
            }
            rebindAudioAndDetectionIfNeeded(producerId, userId)
            // Diagnostics: log all audio elements
            const allAudioEls = Array.from(document.querySelectorAll('audio[data-user-id]')).map(el => ({
              id: el.id,
              userId: el.getAttribute('data-user-id'),
              producerId: el.getAttribute('data-producer-id')
            }))
            console.log('[SFU] Current audio elements:', allAudioEls)
            try {
              const v = voiceStoreInstance ? voiceStoreInstance.getUserVolume(userId) : undefined
              if (typeof v !== 'undefined') applyVolumeForUser(userId, v)
            } catch (_) { /* noop */ }
          }
        } else if (data.producerUserMap && typeof data.producerUserMap === 'object' && Object.keys(data.producerUserMap).length === 0) {
          console.warn('[SFU] WARNING: producerUserMap is empty. Backend must provide explicit mapping for stable audio routing.')
        } else if (data.producers && data.inRoom) {
        // FALLBACK: If no explicit mapping but we have both arrays, try to correlate
        // This is a heuristic - ideally the server should provide explicit mapping
        console.log('[SFU] No explicit producer→user mapping, using fallback correlation')
        console.log('[SFU] Producers:', data.producers)
        console.log('[SFU] Users in room:', data.inRoom)
        // Always assign a userId for every producer, cycling through available users if needed
        const { useAuthStore } = await import('~/stores/auth')
        const authStore = useAuthStore()
        const myUserId = authStore.getUserData()?.id
          // Only consider remote producers; never map our own local producers
          const unmappedProducers = data.producers.filter(pid => !producerOwner.has(pid) && !localProducerIds.has(pid))
          // Only use userIds that do not contain a hyphen (not a producerId)
          const otherUsers = data.inRoom.filter(userId => userId !== myUserId && typeof userId === 'string' && !userId.includes('-'))
          // Helper to remove audio element by ID
          function removeAudioElementById(id) {
            const el = document.getElementById(`audio-${id}`)
            if (el) el.remove()
          }
          // Prepare voice store instance for volume application
          let voiceStoreInstance = null
          try {
            const { useVoiceStore } = await import('~/stores/voice')
            voiceStoreInstance = useVoiceStore()
          } catch (_) { /* noop */ }
          // Build desired unique assignment using CNAME grouping if possible
          const takenUsers = new Set(Array.from(producerOwner.values()).map(String))
          const availableUsers = otherUsers.filter(u => !takenUsers.has(String(u)))
          let nextIdx = 0
          for (const producerId of unmappedProducers) {
            let assign = null
            // Prefer owner via cname
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
              console.log(`[SFU] FALLBACK mapped producer ${producerId} → user ${assign}`)
              try { const cname = producerCname.get(producerId); if (cname) cnameOwner.set(cname, assign) } catch (_) { /* noop */ }
              rebindAudioAndDetectionIfNeeded(producerId, assign)
              removeAudioElementById(producerId)
              const userEl = document.getElementById(`audio-${assign}`)
              if (userEl) {
                userEl.setAttribute('data-user-id', String(assign))
                userEl.setAttribute('data-producer-id', String(producerId))
              }
              try {
                if (voiceStoreInstance) {
                  const v = voiceStoreInstance.getUserVolume(assign)
                  applyVolumeForUser(assign, v)
                }
              } catch (_) { /* noop */ }
            }
          }
          // Rebalance: if after a new user joins we ended up with two producers mapped to the same user while another user has none, fix it
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
        // After all fallback mappings, force reconciliation of audio element IDs and cleanup
        try {
          const container = document.getElementById('webrtc-audio-global')
          if (container) {
            // Remove orphaned audio elements for users not in inRoom
            const validUserIds = new Set(data.inRoom.map(u => typeof u === 'string' ? u : (u && u.id)).filter(Boolean))
            container.querySelectorAll('audio').forEach(el => {
              const userId = el.getAttribute('data-user-id')
              if (!validUserIds.has(userId)) {
                el.remove()
              }
            })
            // Reconcile IDs for mapped producers
            consumers.value.forEach((consumer, producerId) => {
              const mappedUserId = producerOwner.get(producerId)
              if (mappedUserId && producerId !== mappedUserId) {
                const prodEl = document.getElementById(`audio-${producerId}`)
                if (prodEl) {
                  prodEl.id = `audio-${mappedUserId}`
                  prodEl.setAttribute('data-user-id', String(mappedUserId))
                  prodEl.setAttribute('data-producer-id', String(producerId))
                }
              }
            })
            // Ensure only one audio element per userId
            const seenUserIds = new Set()
            container.querySelectorAll('audio').forEach(el => {
              const uid = el.getAttribute('data-user-id')
              if (uid) {
                if (seenUserIds.has(uid)) {
                  el.remove()
                } else {
                  seenUserIds.add(uid)
                  el.id = `audio-${uid}`
                }
              }
            })
          }
        } catch (_) { /* noop */ }
      }
      
      // Handle channel state information
      // This indicates the server is ready to handle requests
      
      // Sync connected users with inRoom and hydrate profiles from rooms store
      (async () => {
        try {
          const { useVoiceStore } = await import('~/stores/voice');
          const { useAuthStore } = await import('~/stores/auth');
          const { useRoomsStore } = await import('~/stores/rooms');
          const voiceStore = useVoiceStore();
          const authStore = useAuthStore();
          const roomsStore = useRoomsStore();
          const myUserId = authStore.getUserData()?.id;
          // Try to find current room and hydrate directory from its members
          const room = roomsStore.getRoomById && voiceStore.currentRoomId ? roomsStore.getRoomById(voiceStore.currentRoomId) : undefined
          if (room && Array.isArray(room.members)) {
            room.members.forEach(m => {
              // Normalize minimal profile shape we use in UI
              voiceStore.upsertUserProfile({
                id: m.id,
                username: m.name || m.email || m.id,
                display_name: m.name || m.email || m.id,
                avatar: m.avatar
              })
            })
            // Also include owner
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
            // Always hydrate and add all users in inRoom
            const incomingIds = data.inRoom.map(u => typeof u === 'string' ? u : (u && u.id)).filter(Boolean)
            incomingIds.forEach(userId => {
              if (!voiceStore.isUserConnected(userId)) {
                voiceStore.addConnectedUser(userId, { id: userId });
              }
            })
            // Remove users not in inRoom
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
      // If there are existing producers, request consumers for them
  if (data && data.producers && Array.isArray(data.producers)) {
        console.log('[SFU] Requesting consumers for existing producers:', data.producers)
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
  // Update ICE-connected snapshot using send-only rule if alone/no remote producers
  try { updateIceConnectedFlag(await (async()=>{try{const m=await import('~/stores/settings');return m.useSettingsStore().broadcastMode||remoteProducersCount.value===0;}catch(_){return remoteProducersCount.value===0}})()) } catch (_) { /* noop */ }
    })

    setupMessageHandler('connected', ({ data }) => {
      console.log('[SFU] Connection confirmed by server:', data)
      // Handle connection confirmation
      // Server is now fully ready for mediasoup operations
  // Removed sending 'get-producers' message since SFU server does not support it
    })
    // Handle keepalive pong responses from server
    setupMessageHandler('pong', ({ data }) => {
      try {
        // Update last pong timestamp for diagnostics and optionally use for connection health
        lastPong.value = Date.now()
      } catch (_) { /* noop */ }
    })
    
  setupMessageHandler('producers-list', ({ data }) => {
      console.log('[SFU] Received producers list:', data)
      if (data && Array.isArray(data)) {
        data.forEach(producerId => {
          console.log('[SFU] Requesting consumer for producer:', producerId)
          // Skip our own producers if present
      if (!localProducerIds.has(producerId) && !producers.value.has(producerId)) {
            requestConsumer(producerId)
          }
        })
      }
    })
    // New server broadcast: authoritative list of currently available producers
    setupMessageHandler('available-producers', ({ data }) => {
      // data may be either an array or { producers: [] }
      const list = Array.isArray(data) ? data : (Array.isArray(data?.producers) ? data.producers : [])
      console.log('[SFU] Received available-producers:', list)
      // Update remoteProducersCount excluding producers we know are unconsumable or local
      try {
        const localSet = new Set(localProducerIds)
        const filtered = list.filter(pid => !localSet.has(pid) && !failedConsumeProducers.has(pid))
        remoteProducersCount.value = filtered.length
        console.log('[SFU] remoteProducersCount updated from available-producers:', remoteProducersCount.value)
      } catch (_) { /* noop */ }

      // Request consumers for each valid producerId in the broadcast
      list.forEach(pid => {
        if (!pid) return
        if (localProducerIds.has(pid) || producers.value.has(pid)) return
        if (failedConsumeProducers.has(pid)) return
        // Defer if device/recvTransport not ready; requestConsumer handles that
        requestConsumer(pid)
      })
    })
  }

  function handleMessage(event) {
    try {
      const message = JSON.parse(event.data)
      if (typeof console !== 'undefined' && typeof console.log === 'function') {
        console.log('[SFU] Received message:', message.type)
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
      // On type error, consider call failed and disconnect socket
      error.value = 'Call failed: invalid message from server'
      disconnect()
    }
  }

  async function initializeDevice() {
    try {
      console.log('[SFU] Requesting RTP capabilities')
      
      // Only request capabilities if WebSocket is ready and open
      if (!ws.value || ws.value.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket not ready for RTP capabilities request')
      }
      
      // Set a timeout for RTP capabilities response
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

  // Helper function to create a clean, cloneable device
  async function createCleanDevice(rtpCapabilities) {
    // Dynamically import mediasoup-client in client context to avoid init order/SSR issues
    const { Device } = await import('mediasoup-client');
    // Create a new device instance
    const newDevice = new Device();

    // Deep clone and sanitize RTP capabilities
    let cleanCapabilities;
    try {
      cleanCapabilities = JSON.parse(JSON.stringify(rtpCapabilities));
    } catch (e) {
      console.error('[SFU] Failed to deep clone RTP capabilities:', e, rtpCapabilities);
      throw new Error('Malformed RTP capabilities from server');
    }

    // Remove any unexpected properties that could cause mediasoup-client to fail
    if (cleanCapabilities && typeof cleanCapabilities === 'object') {
      for (const key in cleanCapabilities) {
        if (typeof cleanCapabilities[key] === 'function' || typeof cleanCapabilities[key] === 'undefined') {
          delete cleanCapabilities[key];
        }
      }
    }

    // Validate required fields
    if (!cleanCapabilities.codecs || !Array.isArray(cleanCapabilities.codecs)) {
      throw new Error('RTP capabilities missing codecs array');
    }
    if (!cleanCapabilities.headerExtensions || !Array.isArray(cleanCapabilities.headerExtensions)) {
      throw new Error('RTP capabilities missing headerExtensions array');
    }

    // Log sanitized capabilities for debugging
    console.log('[SFU] Sanitized RTP capabilities:', cleanCapabilities);

    // Load the device with clean capabilities
    await newDevice.load({
      routerRtpCapabilities: cleanCapabilities
    });

    return newDevice;
  }

  function createTransports() {
    console.log('[SFU] Creating transports')
    transportReady.value = false
    
    // Create a promise to track when both transports are ready
    transportPromise = new Promise((resolve) => {
      transportPromiseResolve = resolve
    })
    
    sendMessage({ type: 'create-transport', data: { type: 'send' } })
    sendMessage({ type: 'create-transport', data: { type: 'recv' } })
  }

  function setupSendTransportEvents() {
    sendTransport.value.on('connect', ({ dtlsParameters }, callback, errback) => {
      console.log('[SFU] Send transport connecting')
      // Ensure dtlsParameters are cloneable
      const cleanDtlsParameters = JSON.parse(JSON.stringify(dtlsParameters))
      sendMessage({
        type: 'connect-transport',
        data: {
          transportId: sendTransport.value.id,
          dtlsParameters: cleanDtlsParameters
        }
      })
      // Store callback to be resolved when we receive transport-connected for this transportId
      pendingTransportConnect.set(sendTransport.value.id, callback)
    })

    sendTransport.value.on('produce', ({ kind, rtpParameters }, callback, errback) => {
      console.log('[SFU] Producing:', kind)
      try {
        // Ensure rtpParameters are cloneable
        const cleanRtpParameters = JSON.parse(JSON.stringify(rtpParameters))
        sendMessage({
          type: 'produce',
          data: {
            transportId: sendTransport.value.id,
            kind,
            rtpParameters: cleanRtpParameters
          }
        })
        // Queue callbacks to be resolved when we receive producer-id or error
        const timeoutId = setTimeout(() => {
          // On timeout, reject and drop this entry if still pending
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

    // Robust ICE/DTLS recovery: listen for transport failures
    sendTransport.value.on('connectionstatechange', () => {
      const state = sendTransport.value.connectionState
      console.log('[SFU] Send transport connection state changed:', state)
      // Update ICE-connected snapshot whenever connection state changes
      try { updateIceConnectedFlag() } catch (_) { /* noop */ }
      if (state === 'failed') {
        // Drop the call immediately on hard failure; do not attempt recovery
        error.value = 'Connection lost'
        disconnect()
        return
      }
      if (state === 'disconnected') {
        // Preserve previous behavior for transient disconnects: attempt recovery
        if (!manualDisconnect && allowReconnect && !isShuttingDown) {
          const channelId = authStore?.currentChannelId || null
          disconnect()
          if (channelId) handleDisconnection(channelId)
        }
      }
    })
    // If mediasoup exposes iceconnectionstatechange, add similar logic here
  }

  function setupRecvTransportEvents() {
    recvTransport.value.on('connect', ({ dtlsParameters }, callback, errback) => {
      console.log('[SFU] Recv transport connecting')
      // Ensure dtlsParameters are cloneable to avoid any structuredClone issues downstream
      const cleanDtlsParameters = JSON.parse(JSON.stringify(dtlsParameters))
      sendMessage({
        type: 'connect-transport',
        data: {
          transportId: recvTransport.value.id,
          dtlsParameters: cleanDtlsParameters
        }
      })
      // Store callback to be resolved when we receive transport-connected for this transportId
      pendingTransportConnect.set(recvTransport.value.id, callback)
    })

    // Robust ICE/DTLS recovery: listen for transport failures
    recvTransport.value.on('connectionstatechange', () => {
      const state = recvTransport.value.connectionState
      console.log('[SFU] Recv transport connection state changed:', state)
      // Update ICE-connected snapshot whenever connection state changes
      try { updateIceConnectedFlag() } catch (_) { /* noop */ }
      if (state === 'failed') {
        // Drop the call immediately on hard failure; do not attempt recovery
        error.value = 'Connection lost'
        disconnect()
        return
      }
      if (state === 'disconnected') {
        // Attempt recovery only for transient disconnections
        if (!manualDisconnect && allowReconnect && !isShuttingDown) {
          const channelId = authStore?.currentChannelId || null
          disconnect()
          if (channelId) handleDisconnection(channelId)
        }
      }
    })
  }

  // Consider ICE connected: in broadcast mode, only send transport; otherwise, both.
  async function getCandidatePairStats(pc) {
    if (!pc) return null;
    try {
      const stats = await pc.getStats();
      let selectedPair = null;
      stats.forEach(s => {
        if (s.type === 'candidate-pair' && s.selected) selectedPair = s;
      });
      if (!selectedPair) {
        stats.forEach(s => {
          if (s.type === 'candidate-pair' && s.state === 'succeeded') selectedPair = s;
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
      // If no recv transport yet (e.g., alone in room), treat as send-only
      if (!pcRecv || broadcastMode) {
        // If truly alone (no remote producers, no remote users except self), force ICE connected
        if (remoteProducersCount.value === 0 && lastInRoom.value.length === 1) {
          return true;
        }
        if (!pcSend || !ok(pcSend.iceConnectionState)) return false;
        const pair = await getCandidatePairStats(pcSend);
        // In send-only/alone scenario, accept succeeded candidate even if no bytes yet (e.g., mic muted)
        return !!(pair && pair.state === 'succeeded');
      } else {
        if (!pcSend || !pcRecv || !ok(pcSend.iceConnectionState) || !ok(pcRecv.iceConnectionState)) return false;
        const pairSend = await getCandidatePairStats(pcSend);
        const pairRecv = await getCandidatePairStats(pcRecv);
        // Only require bytes for send transport; recv may be idle if no remote audio
        return pairSend && pairRecv && pairSend.state === 'succeeded' && pairRecv.state === 'succeeded' &&
          ((pairSend.bytesSent ?? 0) > 0 || (pairSend.bytesReceived ?? 0) > 0);
      }
    } catch (_) {
      return false;
    }
  }

  function updateIceConnectedFlag(broadcastMode = false) {
    iceConnectedBoth.value = areTransportsIceConnected(broadcastMode)
  }

  async function waitForIceConnected(timeoutMs = 12000, broadcastMode = false) {
    // If truly alone (no remote producers, only self in room), resolve immediately
    if (remoteProducersCount.value === 0 && lastInRoom.value.length === 1) {
      iceConnectedBoth.value = true;
      return true;
    }
    const start = Date.now()
    // Quick optimistic check
    if (areTransportsIceConnected(broadcastMode)) { iceConnectedBoth.value = true; return true }
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        const done = areTransportsIceConnected(broadcastMode)
        if (done || (Date.now() - start) > timeoutMs) {
          clearInterval(interval)
          iceConnectedBoth.value = done
          resolve(done)
        }
      }, 150)
    })
  }

  async function startAudioProduction(retryCount = 0) {
  console.log('[SFU] startAudioProduction called', { retryCount })
    // Prevent concurrent calls
    if (isProducingAudio.value) {
      console.log('[SFU] Audio production already in progress, skipping')
      return
    }
    // Bail out if we are shutting down or manually disconnected
    if (isShuttingDown || manualDisconnect) {
      return
    }
    
    isProducingAudio.value = true
    
    try {
      // Check if we're already producing audio
      if (isProducing.value && producers.value.size > 0) {
        console.log('[SFU] Already producing audio, stopping existing production first')
        stopAudioProduction()
        // Give a small delay to ensure cleanup is complete
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      
      // Wait for transports to be ready if they're not yet
      if (!transportReady.value && transportPromise) {
        console.log('[SFU] Waiting for transports to be ready...')
        await transportPromise
      }
      
  if (!sendTransport.value || sendTransport.value.closed) {
        throw new Error('Send transport not available')
      }

      // Debug: Check if transport has any problematic properties
      console.log('[SFU] Send transport state:', {
        id: sendTransport.value.id,
        closed: sendTransport.value.closed,
        direction: sendTransport.value.direction,
        connectionState: sendTransport.value.connectionState
      })

  console.log('[SFU] Starting audio production...', retryCount > 0 ? `(retry ${retryCount})` : '')

      // Get media stream and track with immediate validation
      let stream, audioTrack
      try {
        // Pull current audio settings
        let constraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        let selectedDeviceId = null
        try {
          const { useSettingsStore } = await import('~/stores/settings')
          const settings = useSettingsStore()
          constraints = { ...constraints, ...settings.audio }
          selectedDeviceId = settings.micDeviceId
        } catch (_) { /* fallback to defaults */ }

        // Only keep supported keys
        const supportedKeys = ['echoCancellation', 'noiseSuppression', 'autoGainControl']
        const sanitizedConstraints = {}
        for (const key of supportedKeys) {
          if (typeof constraints[key] !== 'undefined') {
            sanitizedConstraints[key] = constraints[key]
          }
        }
        // Log constraints for debugging
        console.log('[SFU] getUserMedia constraints:', sanitizedConstraints, 'selectedDeviceId:', selectedDeviceId)

        try {
          const audioConstraints = selectedDeviceId ? { ...sanitizedConstraints, deviceId: { exact: selectedDeviceId } } : sanitizedConstraints
          stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })
        } catch (e) {
          // Fallback without deviceId if exact match fails
          stream = await navigator.mediaDevices.getUserMedia({ audio: sanitizedConstraints })
        }

        audioTrack = stream.getAudioTracks()[0]
        // Mark as pending to ensure we clean up if we abort or fail
        pendingStream = stream
        pendingTrack = audioTrack

        if (!audioTrack) {
          stream.getTracks().forEach(track => track.stop())
          throw new Error('No audio track available from getUserMedia')
        }

        // Immediate validation after getting track
        if (audioTrack.readyState !== 'live') {
          stream.getTracks().forEach(track => track.stop())
          throw new Error(`Audio track is not live immediately after getUserMedia: ${audioTrack.readyState}`)
        }

        console.log('[SFU] Successfully got live audio track:', {
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
      // If shutdown started after acquiring the mic, stop it and exit quietly
      if (isShuttingDown || manualDisconnect) {
        try {
          if (pendingStream) pendingStream.getTracks().forEach(t => t.stop())
        } catch (_) { /* noop */ }
        pendingStream = null
        pendingTrack = null
        return
      }
      
      // Set up track ended handler before proceeding
      const trackEndedHandler = () => {
        console.warn('[SFU] Track ended unexpectedly during production setup')
      }

      // --- Local Voice Activity Detection ---
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
        const threshold = 18; // Adjust for sensitivity
        const silenceFrames = 6;
        let silentCount = 0;
        const { useAuthStore } = await import('~/stores/auth');
        const { updateUserSpeaking } = await import('~/stores/voice');
        const myId = useAuthStore().getUserData()?.id;
        vadInterval = setInterval(() => {
          localAnalyser.getByteTimeDomainData(dataArray);
          // Simple energy-based VAD
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            const val = dataArray[i] - 128;
            sum += val * val;
          }
          const rms = Math.sqrt(sum / dataArray.length);
          if (rms > threshold) {
            if (!speaking) {
              speaking = true;
              updateUserSpeaking(myId, true);
            }
            silentCount = 0;
          } else {
            silentCount++;
            if (speaking && silentCount > silenceFrames) {
              speaking = false;
              updateUserSpeaking(myId, false);
            }
          }
        }, 60);
        // Clean up VAD when mic stops
        audioTrack.addEventListener('ended', () => {
          clearInterval(vadInterval);
          updateUserSpeaking(myId, false);
          try { localAudioContext.close(); } catch (_) {}
        });
      } catch (vadErr) {
        console.warn('[SFU] Local VAD setup failed:', vadErr);
      }
      audioTrack.addEventListener('ended', trackEndedHandler, { once: true })
      
      // Small delay to allow browser to stabilize the track
      await new Promise(resolve => setTimeout(resolve, 50))
      
  // Final validation right before produce call
      if (audioTrack.readyState !== 'live') {
        stream.getTracks().forEach(track => track.stop())
        throw new Error(`Track state changed to ${audioTrack.readyState} before produce call`)
      }
      
      console.log('[SFU] Creating producer with track in state:', audioTrack.readyState)

      // Preserve multi-channel (stereo) audio: if the capture reports >1 channels,
      // request Opus stereo in codecOptions so the SFU/router can negotiate stereo properly.
      let maybeStereo = false
      try {
        let settings = {}
        try { settings = audioTrack.getSettings ? audioTrack.getSettings() : {} } catch (_) { settings = {} }
        const channelCount = settings.channelCount || (audioTrack && audioTrack.channelCount) || null
        if (channelCount && Number(channelCount) > 1) {
          maybeStereo = true
          console.log('[SFU] Detected multi-channel audio track (channelCount=' + channelCount + '), requesting opus stereo in producer options')
        }
      } catch (e) { /* noop */ }
      
  // Always use a native, cloned MediaStreamTrack to avoid DataCloneError
  let producer
      try {
        // Check if device can produce audio
        if (!device.value.canProduce('audio')) {
          throw new Error('Device cannot produce audio')
        }

        // Strict native MediaStreamTrack check
        const isNativeTrack = (
          audioTrack instanceof MediaStreamTrack &&
          Object.getPrototypeOf(audioTrack) === MediaStreamTrack.prototype &&
          audioTrack.constructor === MediaStreamTrack
        );
        console.log('[SFU] audioTrack instanceof MediaStreamTrack:', audioTrack instanceof MediaStreamTrack);
        console.log('[SFU] audioTrack prototype:', Object.getPrototypeOf(audioTrack));
        console.log('[SFU] audioTrack constructor:', audioTrack.constructor);
        if (!isNativeTrack) {
          throw new Error('audioTrack is not a native MediaStreamTrack. Prototype or constructor mismatch.');
        }

        // Clone the track to ensure no Proxy or wrapper is present
        const cleanTrack = audioTrack.clone();
        // Log cleanTrack details
        console.log('[SFU] cleanTrack instanceof MediaStreamTrack:', cleanTrack instanceof MediaStreamTrack);
        console.log('[SFU] cleanTrack prototype:', Object.getPrototypeOf(cleanTrack));
        console.log('[SFU] cleanTrack constructor:', cleanTrack.constructor);

        // Only pass the track, do not pass codec or other options
        // Workaround: mediasoup-client may internally use structuredClone on parameters
        // which can throw DataCloneError in some environments. Temporarily disable it
        // around the produce() call to force library fallback cloning.
        const savedStructuredClone = typeof window !== 'undefined' ? window.structuredClone : undefined
        if (typeof window !== 'undefined') {
          try { window.structuredClone = undefined } catch (_) { /* noop */ }
        }
        try {
          // Respect channel-configured audio bitrate if available
          let bitrateBps = null
          try {
            const { useVoiceStore } = await import('~/stores/voice')
            const { useChannelsStore } = await import('~/stores/channels')
            const v = useVoiceStore()
            const chStore = useChannelsStore()
            const channel = v.currentChannelId ? chStore.getChannelById(v.currentChannelId) : null
            const kbps = channel && typeof channel.audio_bitrate !== 'undefined' ? Number(channel.audio_bitrate) : null
            if (kbps && !Number.isNaN(kbps) && kbps > 0) bitrateBps = Math.floor(kbps * 1000)
          } catch (_) { /* optional */ }
          const produceOpts = { track: cleanTrack }
          if (bitrateBps) {
            // Use RTCRtpSender encodings to cap average bitrate
            produceOpts.encodings = [{ maxBitrate: bitrateBps }]
          }
          // Always set opusDtx when bitrate cap is used; if stereo was detected, request opus stereo
          produceOpts.codecOptions = { opusDtx: true }
          if (maybeStereo) {
            // Request stereo support; mediasoup may accept or ignore this field but it helps
            // signal intent to produce stereo audio.
            try { produceOpts.codecOptions.opusStereo = true } catch (_) { /* noop */ }
            try { produceOpts.codecOptions.stereo = true } catch (_) { /* noop */ }
          }
          producer = await sendTransport.value.produce(produceOpts)
        } finally {
          if (typeof window !== 'undefined') {
            try { window.structuredClone = savedStructuredClone } catch (_) { /* noop */ }
          }
        }
    // Clean up the original track
        audioTrack.stop();
        audioTrack = cleanTrack;
    // We're switching to producer-managed track, pending mic refs no longer needed
    pendingStream = null
    pendingTrack = null
      } catch (cloneError) {
        if (cloneError.name === 'DataCloneError') {
          console.log('[SFU] DataCloneError encountered, trying last resort approach')
          try {
            // Get a completely fresh stream with minimal constraints
            let minimalProbe = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }
            let selectedDeviceId = null
            try {
              const { useSettingsStore } = await import('~/stores/settings')
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
              // Log minimalTrack details
              console.log('[SFU] minimalTrack instanceof MediaStreamTrack:', minimalTrack instanceof MediaStreamTrack);
              console.log('[SFU] minimalTrack prototype:', Object.getPrototypeOf(minimalTrack));
              console.log('[SFU] minimalTrack constructor:', minimalTrack.constructor);
              // Apply the same structuredClone workaround for this path
              const savedStructuredClone2 = typeof window !== 'undefined' ? window.structuredClone : undefined
              if (typeof window !== 'undefined') {
                try { window.structuredClone = undefined } catch (_) { /* noop */ }
              }
              try {
                // Respect channel-configured audio bitrate if available
                let bitrateBps2 = null
                try {
                  const { useVoiceStore } = await import('~/stores/voice')
                  const { useChannelsStore } = await import('~/stores/channels')
                  const v2 = useVoiceStore()
                  const chStore2 = useChannelsStore()
                  const channel2 = v2.currentChannelId ? chStore2.getChannelById(v2.currentChannelId) : null
                  const kbps2 = channel2 && typeof channel2.audio_bitrate !== 'undefined' ? Number(channel2.audio_bitrate) : null
                  if (kbps2 && !Number.isNaN(kbps2) && kbps2 > 0) bitrateBps2 = Math.floor(kbps2 * 1000)
                } catch (_) { /* optional */ }
                const produceOpts2 = { track: minimalTrack }
                if (bitrateBps2) {
                  produceOpts2.encodings = [{ maxBitrate: bitrateBps2 }]
                  produceOpts2.codecOptions = { opusDtx: true }
                }
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
              console.log('[SFU] Successfully created producer with minimal track')
            } else {
              throw new Error('Minimal track creation failed')
            }
          } catch (lastResortError) {
            console.error('[SFU] Last resort approach also failed:', lastResortError)
            throw cloneError // Throw original error
          }
        } else {
          throw cloneError
        }
      }
      
      // Remove the temporary ended handler since production succeeded
      audioTrack.removeEventListener('ended', trackEndedHandler)
      
  console.log('[SFU] Producer created successfully:', producer.id)
      
  // Store producer and stream references
      producers.value.set(producer.id, {
        producer,
        stream,
        track: audioTrack
      })
  // Track locally created producer ids to avoid self-consume
  localProducerIds.add(producer.id)
      
      isProducing.value = true

      producer.on('transportclose', () => {
        console.log('[SFU] Producer transport closed')
        const producerData = producers.value.get(producer.id)
        if (producerData) {
          // Clean up the stream we're managing
          producerData.stream.getTracks().forEach(track => track.stop())
          producers.value.delete(producer.id)
        }
        isProducing.value = producers.value.size > 0
  // No consumer voice detection for local producer, but keep function symmetry
      })

      producer.on('trackended', () => {
        console.log('[SFU] Producer track ended')
        stopAudioProduction(producer.id)
  // No consumer detection associated; nothing else to clean here
      })

      console.log('[SFU] Audio producer setup complete:', producer.id)
      return producer
      
    } catch (err) {
      if (isShuttingDown || manualDisconnect) {
        // Stop any pending mic resources quietly
        try {
          if (pendingStream) pendingStream.getTracks().forEach(t => t.stop())
        } catch (_) { /* noop */ }
        pendingStream = null
        pendingTrack = null
        // Swallow shutdown noise
        return
      }
      console.error('[SFU] Error starting audio production:', err)
      // If closing, swallow AwaitQueueStoppedError and do not retry or set user-facing error
      if (isShuttingDown || manualDisconnect) {
        if (err && (err.name === 'AwaitQueueStoppedError' || /queue stopped/i.test(err.message || ''))) {
          return
        }
      }
      
      // Retry logic for track ended errors and DataCloneError
      if ((err.name === 'InvalidStateError' && err.message.includes('track ended')) && retryCount < 2) {
        console.log(`[SFU] Retrying audio production due to track ended error (attempt ${retryCount + 1}/3)`)
        isProducingAudio.value = false
        await new Promise(resolve => setTimeout(resolve, 200 * (retryCount + 1)))
        return startAudioProduction(retryCount + 1)
      } else if (err.name === 'DataCloneError' && retryCount < 1) {
        console.log(`[SFU] Retrying audio production due to DataCloneError (attempt ${retryCount + 1}/2)`)
        isProducingAudio.value = false
        await new Promise(resolve => setTimeout(resolve, 500))
        return startAudioProduction(retryCount + 1)
      }
      
      // Provide more specific error messages based on the error type
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
      // Ensure pending mic is stopped if we didn't hand it to a producer
      if (pendingStream) {
        try { pendingStream.getTracks().forEach(t => t.stop()) } catch (_) { /* noop */ }
        pendingStream = null
        pendingTrack = null
      }
    }
  }

  function stopAudioProduction(producerId = null) {
    if (producerId) {
      const producerData = producers.value.get(producerId)
      if (producerData) {
        // Close the producer
        if (producerData.producer) {
          producerData.producer.close()
        }
        // Stop the stream we're managing
        if (producerData.stream) {
          producerData.stream.getTracks().forEach(track => track.stop())
        }
        producers.value.delete(producerId)
      }
    } else {
      // Stop all producers
      producers.value.forEach((producerData, id) => {
        if (producerData.producer) {
          producerData.producer.close()
        }
        if (producerData.stream) {
          producerData.stream.getTracks().forEach(track => track.stop())
        }
      })
      producers.value.clear()
    }
        // If this producer has previously failed to consume, skip
        if (failedConsumeProducers.has(producerId)) {
          console.log('[SFU] Skipping consume request for failed producer:', producerId)
          return
        }
    isProducing.value = producers.value.size > 0
  }

  async function requestConsumer(producerId) {
    // Broadcast Mode: skip receiving audio
  // Always request consumer, even in broadcast mode, to keep mapping and signaling consistent

    if (!device.value || !device.value.rtpCapabilities) {
      console.error('[SFU] Device not ready for consuming')
      return
    }

    // Do not consume our own producer
    if (localProducerIds.has(producerId) || producers.value.has(producerId)) {
      return
    }

    // If we already have a consumer for this producer, skip
    if (consumers.value.has(producerId)) {
      return
    }

    // Ensure recv transport exists before sending consume to avoid race "Transport not found"
    if (!recvTransport.value) {
      let attempts = 0
      await new Promise((resolve) => {
        const check = () => {
          if (recvTransport.value && recvTransport.value.connectionState !== 'closed') return resolve()
          if (++attempts > 50) return resolve() // ~5s max
          setTimeout(check, 100)
        }
        check()
      })
      if (!recvTransport.value) {
        console.error('[SFU] recvTransport still not ready; deferring consume for', producerId)
  // Defer and retry later but do not mark as permanently failed yet.
  // Give a slightly longer delay to allow recv transport to be created.
  setTimeout(() => { if (!consumers.value.has(producerId)) requestConsumer(producerId) }, 750)
        return
      }
    }

  // Request a consumer for the specific producerId using a sanitized rtpCapabilities
    let safeCaps = null
    try {
      // Prefer mediasoup Device internal recvRtpCapabilities if available
      const preferred = device.value && device.value._recvRtpCapabilities ? device.value._recvRtpCapabilities : device.value.rtpCapabilities
      safeCaps = JSON.parse(JSON.stringify(preferred))
    } catch (_) { safeCaps = device.value.rtpCapabilities }
    // Inform server of our RTP capabilities (new required step) before requesting consume
    try {
  console.log('[SFU] Sending client-rtp-capabilities for consume:', safeCaps)
  try { lastSentClientRtpCapabilities.value = safeCaps } catch (_) { /* noop */ }
  sendMessage({ type: 'client-rtp-capabilities', data: { rtpCapabilities: safeCaps } })
    } catch (e) { console.warn('[SFU] Failed to send client-rtp-capabilities:', e) }
    sendMessage({
      type: 'consume',
      data: {
        producerId,
        rtpCapabilities: safeCaps,
        transportId: recvTransport.value.id
      }
    })

    // Set a fallback timer to try a generic consume if server doesn't accept producer-specific
    if (pendingConsume.has(producerId)) {
      clearTimeout(pendingConsume.get(producerId))
    }
  const timeoutId = setTimeout(() => {
      // If still no consumer created for this producer, try generic consume once
      if (!consumers.value.has(producerId)) {
        console.log('[SFU] Specific consume timed out, attempting generic consume')
        try {
          let safeCaps2 = null
          try { safeCaps2 = JSON.parse(JSON.stringify(device.value.rtpCapabilities)) } catch (_) { safeCaps2 = device.value.rtpCapabilities }
          sendMessage({
            type: 'consume',
            data: {
              rtpCapabilities: safeCaps2,
              transportId: recvTransport.value.id
            }
          })
        } catch (_) { /* noop */ }
      }
      // After attempting generic, if still no consumer, mark producer as failed
      try {
        if (!consumers.value.has(producerId)) {
          failedConsumeProducers.add(producerId)
          console.log('[SFU] Marking producer as failed to consume:', producerId)
        }
      } catch (_) { /* noop */ }
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

      // Clear any pending fallback for this producer
      if (pendingConsume.has(consumerData.producerId)) {
        clearTimeout(pendingConsume.get(consumerData.producerId))
        pendingConsume.delete(consumerData.producerId)
      }

      // Ensure producer→user mapping before creating audio element
      try {
        if (!producerOwner.has(consumerData.producerId)) {
          const { useAuthStore } = await import('~/stores/auth')
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
            console.log(`[SFU] Safety mapping in createConsumer: producer ${consumerData.producerId} → user ${candidate}`)
            producerOwner.set(consumerData.producerId, candidate)
            rebindAudioAndDetectionIfNeeded(consumerData.producerId, candidate)
            try {
              const { useVoiceStore } = await import('~/stores/voice')
              const v = useVoiceStore().getUserVolume(candidate)
              applyVolumeForUser(candidate, v)
            } catch (_) { /* noop */ }
          }
        }
      } catch (_) { /* noop */ }

      // Create audio element for the remote stream
      if (consumer.track && consumer.kind === 'audio') {
        console.log('[SFU][Debug] Consumer audio track state:', {
          enabled: consumer.track.enabled,
          readyState: consumer.track.readyState,
          muted: consumer.track.muted
        })
        const ownerId = producerOwner.get(consumerData.producerId) || consumerData.producerId
        // Remove all existing audio elements for this user before creating a new one
        try {
          const container = document.getElementById('webrtc-audio-global')
          if (container) {
            container.querySelectorAll('audio').forEach(el => {
              if (el.getAttribute('data-user-id') === String(ownerId)) {
                el.remove()
                console.log('[SFU] Removed audio element:', el.id)
              }
            })
          }
        } catch (_) { /* noop */ }
        createAudioElement(ownerId, consumer.track)
        // Voice detection with shared AudioContext
  setupVoiceDetection(ownerId, consumer.track)
        // After creating, reconcile to ensure only one audio element per user
        try {
          const container = document.getElementById('webrtc-audio-global')
          if (container) {
            const seenUserIds = new Set()
            container.querySelectorAll('audio').forEach(el => {
              const uid = el.getAttribute('data-user-id')
              if (uid) {
                if (seenUserIds.has(uid)) {
                  el.remove()
                } else {
                  seenUserIds.add(uid)
                    // If this producer was previously marked as failed, clear it (success)
                    if (failedConsumeProducers.has(consumerData.producerId)) {
                      failedConsumeProducers.delete(consumerData.producerId)
                    }
                  el.id = `audio-${uid}`
                }
              }
            })
          }
        } catch (_) { /* noop */ }
      }

                    // Success path: do NOT mark producer as failed here. If consumer creation
                    // fails we will handle it in the catch handler instead.
      consumer.on('transportclose', () => {
        console.log('[SFU] Consumer transport closed')
        const ownerId = producerOwner.get(consumerData.producerId) || consumerData.producerId
        removeAudioElement(ownerId)
        consumers.value.delete(consumerData.producerId)
        cleanupVoiceDetection(ownerId)
      })

      consumer.on('trackended', () => {
        console.log('[SFU] Consumer track ended')
        const ownerId = producerOwner.get(consumerData.producerId) || consumerData.producerId
        removeAudioElement(ownerId)
        consumers.value.delete(consumerData.producerId)
        cleanupVoiceDetection(ownerId)
      })

  // Removed sending 'consumer-resume' message since SFU server does not support it

      console.log('[SFU] Consumer created:', consumer.id)
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
      // Hidden but present container to persist across navigations
      container.style.position = 'fixed'
      container.style.left = '-9999px'
      container.style.top = '0'
      container.style.width = '1px'
      container.style.height = '1px'
      document.body.appendChild(container)
      console.log('[SFU] Created global audio container')
    }
    return container
  }

  function createAudioElement(ownerId, track) {
    const container = getOrCreateGlobalAudioContainer()

    // ownerId might be a producer ID - find the real user ID
    let realUserId = producerOwner.get(ownerId) || ownerId
    console.log(`[SFU] Creating audio element for producer ${ownerId} → user ${realUserId}`)

    // Remove existing audio element if any (by both producer ID and user ID)
    removeAudioElement(ownerId)
    removeAudioElement(realUserId)

    const audio = document.createElement('audio')
    audio.id = `audio-${realUserId}`
    audio.setAttribute('data-user-id', String(realUserId))
    audio.setAttribute('data-producer-id', String(ownerId))
    audio.autoplay = true
    audio.controls = false
    audio.playsInline = true
    audio.srcObject = new MediaStream([track])

    // Set audio volume from voiceStore and guarantee correct value after creation, without overwriting user settings
    function setInitialVolume(userId) {
      import('~/stores/voice').then(({ useVoiceStore }) => {
        const voiceStore = useVoiceStore()
        // Use saved volume if present; default to current element volume if any, else 1
        const saved = voiceStore.userVolumes && typeof voiceStore.userVolumes[userId] !== 'undefined'
          ? Number(voiceStore.userVolumes[userId])
          : undefined
        const volume = typeof saved === 'number' && !Number.isNaN(saved) ? saved : (typeof audio.volume === 'number' ? audio.volume : 1)
        console.log(`[SFU] Setting initial volume for audio-${userId}: ${volume}`)
        audio.volume = volume
        if (typeof window !== 'undefined' && window.sfuComposable && typeof window.sfuComposable.applyVolumeForUser === 'function') {
          window.sfuComposable.applyVolumeForUser(userId, volume)
        } else if (typeof applyVolumeForUser === 'function') {
          applyVolumeForUser(userId, volume)
        }
      })
    }
    setInitialVolume(realUserId)

    // If mapping is not available, set up a watcher to update audio element and volume when mapping appears
    if (!producerOwner.get(ownerId)) {
      let mappingInterval = setInterval(() => {
        const mapped = producerOwner.get(ownerId)
        if (mapped && mapped !== ownerId) {
          // Update audio element id and attributes
          audio.id = `audio-${mapped}`
          audio.setAttribute('data-user-id', String(mapped))
          audio.setAttribute('data-producer-id', String(ownerId))
          setInitialVolume(mapped)
          clearInterval(mappingInterval)
        }
      }, 200)
      // Optionally, clear after a timeout to avoid leaks
      setTimeout(() => clearInterval(mappingInterval), 10000)
    }

    // Apply output device setting immediately and mute if broadcastMode
    try {
      import('~/stores/settings').then(({ useSettingsStore }) => {
        const settings = useSettingsStore()
        const sinkId = settings.outputDeviceId
        if (sinkId && typeof audio.setSinkId === 'function') {
          audio.setSinkId(sinkId).catch((err) => {
            console.warn('[SFU] Failed to set output device on audio element:', err)
          })
        }
        if (settings.broadcastMode) {
          audio.muted = true
          console.log(`[SFU] Broadcast mode: audio element for user ${realUserId} is muted`)
        }
      })
    } catch (_) { /* noop */ }

    // Apply deafened state if user is deafened
    try {
      import('~/stores/voice').then(({ useVoiceStore }) => {
        const voiceStore = useVoiceStore()
        if (voiceStore.deafened) {
          audio.muted = true
        }
      })
    } catch (_) { /* noop */ }

    container.appendChild(audio)
    console.log('[SFU] Created audio element for user:', realUserId, 'with sinkId applied')
  }

  // Ensure audio elements exist for all live consumers; recreate if missing
  function ensureAudioElements() {
    try {
      const container = getOrCreateGlobalAudioContainer()
      consumers.value.forEach((consumer, producerId) => {
        if (!consumer || consumer.kind !== 'audio') return
        const ownerId = producerOwner.get(producerId) || producerId
        // Try either userId-style or producerId-style element; reconcile if mismatched
        let audioEl = document.getElementById(`audio-${ownerId}`)
        if (!audioEl) {
          // If element exists under producer id while mapping is known, rename it
          const prodEl = document.getElementById(`audio-${producerId}`)
          if (prodEl && ownerId !== producerId) {
            prodEl.id = `audio-${ownerId}`
            prodEl.setAttribute('data-user-id', String(ownerId))
            prodEl.setAttribute('data-producer-id', String(producerId))
            audioEl = prodEl
          }
        }
        if (!audioEl) {
          if (consumer.track && consumer.track.readyState === 'live') {
            createAudioElement(ownerId, consumer.track)
          }
        } else {
          // Apply current output device to existing elements
          try {
            import('~/stores/settings').then(({ useSettingsStore }) => {
              const settings = useSettingsStore()
              const sinkId = settings.outputDeviceId
              if (sinkId && typeof audioEl.setSinkId === 'function') {
                audioEl.setSinkId(sinkId).catch(() => { /* noop */ })
              }
            })
          } catch (_) { /* noop */ }
          // Keep volume in sync as well
          try {
            import('~/stores/voice').then(({ useVoiceStore }) => {
              const voiceStore = useVoiceStore()
              const saved = voiceStore.userVolumes && typeof voiceStore.userVolumes[ownerId] !== 'undefined'
                ? Number(voiceStore.userVolumes[ownerId])
                : undefined
              if (typeof saved === 'number' && !Number.isNaN(saved)) {
                audioEl.volume = saved
              }
            })
          } catch (_) { /* noop */ }
        }
      })
    } catch (e) {
      // swallow
    }
  }

  function removeAudioElement(ownerId) {
    try {
      // Try to remove by the given ID (could be producer ID or user ID)
      const direct = document.getElementById(`audio-${ownerId}`)
      if (direct) {
        direct.remove()
        console.log(`[SFU] Removed audio element: audio-${ownerId}`)
        return
      }

      // Also try to find by data-user-id or data-producer-id
      const container = document.getElementById('webrtc-audio-global')
      if (container) {
        const byUserId = container.querySelector(`audio[data-user-id="${ownerId}"]`)
        if (byUserId) {
          byUserId.remove()
          console.log(`[SFU] Removed audio element by data-user-id: ${ownerId}`)
          return
        }

        const byProducerId = container.querySelector(`audio[data-producer-id="${ownerId}"]`)
        if (byProducerId) {
          byProducerId.remove()
          console.log(`[SFU] Removed audio element by data-producer-id: ${ownerId}`)
          return
        }
      }
    } catch (_) { /* noop */ }
  }

  async function applyOutputDeviceToAll() {
    try {
      const { useSettingsStore } = await import('~/stores/settings')
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

  // Apply volume to any audio element that represents the given userId.
  // This is robust against race conditions where producer->user mapping has not yet been
  // finalized by trying multiple selectors.
  function applyVolumeForUser(userId, volume) {
    try {
      const v = Math.max(0, Math.min(1, Number(volume)))
      
      let elementsFound = 0
      
      // 1) Direct ID based on userId (the steady-state case)
      const elById = document.getElementById(`audio-${userId}`)
      if (elById && typeof elById.volume === 'number') {
        elById.volume = v
        elementsFound++
        console.log(`[SFU] Volume updated via direct user ID: audio-${userId}`)
      }

      // 2) Any element explicitly tagged with this userId
      const container = document.getElementById('webrtc-audio-global')
      if (container) {
        container.querySelectorAll('audio').forEach((el) => {
          if (!el) return
          const dataUid = el.getAttribute('data-user-id')
          if (String(dataUid) === String(userId)) {
            try { 
              el.volume = v
              elementsFound++
              console.log(`[SFU] Volume updated via data-user-id: ${userId}`)
            } catch (_) { /* noop */ }
          }
        })
      }

      // 3) Use producerOwner mapping (reverse lookup) to find any producer currently
      // associated with this user and update that element defensively.
      for (const [producerId, owner] of Array.from(producerOwner.entries())) {
        if (String(owner) === String(userId)) {
          const alt = document.getElementById(`audio-${producerId}`)
          if (alt && typeof alt.volume === 'number') {
            try { 
              alt.volume = v
              // Also rename to the stable user-based ID so future lookups succeed
              if (alt.id !== `audio-${userId}`) {
                alt.id = `audio-${userId}`
                alt.setAttribute('data-user-id', String(userId))
                alt.setAttribute('data-producer-id', String(producerId))
              }
              elementsFound++
              console.log(`[SFU] Volume updated via producer mapping: producer ${producerId} → user ${userId}`)
            } catch (_) { /* noop */ }
          }
        }
      }
      
      // Debug: Show mapping issues only if no elements found
      if (elementsFound === 0) {
        console.log(`[SFU] Volume mapping issue: No audio elements found for user ${userId}`)
        if (container) {
          const available = Array.from(container.querySelectorAll('audio')).map(el => ({
            id: el.id, 
            dataUserId: el.getAttribute('data-user-id'),
            dataProducerId: el.getAttribute('data-producer-id')
          }))
          console.log(`[SFU] Available audio elements:`, available)
          console.log(`[SFU] Producer→User mappings:`, Array.from(producerOwner.entries()))
        }
      } else {
        console.log(`[SFU] Volume successfully updated on ${elementsFound} audio element(s) for user ${userId}`)
      }
    } catch (_) { /* noop */ }
  }

  async function handleDisconnection(channelId) {
    if (manualDisconnect || isShuttingDown || !allowReconnect) {
      return
    }
    if (reconnectAttempts < maxReconnectAttempts) {
      reconnectAttempts++
      console.log(`[SFU] Attempting reconnection ${reconnectAttempts}/${maxReconnectAttempts}`)
      
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
        })
      }, 2000 * reconnectAttempts)
    } else {
      console.error('[SFU] Max reconnection attempts reached')
      error.value = 'Connection lost'
    }
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
      // Prevent onclose handler from triggering reconnection on this instance
      try {
        ws.value.onopen = null
        ws.value.onmessage = null
        ws.value.onerror = null
        ws.value.onclose = null
      } catch (_) { /* noop */ }
      try { ws.value.close() } catch (_) { /* noop */ }
      ws.value = null
    }
    // Stop keepalive ping
    if (pingIntervalId) {
      clearInterval(pingIntervalId)
      pingIntervalId = null
    }
    // Stop audio ensure interval
    if (audioEnsureIntervalId) {
      clearInterval(audioEnsureIntervalId)
      audioEnsureIntervalId = null
    }
    // Cleanup voice detection context/nodes
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
    
  // Ready to accept a future connect() which will reset flags

  function disconnect() {
    console.log('[SFU] Disconnecting')
    // Mark shutdown and disable reconnection
    manualDisconnect = true
    isShuttingDown = true
    allowReconnect = false
    
    // Cancel any pending auto-start timer
    if (autoStartTimeoutId) {
      clearTimeout(autoStartTimeoutId)
      autoStartTimeoutId = null
    }
    // Cancel any pending reconnection timer
    if (reconnectTimeoutId) {
      clearTimeout(reconnectTimeoutId)
      reconnectTimeoutId = null
    }
    
    // Stop all audio production with proper cleanup
    stopAudioProduction()
    // Also stop any in-flight local mic resources acquired but not yet attached to a producer
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
      // Prevent onclose handler from triggering reconnection on this instance
      try {
        ws.value.onopen = null
        ws.value.onmessage = null
        ws.value.onerror = null
        ws.value.onclose = null
      } catch (_) { /* noop */ }
      try { ws.value.close() } catch (_) { /* noop */ }
      ws.value = null
    }
    // Stop keepalive ping
    if (pingIntervalId) {
      clearInterval(pingIntervalId)
      pingIntervalId = null
    }
    // Stop audio ensure interval
    if (audioEnsureIntervalId) {
      clearInterval(audioEnsureIntervalId)
      audioEnsureIntervalId = null
    }
    // Cleanup voice detection context/nodes
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
    
  // Ready to accept a future connect() which will reset flags
  }

  // Collect a snapshot of WebRTC stats from underlying RTCPeerConnections (send/recv)
  // Returns a structured object safe for UI consumption
  async function getWebRTCStatsSnapshot() {
    const buildSnapshotForPc = async (pc, kind) => {
      if (!pc) return null
      try {
        const report = await pc.getStats()
        const byId = new Map()
        report.forEach(s => byId.set(s.id, s))

        // Find transport and selected candidate pair
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

        // Resolve local/remote candidates
        let localCandidate = null
        let remoteCandidate = null
        if (selectedPair) {
          if (selectedPair.localCandidateId) localCandidate = byId.get(selectedPair.localCandidateId) || null
          if (selectedPair.remoteCandidateId) remoteCandidate = byId.get(selectedPair.remoteCandidateId) || null
        }

        // Find RTP stats
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

    // Extract underlying RTCPeerConnections from mediasoup transports (private API)
    const pcSend = sendTransport.value && sendTransport.value._handler && sendTransport.value._handler._pc
      ? sendTransport.value._handler._pc : null
    const pcRecv = recvTransport.value && recvTransport.value._handler && recvTransport.value._handler._pc
      ? recvTransport.value._handler._pc : null

    const [sendSnap, recvSnap] = await Promise.all([
      buildSnapshotForPc(pcSend, 'send'),
      buildSnapshotForPc(pcRecv, 'recv')
    ])

    return {
      timestamp: Date.now(),
      transports: [sendSnap, recvSnap].filter(Boolean)
    }
  }

  return {
    connected: readonly(connected),
    error: readonly(error),
    isProducing: readonly(isProducing),
    transportReady: readonly(transportReady),
    iceConnectedBoth: readonly(iceConnectedBoth),
    producers: readonly(producers),
    consumers: readonly(consumers),
    remoteProducersCount: remoteProducersCount,
    lastInRoom: lastInRoom,
    connect,
    disconnect,
    startAudioProduction,
    stopAudioProduction,
    applyOutputDeviceToAll,
    applyVolumeForUser,
    getWebRTCStatsSnapshot,
    ensureAudioElements,
    waitForIceConnected,
    areTransportsIceConnected
  ,
  // Debug hooks
  lastSentClientRtpCapabilities: readonly(lastSentClientRtpCapabilities),
  lastReceivedConsumerParams: readonly(lastReceivedConsumerParams)
  }
}