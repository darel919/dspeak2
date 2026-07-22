export function replaceMediaStreamTrack(stream, track) {
  if (!stream.getTracks().includes(track)) stream.addTrack(track)
  for (const currentTrack of stream.getTracks()) {
    if (currentTrack !== track) stream.removeTrack(currentTrack)
  }
  return stream
}

export class RemoteMediaRegistry {
  constructor({ audioFeeds, videoFeeds, getVolume, getOutputDevice, isDeafened, isBroadcastMode, onSpeaking }) {
    this.audioFeeds = audioFeeds
    this.videoFeeds = videoFeeds
    this.getVolume = getVolume
    this.getOutputDevice = getOutputDevice
    this.isDeafened = isDeafened
    this.isBroadcastMode = isBroadcastMode
    this.onSpeaking = onSpeaking
    this.voiceDetectors = new Map()
  }

  bind(entry, { staged = false } = {}) {
    if (entry.track.kind === 'video') {
      const current = this.videoFeeds.value.get(entry.key)
      const stream = current?.stream || entry.stream || new MediaStream([entry.track])
      if (current?.stream) replaceMediaStreamTrack(stream, entry.track)
      this.videoFeeds.value.set(entry.key, { ...entry, stream })
      this.videoFeeds.value = new Map(this.videoFeeds.value)
      return
    }
    this.remove(entry.key)
    this.audioFeeds.value.set(entry.key, entry)
    this.audioFeeds.value = new Map(this.audioFeeds.value)
    this.createAudioElement(entry, staged)
    if (entry.source === 'audio') this.startVoiceDetection(entry)
  }

  activateProvider(provider) {
    const container = document.getElementById('webrtc-audio-global')
    if (!container) return
    container.querySelectorAll('audio').forEach((audio) => {
      const active = audio.dataset.provider === provider
      audio.muted = !active || this.isDeafened() || this.isBroadcastMode()
      if (!audio.muted) audio.play().catch(() => {})
    })
  }

  remove(key) {
    const audio = this.audioFeeds.value.get(key)
    const video = this.videoFeeds.value.get(key)
    if (!audio && !video) return
    this.audioFeeds.value.delete(key)
    this.videoFeeds.value.delete(key)
    this.audioFeeds.value = new Map(this.audioFeeds.value)
    this.videoFeeds.value = new Map(this.videoFeeds.value)
    document.getElementById(`audio-${key}`)?.remove()
    this.stopVoiceDetection(key)
  }

  clearProvider(provider) {
    const keys = new Set()
    for (const [key, entry] of this.audioFeeds.value) if (entry.provider === provider) keys.add(key)
    for (const [key, entry] of this.videoFeeds.value) if (entry.provider === provider) keys.add(key)
    for (const key of keys) this.remove(key)
  }

  clear() {
    const keys = new Set([...this.audioFeeds.value.keys(), ...this.videoFeeds.value.keys()])
    for (const key of keys) this.remove(key)
  }

  createAudioElement(entry, staged) {
    const container = this.audioContainer()
    const audio = document.createElement('audio')
    audio.id = `audio-${entry.key}`
    audio.dataset.userId = String(entry.userId)
    audio.dataset.source = entry.source
    audio.dataset.provider = entry.provider
    audio.dataset.producerId = entry.key
    audio.autoplay = true
    audio.controls = false
    audio.playsInline = true
    audio.srcObject = entry.stream || new MediaStream([entry.track])
    audio.volume = this.getVolume(entry.userId, entry.source)
    audio.muted = staged || this.isDeafened() || this.isBroadcastMode()
    const sinkId = this.getOutputDevice()
    if (sinkId && typeof audio.setSinkId === 'function') audio.setSinkId(sinkId).catch(() => {})
    container.appendChild(audio)
    if (!audio.muted) audio.play().catch(() => {})
  }

  audioContainer() {
    let container = document.getElementById('webrtc-audio-global')
    if (container) return container
    container = document.createElement('div')
    container.id = 'webrtc-audio-global'
    container.hidden = true
    document.body.appendChild(container)
    return container
  }

  applyOutputDevice() {
    const sinkId = this.getOutputDevice()
    if (!sinkId) return Promise.resolve()
    const elements = document.getElementById('webrtc-audio-global')?.querySelectorAll('audio') || []
    return Promise.all([...elements].map(audio => typeof audio.setSinkId === 'function' ? audio.setSinkId(sinkId).catch(() => {}) : null))
  }

  applyVolume(userId, source, volume) {
    const elements = document.getElementById('webrtc-audio-global')?.querySelectorAll('audio') || []
    for (const audio of elements) {
      if (audio.dataset.userId === String(userId) && (!source || audio.dataset.source === source)) audio.volume = volume
    }
  }

  ensurePlayback() {
    const elements = document.getElementById('webrtc-audio-global')?.querySelectorAll('audio') || []
    for (const audio of elements) {
      if (!audio.muted && audio.paused) audio.play().catch(() => {})
    }
  }

  startVoiceDetection(entry) {
    this.stopVoiceDetection(entry.key)
    try {
      const AudioContextConstructor = window.AudioContext || window.webkitAudioContext
      if (!AudioContextConstructor) throw new Error('Web Audio is unavailable')
      const context = new AudioContextConstructor()
      const source = context.createMediaStreamSource(new MediaStream([entry.track]))
      const analyser = context.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      const samples = new Uint8Array(analyser.fftSize)
      let speaking = false
      let quietSamples = 0
      const timer = setInterval(() => {
        analyser.getByteTimeDomainData(samples)
        const energy = Math.sqrt(samples.reduce((sum, value) => sum + (value - 128) ** 2, 0) / samples.length)
        if (energy > 10) {
          quietSamples = 0
          if (!speaking) {
            speaking = true
            this.onSpeaking(entry.userId, true)
          }
        } else if (speaking && ++quietSamples >= 6) {
          speaking = false
          this.onSpeaking(entry.userId, false)
        }
      }, 80)
      this.voiceDetectors.set(entry.key, { context, source, analyser, timer, userId: entry.userId })
    } catch (_) {
      this.onSpeaking(entry.userId, false)
    }
  }

  stopVoiceDetection(key) {
    const detector = this.voiceDetectors.get(key)
    if (!detector) return
    clearInterval(detector.timer)
    detector.source.disconnect()
    detector.analyser.disconnect()
    detector.context.close().catch(() => {})
    this.onSpeaking(detector.userId, false)
    this.voiceDetectors.delete(key)
  }
}
