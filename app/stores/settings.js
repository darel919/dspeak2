import { defineStore } from 'pinia'

export const useSettingsStore = defineStore('settings', () => {
  const defaultAudio = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: true
  }

  const audio = ref(loadPersisted('audioSettings', defaultAudio))
  const micDeviceId = ref(loadPersisted('audioDeviceId', null))
  const outputDeviceId = ref(loadPersisted('audioOutputDeviceId', null))

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

  function setMicDeviceId(id) {
    micDeviceId.value = id || null
    persist('audioDeviceId', micDeviceId.value)
  }

  function setOutputDeviceId(id) {
    outputDeviceId.value = id || null
    persist('audioOutputDeviceId', outputDeviceId.value)
    
    // Trigger voice store to apply the new output device
    if (typeof window !== 'undefined') {
      import('~/stores/voice').then(({ useVoiceStore }) => {
        const voiceStore = useVoiceStore()
        if (voiceStore.applyOutputDevice) {
          voiceStore.applyOutputDevice()
        }
      }).catch(() => {
        // Voice store not available, ignore
      })
    }
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
  setAudioSetting,
  setMicDeviceId,
  setOutputDeviceId
  }
})
