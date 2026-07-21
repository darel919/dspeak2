import { defineStore } from 'pinia'
import { normalizeVideoSettings } from '~/shared/video-settings'

export const useSettingsStore = defineStore('settings', () => {
  const defaultAudio = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: true
  }

  const audio = ref(loadPersisted('audioSettings', defaultAudio))
  const micDeviceId = ref(loadPersisted('audioDeviceId', null))
  const outputDeviceId = ref(loadPersisted('audioOutputDeviceId', null))
  const cameraDeviceId = ref(loadPersisted('videoDeviceId', null))
  const cameraVideo = ref(normalizeVideoSettings(loadPersisted('cameraVideoSettings', {})))
  const screenVideo = ref(normalizeVideoSettings(loadPersisted('screenVideoSettings', {})))
  const broadcastMode = ref(loadPersisted('broadcastMode', false))
  const sharedAudioVolume = ref(normalizeSharedAudioVolume(loadPersisted('sharedAudioVolume', 100)))
  const systemAudioBitrate = ref(normalizeSystemAudioBitrate(loadPersisted('systemAudioBitrate', 128)))

  const supported = computed(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getSupportedConstraints) {
      return {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    }
    const sc = navigator.mediaDevices.getSupportedConstraints()
    return {
      echoCancellation: !!sc.echoCancellation,
      noiseSuppression: !!sc.noiseSuppression,
      autoGainControl: !!sc.autoGainControl
    }
  })

  function setAudioSetting(key, value) {
    if (!(key in audio.value)) return
    audio.value = { ...audio.value, [key]: !!value }
    persist('audioSettings', audio.value)
  }

  function setBroadcastMode(val) {
    broadcastMode.value = !!val
    persist('broadcastMode', broadcastMode.value)
  }

  function normalizeSharedAudioVolume(value) {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? Math.min(100, Math.max(0, Math.round(numeric))) : 100
  }

  function setSharedAudioVolume(value) {
    sharedAudioVolume.value = normalizeSharedAudioVolume(value)
    persist('sharedAudioVolume', sharedAudioVolume.value)
  }

  function normalizeSystemAudioBitrate(value) {
    const options = [64, 96, 128, 160, 256]
    const numeric = Number(value)
    return options.includes(numeric) ? numeric : 128
  }

  function setSystemAudioBitrate(value) {
    systemAudioBitrate.value = normalizeSystemAudioBitrate(value)
    persist('systemAudioBitrate', systemAudioBitrate.value)
  }

  function setMicDeviceId(id) {
    micDeviceId.value = id || null
    persist('audioDeviceId', micDeviceId.value)
  }

  function setOutputDeviceId(id) {
    outputDeviceId.value = id || null
    persist('audioOutputDeviceId', outputDeviceId.value)


    if (typeof window !== 'undefined') {
      import('~/stores/voice').then(({ useVoiceStore }) => {
        const voiceStore = useVoiceStore()
        if (voiceStore.applyOutputDevice) {
          voiceStore.applyOutputDevice()
        }
      }).catch(() => {

      })
    }
  }

  function setCameraDeviceId(id) {
    cameraDeviceId.value = id || null
    persist('videoDeviceId', cameraDeviceId.value)
  }

  function setCameraVideoSettings(value) {
    cameraVideo.value = normalizeVideoSettings({ ...cameraVideo.value, ...value })
    persist('cameraVideoSettings', cameraVideo.value)
  }

  function setScreenVideoSettings(value) {
    screenVideo.value = normalizeVideoSettings({ ...screenVideo.value, ...value })
    persist('screenVideoSettings', screenVideo.value)
  }

  function loadPersisted(key, fallback) {
    try {
      if (typeof localStorage === 'undefined') return fallback
      const raw = localStorage.getItem(key)
      if (!raw) return fallback
      const parsed = JSON.parse(raw)
      if (fallback && typeof fallback === 'object' && !Array.isArray(fallback)) {
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return { ...fallback, ...parsed }
        }
        return fallback
      }
      return parsed
    } catch (_) {
      return fallback
    }
  }

  function persist(key, value) {
    try {
      if (typeof localStorage === 'undefined') return
      localStorage.setItem(key, JSON.stringify(value))
    } catch (_) { /* noop */ }
  }

  return {
    audio,
    supported,
    micDeviceId,
    outputDeviceId,
    cameraDeviceId,
    cameraVideo,
    screenVideo,
    broadcastMode,
    sharedAudioVolume,
    systemAudioBitrate,
    setAudioSetting,
    setMicDeviceId,
    setOutputDeviceId,
    setCameraDeviceId,
    setCameraVideoSettings,
    setScreenVideoSettings,
    setBroadcastMode,
    setSharedAudioVolume,
    setSystemAudioBitrate
  }
})
